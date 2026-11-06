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
]) test(`second-pass request preserves the composed first-pass instructions: ${name}`, async () => {
    const settings = { ...base, ...extra };
    const before = structuredClone(settings);
    const speakerScopes = Object.fromEntries(segmented.segments.filter(row => row.type === 'dialogue_candidate').map(row => [row.id, 'target_dialogue']));
    const args = [segmented, settings, 'ONETIME_SENTINEL', identity, null, speakerScopes];
    const first = buildOutputPrompt(...args);
    assert.ok(first.includes(deepseekKoreanPrompt(settings)));
    const translations = new Map(segmented.segments.map(row => [row.id, row.type === 'dialogue_candidate' ? '"Stay. (있어.)"' : '초안']));
    // The full instruction prefix is retained while the target array is replaced.
    await requestSecondTranslation({ segmented, translations, basePrompt: first, request: async (prompt, rows) => {
        const prefix = first.slice(0, first.lastIndexOf('\nSEGMENTS\n'));
        assert.ok(prompt.includes('FIRST_PASS_TRANSLATION_RULES\n' + prefix + '\n\n'));
        assert.equal(prompt.split('\nSEGMENTS\n').length, 2);
        assert.equal(prompt.split(deepseekKoreanPrompt(settings)).length, 2);
        const fullSource = JSON.parse(prompt.split('\nSOURCE_CONTEXT\n')[1].split('\n')[0]);
        assert.equal(fullSource, segmented.source);
        const drafts = JSON.parse(prompt.split('\nSEGMENTS\n')[1]);
        assert.equal(drafts.length, rows.length);
        for (const [i, draft] of drafts.entries()) {
            assert.equal(draft.id, rows[i].id);
            assert.equal(draft.text, rows[i].text);
            assert.equal(draft.type, rows[i].type);
            if (rows[i].type === 'dialogue_candidate') assert.equal(draft.speaker_scope, 'target_dialogue');
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
