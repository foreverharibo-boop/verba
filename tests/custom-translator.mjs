import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = [
    'output', 'input', 'selection', 'name', 'consistency', 'repair', 'quality', 'flavor', 'other',
];
const defaults = Object.fromEntries(definitions.map(key => [key, '']));

const normalizeStart = index.indexOf('function normalizeCustomTranslatorInstruction(');
const normalizeEnd = index.indexOf('const DEFAULT_SETTINGS =', normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
const normalizeCustomTranslatorInstruction = Function(
    'CUSTOM_TRANSLATOR_SIMPLE_MARKER',
    `${index.slice(normalizeStart, normalizeEnd)}\nreturn normalizeCustomTranslatorInstruction;`,
)('[사용자 추가 지침]');

assert.equal(normalizeCustomTranslatorInstruction(''), '');
assert.equal(normalizeCustomTranslatorInstruction('{기본_프롬프트}'), '');
assert.equal(
    normalizeCustomTranslatorInstruction('{기본_프롬프트}\n\n[사용자 추가 지침]\nTranslate naturally.'),
    'Translate naturally.',
);
assert.equal(
    normalizeCustomTranslatorInstruction('Translate naturally.\n{기본_프롬프트}\n{대상_JSON}'),
    'Translate naturally.',
);

const settings = {
    customTranslatorEnabled: true,
    customTranslatorTemplates: {
        ...defaults,
        output: 'Translate as natural Korean prose.',
    },
};
const start = index.indexOf('function customTranslatorPromptKey(');
const end = index.indexOf('async function sendWithRetry(', start);
assert.ok(start >= 0 && end > start);
const api = Function(
    'settings',
    'DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES',
    'normalizeCustomTranslatorInstruction',
    `${index.slice(start, end)}\nreturn { customTranslatorPromptKey, applyCustomTranslatorPrompt };`,
)(settings, defaults, normalizeCustomTranslatorInstruction);

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
const replaced = api.applyCustomTranslatorPrompt('OLD DEFAULT PROMPT MUST DISAPPEAR', {
    stage: 'output-translation',
    customTargetSegments: targets,
});
assert.doesNotMatch(replaced, /OLD DEFAULT PROMPT MUST DISAPPEAR/);
assert.match(replaced, /USER TRANSLATION INSTRUCTION/);
assert.match(replaced, /Translate as natural Korean prose\./);
assert.match(replaced, /VERBA REQUEST DATA/);
assert.match(replaced, /Source text\./);
assert.match(replaced, /VERBA LOCKED RESPONSE CONTRACT/);
assert.match(replaced, /@@VERBA_\.\.\.@/);
assert.match(replaced, /seg_0001/);

settings.customTranslatorTemplates.selection = 'Create three natural Korean alternatives.';
const candidatePrompt = api.applyCustomTranslatorPrompt('OLD CANDIDATE PROMPT', {
    stage: 'selection-candidates',
    customTargetSegments: [{ id: 'seg_0000', type: 'selection', text: '기존 번역' }],
    customRequestData: { selectedText: '기존 번역', sourceContext: 'Original source context.' },
});
assert.doesNotMatch(candidatePrompt, /OLD CANDIDATE PROMPT/);
assert.match(candidatePrompt, /Create three natural Korean alternatives\./);
assert.match(candidatePrompt, /Original source context\./);
assert.match(candidatePrompt, /"candidates"/);
assert.doesNotMatch(candidatePrompt, /"segments":\[/);

assert.equal(
    api.applyCustomTranslatorPrompt('INPUT ORIGINAL', {
        stage: 'input-translation',
        customTargetSegments: targets,
    }),
    'INPUT ORIGINAL',
    'a blank category keeps Verba’s existing prompt unchanged',
);
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

const uiStart = index.indexOf('function customTranslatorInstructionPlaceholder(');
const uiEnd = index.indexOf('function injectSettingsPanel(', uiStart);
const customTranslatorUi = index.slice(uiStart, uiEnd);
assert.match(customTranslatorUi, /<summary>커스텀 번역기/);
assert.match(customTranslatorUi, /id="verba-custom-translator-enabled"/);
assert.match(customTranslatorUi, /data-verba-custom-translator-key/);
assert.doesNotMatch(customTranslatorUi, /data-verba-custom-translator-mode/);
assert.doesNotMatch(customTranslatorUi, /간편 설정/);
assert.doesNotMatch(customTranslatorUi, /고급 설정/);
assert.doesNotMatch(customTranslatorUi, /직접 구성용 변수 보기/);
assert.match(customTranslatorUi, /원하는 항목에 <b>영어 지침만<\/b> 적으세요/);
assert.match(customTranslatorUi, /기존 프롬프트를 완전히 대체합니다/);
assert.match(customTranslatorUi, /원문 데이터·JSON 응답 형식·이름·태그·보호 표식은 베르바가 자동으로 붙이며/);
assert.match(index, /채팅 번역/);
assert.match(index, /내가 보내는 글/);
assert.match(index, /선택한 부분 다시 번역/);
assert.match(index, /bindPromptExpandEditors\(panel\);\s*syncCustomTranslatorControls\(panel\);/);
assert.match(index, /target\.matches\('\[data-verba-custom-translator-key\]'\)[\s\S]*?normalizeCustomTranslatorInstruction\(target\.value\)[\s\S]*?saveSettings\(\)/);
assert.match(index, /const outgoingPrompt = applyCustomTranslatorPrompt\(prompt, options\)/);
assert.match(index, /customTargetSegments: pending/);

console.log('PASS: custom translator fully replaces default prompts with plain English instructions, automatic source data, and locked response contracts.');
