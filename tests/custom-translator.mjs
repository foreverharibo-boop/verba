import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = index.indexOf('function customTranslatorPromptKey(');
const end = index.indexOf('async function sendWithRetry(', start);
assert.ok(start >= 0 && end > start);

const definitions = [
    'output', 'input', 'selection', 'name', 'consistency', 'repair', 'quality', 'flavor', 'other',
];
const defaults = Object.fromEntries(definitions.map(key => [key, '{기본_프롬프트}']));
const settings = {
    customTranslatorEnabled: true,
    customTranslatorTemplates: {
        ...defaults,
        output: '앞 지시\n{기본_프롬프트}\n종류={요청_종류}',
        input: '직접 지시\n{대상_JSON}',
    },
};
const api = Function(
    'settings',
    'DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES',
    `${index.slice(start, end)}\nreturn { customTranslatorPromptKey, applyCustomTranslatorPrompt };`,
)(settings, defaults);

assert.equal(api.customTranslatorPromptKey('output-retranslation:narration'), 'output');
assert.equal(api.customTranslatorPromptKey('input-translation'), 'input');
assert.equal(api.customTranslatorPromptKey('selection-candidates'), 'selection');
assert.equal(api.customTranslatorPromptKey('name-match'), 'name');
assert.equal(api.customTranslatorPromptKey('role-term-plan'), 'consistency');
assert.equal(api.customTranslatorPromptKey('banned-word-repair'), 'repair');
assert.equal(api.customTranslatorPromptKey('quality-audit'), 'quality');
assert.equal(api.customTranslatorPromptKey('hongjin-voice-rewrite'), 'flavor');
assert.equal(api.customTranslatorPromptKey('future-stage'), 'other');

const targets = [{ id: 'seg_0001', type: 'narration', text: 'Source text.' }];
const wrapped = api.applyCustomTranslatorPrompt('ORIGINAL', {
    stage: 'output-translation',
    customTargetSegments: targets,
});
assert.match(wrapped, /앞 지시/);
assert.match(wrapped, /ORIGINAL/);
assert.match(wrapped, /종류=output-translation/);
assert.match(wrapped, /베르바 잠금 실행 계약/);
assert.match(wrapped, /@@VERBA_\.\.\.@/);
assert.match(wrapped, /seg_0001/);

const replaced = api.applyCustomTranslatorPrompt('SHOULD_NOT_REMAIN', {
    stage: 'input-translation',
    customTargetSegments: targets,
});
assert.doesNotMatch(replaced, /SHOULD_NOT_REMAIN/);
assert.match(replaced, /Source text/);
assert.match(replaced, /잠금 실행 계약/);

assert.equal(
    api.applyCustomTranslatorPrompt('PING', { stage: 'connection-test', customTargetSegments: targets }),
    'PING',
);
settings.customTranslatorEnabled = false;
assert.equal(api.applyCustomTranslatorPrompt('UNCHANGED', { stage: 'output-translation' }), 'UNCHANGED');

const expectedOrder = definitions.map(key => `{ key: '${key}'`);
let previous = -1;
for (const token of expectedOrder) {
    const position = index.indexOf(token, previous + 1);
    assert.ok(position > previous, `${token} order`);
    previous = position;
}

assert.match(index, /<summary>커스텀 번역기/);
assert.match(index, /id="verba-custom-translator-enabled"/);
assert.match(index, /data-verba-custom-translator-key/);
assert.match(index, /class="verba-prompt-slot verba-custom-translator-field"/);
assert.match(index, /JSON 응답 형식·보호 표식·태그 보존 계약/);
assert.match(index, /bindPromptExpandEditors\(panel\);\s*syncCustomTranslatorControls\(panel\);/);
assert.match(index, /target\.matches\('\[data-verba-custom-translator-key\]'\)[\s\S]*?saveSettings\(\)/);
assert.match(index, /const outgoingPrompt = applyCustomTranslatorPrompt\(prompt, options\)/);
assert.match(index, /customTargetSegments: pending/);

console.log('PASS: custom translator category order, runtime variables, locked contracts, general-mode UI, expand editor binding, and auto-save path.');
