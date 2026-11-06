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
const precedence = 'ACTIVE SETTINGS PRECEDENCE: The preceding text is baseline translation guidance. Apply the same active user prompts, custom translation instructions, tastes, localization, register, one-time instructions, protected structure and output format as an ordinary Verba request below. Explicit active style/format settings override conflicting baseline wording only within their authorized scopes; preserve the ordinary priority and exclusive-mode rules. Never broaden a speaker or bilingual scope. GALBWAE exclusive Korean-only rules override the baseline bilingual exception. MAD is an additive Korean writing style and does not suppress active prompts or bilingual formatting. Do not invent factual content.';

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
]) test(`second-pass base removes only DeepSeek prose and wrapper: ${name}`, async () => {
    const settings = { ...base, ...extra };
    const before = structuredClone(settings);
    const args = [segmented, settings, 'ONETIME_SENTINEL', identity, null, {}];
    const first = buildOutputPrompt(...args);
    const second = buildOutputPrompt(...args, { omitDeepseekBaseline: true });
    const prefix = deepseekKoreanPrompt(settings) + '\n' + precedence + '\n';
    assert.equal(first, prefix + second, 'all non-DeepSeek prompt bytes must remain unchanged');
    assert.ok(!second.includes(deepseekKoreanPrompt(settings)));
    const translations = new Map(segmented.segments.map(row => [row.id, '초안']));
    await requestSecondTranslation({ segmented, translations, basePrompt: second, request: async (prompt, rows) => {
        assert.ok(prompt.endsWith(second));
        assert.ok(!prompt.includes(deepseekKoreanPrompt(settings)));
        assert.deepEqual(rows, segmented.segments);
        return new Map(rows.map(row => [row.id, '완성된 번역이다.']));
    } });
    assert.deepEqual(settings, before, 'request construction must not disable or change saved settings');
    assert.equal(buildOutputPrompt(...args), first, 'later first-pass requests must retain the baseline');
});
