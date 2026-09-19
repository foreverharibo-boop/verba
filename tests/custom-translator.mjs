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
    customTranslatorAdvancedBackups: Object.fromEntries(definitions.map(key => [key, ''])),
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

const helperStart = index.indexOf('function customTranslatorSimpleTemplate(');
const helperEnd = index.indexOf('function customTranslatorSettingsMarkup(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helpers = Function(
    'settings',
    'DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES',
    'CUSTOM_TRANSLATOR_SIMPLE_KEYS',
    'CUSTOM_TRANSLATOR_SIMPLE_MARKER',
    `${index.slice(helperStart, helperEnd)}\nreturn { customTranslatorSimpleTemplate, customTranslatorTemplateState, changeCustomTranslatorSimpleMode };`,
)(settings, defaults, new Set(['output', 'input', 'selection']), '[사용자 추가 지침]');
const appended = helpers.customTranslatorSimpleTemplate('대사는 한영 병기로 써 주세요.');
assert.equal(appended, '{기본_프롬프트}\n\n[사용자 추가 지침]\n대사는 한영 병기로 써 주세요.');
assert.deepEqual(
    helpers.customTranslatorTemplateState('output', '{기본_프롬프트}'),
    { mode: 'default', editorValue: '' },
);
assert.deepEqual(
    helpers.customTranslatorTemplateState('output', appended),
    { mode: 'append', editorValue: '대사는 한영 병기로 써 주세요.' },
);
assert.deepEqual(
    helpers.customTranslatorTemplateState('output', '직접 만든 원본 프롬프트'),
    { mode: 'advanced', editorValue: '직접 만든 원본 프롬프트' },
    'legacy/custom raw templates automatically stay in advanced mode',
);
settings.customTranslatorTemplates.output = '직접 만든 원본 프롬프트';
let switched = helpers.changeCustomTranslatorSimpleMode('output', 'default', 'advanced', '직접 만든 원본 프롬프트');
assert.deepEqual(switched, { mode: 'default', editorValue: '' });
assert.equal(settings.customTranslatorTemplates.output, '{기본_프롬프트}');
assert.equal(settings.customTranslatorAdvancedBackups.output, '직접 만든 원본 프롬프트');
switched = helpers.changeCustomTranslatorSimpleMode('output', 'append', 'default', '');
assert.deepEqual(switched, { mode: 'append', editorValue: '' });
assert.equal(settings.customTranslatorTemplates.output, '{기본_프롬프트}\n\n[사용자 추가 지침]\n');
switched = helpers.changeCustomTranslatorSimpleMode('output', 'advanced', 'append', '쉬운 지침');
assert.deepEqual(switched, { mode: 'advanced', editorValue: '직접 만든 원본 프롬프트' });
assert.equal(settings.customTranslatorTemplates.output, '직접 만든 원본 프롬프트');

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
assert.match(index, /data-verba-custom-translator-mode/);
assert.match(index, /간편 설정/);
assert.match(index, /기본 설정에 내 지침 추가 \(추천\)/);
assert.match(index, /고급 설정 <small>이름·검수·복구·캐릭터 말투/);
assert.match(index, /직접 구성용 변수 보기/);
assert.match(index, /채팅 번역/);
assert.match(index, /내가 보내는 글/);
assert.match(index, /선택한 부분 다시 번역/);
assert.match(index, /JSON 응답 형식·보호 표식·태그 보존 규칙/);
assert.match(index, /customTranslatorAdvancedBackups/);
assert.match(index, /previousMode === 'advanced'/);
assert.match(index, /bindPromptExpandEditors\(panel\);\s*syncCustomTranslatorControls\(panel\);/);
assert.match(index, /target\.matches\('\[data-verba-custom-translator-key\]'\)[\s\S]*?saveSettings\(\)/);
assert.match(index, /const outgoingPrompt = applyCustomTranslatorPrompt\(prompt, options\)/);
assert.match(index, /customTargetSegments: pending/);

console.log('PASS: custom translator easy/advanced modes, legacy raw-template preservation, category order, locked contracts, expand editor binding, and auto-save path.');
