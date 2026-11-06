import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECOND_TRANSLATION_INSTRUCTION, secondTranslationEnabled, requestSecondTranslation } from '../second-translation.js';

const segmented = { segments: [{ id: 'one', text: 'Stay.' }, { id: 'two', text: 'After.' }] };
const translations = new Map([['one', '있어.'], ['two', '그다음.']]);
const cfg = { developerDeepseekKoreanEnabled: true, developerSecondTranslationEnabled: true };
test('second translation is opt-in, requires DeepSeek prompt, and excludes free Google', () => {
    assert.equal(secondTranslationEnabled({}), false);
    assert.equal(secondTranslationEnabled(cfg), true);
    assert.equal(secondTranslationEnabled({ ...cfg, developerMode: false }), true);
    for (const override of [{ developerSecondTranslationEnabled: false }, { developerDeepseekKoreanEnabled: false }, { translationEngine: 'google-free' }])
        assert.equal(secondTranslationEnabled({ ...cfg, ...override }), false);
});
test('rewrite receives first-pass rules with source and draft; replaces all IDs atomically', async () => {
    const before = [...translations];
    const result = await requestSecondTranslation({ segmented, translations, basePrompt: 'ACTIVE_SENTINEL', options: { splitBatchCount: 3, splitBatchIndex: 3, previousUserSource: 'PREVIOUS_SENTINEL' }, request: async (prompt, rows, options) => {
        assert.match(prompt, /ACTIVE_SENTINEL/);
        assert.ok(prompt.startsWith('SECOND TRANSLATION\n'));
        assert.ok(prompt.includes(SECOND_TRANSLATION_INSTRUCTION + '\n\nSOURCE_CONTEXT\n'));
        const drafts = JSON.parse(prompt.split('\nSEGMENTS\n')[1].split('\n')[0]);
        assert.deepEqual(drafts, [{ id: 'one', type: 'narration', text: 'Stay.', first_translation: '있어.' }, { id: 'two', type: 'narration', text: 'After.', first_translation: '그다음.' }]);
        assert.equal(options.stage, 'output-second-translation');
        assert.equal(options.splitBatchCount, undefined);
        assert.equal(options.onOutputResponse, undefined);
        assert.equal(options.previousUserSource, 'PREVIOUS_SENTINEL');
        return new Map([['one', '여기 있어.'], ['two', '끝나고도.']]);
    }});
    assert.deepEqual([...translations], before);
    assert.equal(result.get('two'), '끝나고도.');
});
test('failed, incomplete or cancelled rewrite never returns a draft or partial final', async () => {
    const before = [...translations];
    for (const request of [async () => { throw Error('offline'); }, async () => new Map([['one', '여기 있어.']]), async () => new Map([['one', '여기 있어.'], ['two', '']])])
        await assert.rejects(requestSecondTranslation({ segmented, translations, basePrompt: '', request }), /초벌 번역은 표시하지 않았습니다/);
    const controller = new AbortController();
    await assert.rejects(requestSecondTranslation({ segmented, translations, basePrompt: '', options: { signal: controller.signal }, request: async () => {
        controller.abort(); return translations;
    }}), { name: 'AbortError' });
    await assert.rejects(requestSecondTranslation({ segmented, translations, basePrompt: '', options: { signal: controller.signal }, request: () => assert.fail('called after cancellation') }), { name: 'AbortError' });
    assert.deepEqual([...translations], before);
});
test('checkbox appears directly below DeepSeek checkbox, defaults off and saves independently', () => {
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const prefix = index.includes("const EXTENSION_KEY = 'verba-deep'") ? 'verba-deep' : 'verba';
    const section = index.slice(index.indexOf('function deepseekSettingsMarkup()'), index.indexOf('function developerChuseokGalbwaeMarkup()'));
    const render = Function('settings', `${section}; return deepseekSettingsMarkup();`);
    const html = render({});
    assert.match(html, new RegExp(`id="${prefix}-deepseek-enabled"[\\s\\S]*?</label>\\s*<label class="${prefix}-check-row">\\s*<input type="checkbox" id="${prefix}-second-translation-enabled"`));
    assert.doesNotMatch(html, /checked/);
    assert.match(render(cfg), /second-translation-enabled" checked/);
    const start = index.indexOf(`        if (target.id === '${prefix}-second-translation-enabled'`);
    const end = index.indexOf(`        if (target.id === '${prefix}-deepseek-enabled'`, start);
    const state = {}; let saves = 0;
    class Input { constructor(checked) { this.id = `${prefix}-second-translation-enabled`; this.checked = checked; } }
    const handle = Function('target', 'HTMLInputElement', 'settings', 'saveSettings', 'document', index.slice(start, end));
    for (const checked of [true, false]) {
        handle(new Input(checked), Input, state, () => saves++, { querySelector: () => null });
        assert.equal(state.developerSecondTranslationEnabled, checked);
    }
    assert.equal(saves, 2);
    assert.match(index, /developerSecondTranslationEnabled: false/);
    assert.match(index, /developerSecondTranslationEnabled: raw\.developerSecondTranslationEnabled === true/);
    assert.match(index, /developerSecondTranslationEnabled: source\.developerSecondTranslationEnabled/);
    assert.match(index, /settings\.developerSecondTranslationEnabled = next\.developerSecondTranslationEnabled/);
});
