import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutputPrompt, segmentSource } from '../core.js';
import { deepseekKoreanPrompt } from '../deepseek-korean.js';
import { requestSecondTranslation } from '../second-translation.js';

const source = 'Dana waited.\n\n"Stay."\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>';
const segmented = segmentSource(source, [{ source: 'Dana', target: '다나' }]);
const identity = { characterName: 'Cade', userName: 'Dana', translationReference: 'REFERENCE_SENTINEL' };
const base = {
    developerDeepseekKoreanEnabled: true, developerSecondTranslationEnabled: true,
    globalPromptEnabled: true, globalPrompt: 'GLOBAL_SENTINEL',
    allDialoguePromptEnabled: true, allDialoguePrompt: 'ALL_SENTINEL',
    dialoguePromptEnabled: true, dialoguePrompt: 'TARGET_SENTINEL',
    otherDialoguePromptEnabled: true, otherDialoguePrompt: 'OTHER_SENTINEL',
    englishFlavorEnabled: true, koreanFlavorEnabled: true,
    relationTemperatureEnabled: true, relationTemperature: 'intimate',
    developerRelationshipExperimentEnabled: true, developerTargetToUserRegister: 'banmal',
    developerUserToTargetRegister: 'jondaetmal', translateTaggedContent: true,
    bannedWords: '금지표현', dialogueEndingPreferred: 'ENDING_SENTINEL',
};

for (const [name, extra] of [
    ['ordinary settings', {}],
    ['custom output and DeepSeek editor', { customTranslatorEnabled: true,
        customTranslatorTemplates: { output: 'CUSTOM_OUTPUT_SENTINEL', deepseek: 'CUSTOM_DEEPSEEK_SENTINEL' },
        customTranslatorModified: { output: true, deepseek: true } }],
    ['MAD', { developerMadKoreanOutputEnabled: true }],
    ['custom MAD', { developerMadKoreanOutputEnabled: true, customTranslatorEnabled: true,
        customTranslatorTemplates: { mad: 'CUSTOM_MAD_SENTINEL' }, customTranslatorModified: { mad: true } }],
    ['Hongjin', { developerHongjinFlavorEnabled: true }],
    ['Galbwae', { developerMode: true, chuseokGalbwaeScope: 'all' }],
]) test(`second-pass request is independent of first-pass instructions: ${name}`, async () => {
    const settings = { ...base, ...extra };
    const before = structuredClone(settings);
    const args = [segmented, settings, 'ONETIME_SENTINEL', identity, null, {}];
    const first = buildOutputPrompt(...args);
    assert.ok(first.includes(deepseekKoreanPrompt(settings)));
    const translations = new Map(segmented.segments.map(row => [row.id, row.type === 'dialogue_candidate' ? '"Stay. (있어.)"' : '초안']));
    // Even an obsolete caller supplying basePrompt cannot inject it into pass 2.
    await requestSecondTranslation({ segmented, translations, basePrompt: first, request: async (prompt, rows) => {
        assert.doesNotMatch(prompt, /SENTINEL|ACTIVE TRANSLATION INSTRUCTIONS|HIGHEST-PRIORITY TRANSLATION PRINCIPLE/);
        const fullSource = JSON.parse(prompt.split('\nSOURCE_CONTEXT\n')[1].split('\n')[0]);
        assert.equal(fullSource, segmented.source);
        const drafts = JSON.parse(prompt.split('\nSEGMENTS\n')[1]);
        assert.equal(drafts.length, rows.length);
        for (const [i, draft] of drafts.entries()) {
            assert.equal(draft.id, rows[i].id);
            assert.equal(draft.text, rows[i].text);
            assert.equal(draft.type, rows[i].type);
            assert.equal(draft.first_translation, translations.get(draft.id));
            if (rows[i].tagContext?.length) assert.deepEqual(draft.tag_context, rows[i].tagContext);
        }
        assert.ok(drafts.some(row => row.first_translation.includes('Stay. (있어.)')));
        assert.deepEqual(rows, segmented.segments);
        return new Map(rows.map(row => [row.id, '완성된 번역이다.']));
    } });
    assert.deepEqual(settings, before, 'construction must not disable or change saved settings');
    assert.equal(buildOutputPrompt(...args), first, 'later first-pass requests retain the same settings');
});
