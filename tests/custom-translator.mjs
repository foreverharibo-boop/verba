import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDefaultCustomTranslatorTemplates } from '../custom-translator-defaults.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = [
    'output', 'input', 'selection', 'name', 'consistency', 'repair', 'quality', 'flavor', 'other',
];
const defaults = Object.fromEntries(definitions.map(key => [key, '']));
const originalDefaults = buildDefaultCustomTranslatorTemplates([
    'oneTime', 'characterDialogue', 'otherDialogue', 'allDialogue', 'global', 'fineTuning',
]);
assert.ok(originalDefaults.output.length > 2000);
assert.ok(originalDefaults.input.length > 1000);
assert.ok(originalDefaults.selection.length > 2000);
assert.ok(originalDefaults.flavor.length > 3000);
assert.match(originalDefaults.output, /Translate into fluent, idiomatic Korean/);
assert.match(originalDefaults.input, /K→E: USER input→native English/);
assert.match(originalDefaults.flavor, /MANDATORY AUTHORIZED VOICE OVERRIDE — TARGET dialogue only/);
assert.match(originalDefaults.flavor, /MAD KOREAN — MANDATORY REAUTHORING/);
assert.doesNotMatch(originalDefaults.output, /\{\{SOURCE_NARRATION\}\}/);
assert.doesNotMatch(originalDefaults.input, /\{\{KOREAN_INPUT\}\}/);

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

const normalizeSettingsStart = index.indexOf('function normalizeCustomTranslatorSettings(');
const normalizeSettingsEnd = index.indexOf('const DEFAULT_SETTINGS =', normalizeSettingsStart);
assert.ok(normalizeSettingsStart >= 0 && normalizeSettingsEnd > normalizeSettingsStart);
const visibleDefaults = Object.fromEntries(definitions.map(key => [key, `Bundled ${key} instruction.`]));
const normalizeCustomTranslatorSettings = Function(
    'CUSTOM_TRANSLATOR_PROMPT_DEFINITIONS',
    'DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES',
    'normalizeCustomTranslatorInstruction',
    `${index.slice(normalizeSettingsStart, normalizeSettingsEnd)}\nreturn normalizeCustomTranslatorSettings;`,
)(definitions.map(key => ({ key })), visibleDefaults, normalizeCustomTranslatorInstruction);
const migratedBlank = normalizeCustomTranslatorSettings(
    Object.fromEntries(definitions.map(key => [key, ''])),
    {},
);
assert.equal(migratedBlank.templates.output, visibleDefaults.output);
assert.equal(migratedBlank.modified.output, false);
const migratedLegacyCustom = normalizeCustomTranslatorSettings({ output: 'My saved replacement.' }, {});
assert.equal(migratedLegacyCustom.templates.output, 'My saved replacement.');
assert.equal(migratedLegacyCustom.modified.output, true);
const refreshedBundled = normalizeCustomTranslatorSettings(
    { output: 'Old bundled instruction.' },
    { output: false },
);
assert.equal(refreshedBundled.templates.output, visibleDefaults.output);
assert.equal(refreshedBundled.modified.output, false);
const preservedEdited = normalizeCustomTranslatorSettings(
    { output: 'My edited instruction.' },
    { output: true },
);
assert.equal(preservedEdited.templates.output, 'My edited instruction.');
assert.equal(preservedEdited.modified.output, true);

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
settings.customTranslatorEnabled = true;
settings.customTranslatorModified = { ...Object.fromEntries(definitions.map(key => [key, false])) };
settings.customTranslatorTemplates.output = 'Visible bundled text that must not replace the dynamic prompt.';
assert.equal(
    api.applyCustomTranslatorPrompt('DYNAMIC BUILT-IN PROMPT', {
        stage: 'output-translation',
        customTargetSegments: targets,
    }),
    'DYNAMIC BUILT-IN PROMPT',
    'displayed but unedited bundled text keeps the dynamic built-in prompt',
);
settings.customTranslatorModified.output = true;
assert.match(
    api.applyCustomTranslatorPrompt('DYNAMIC BUILT-IN PROMPT', {
        stage: 'output-translation',
        customTargetSegments: targets,
    }),
    /Visible bundled text that must not replace the dynamic prompt/,
    'editing the field activates complete prompt replacement',
);
settings.chuseokGalbwaeScope = 'all';
settings.customTranslatorTemplates.output = 'CUSTOM TRANSLATOR MUST NOT APPEAR';
const exclusiveGalbwae = api.applyCustomTranslatorPrompt('OLD DEFAULT MUST NOT APPEAR', {
    stage: 'output-translation',
    customTargetSegments: targets,
});
assert.match(exclusiveGalbwae, /EXCLUSIVE TEMPORARY CHUSEOK GALBWAE STYLE/);
assert.match(exclusiveGalbwae, /나 알아\? → 나를 아늕랴!!/);
assert.match(exclusiveGalbwae, /씨핤, 씨핧, 샤갈, 쌱앐, 쌰갈, 시핣/);
assert.match(exclusiveGalbwae, /요→료/);
assert.match(exclusiveGalbwae, /네\/응→례/);
assert.match(exclusiveGalbwae, /NAME HANDLING ORDER — ABSOLUTE/);
assert.match(exclusiveGalbwae, /Aila→아일라, Calix→칼릭스, Atlas→아틀라스/);
assert.match(exclusiveGalbwae, /Never leave a Latin-script character name unchanged/);
assert.match(exclusiveGalbwae, /MARKDOWN IS FORMATTING, NOT A TEXT EXEMPTION/);
assert.match(exclusiveGalbwae, /PAIRED TAGS ARE AN ABSOLUTE GALBWAE EXEMPTION/);
assert.match(exclusiveGalbwae, /including Inner_Info, Info_panel, small, div and custom tags/);
assert.doesNotMatch(exclusiveGalbwae, /<div>Do you know me\?<\/div> → <div>나를 아늕랴!!<\/div>/);
assert.doesNotMatch(exclusiveGalbwae, /CUSTOM TRANSLATOR MUST NOT APPEAR|OLD DEFAULT MUST NOT APPEAR/);

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
assert.match(customTranslatorUi, /<b>기존 영어 내장 프롬프트 원문<\/b>이 표시됩니다/);
assert.match(customTranslatorUi, /실제 수정 대상인 지침 본문은 줄이지 않고 그대로 불러옵니다/);
assert.match(customTranslatorUi, /그대로 두면 실제 번역은 기존 동적 내장 프롬프트를 사용하고/);
assert.match(customTranslatorUi, /내용을 편집하면 그 항목만 커스텀 지침으로 전환되어 기존 프롬프트를 완전히 대체/);
assert.match(customTranslatorUi, /원문 데이터와 잠긴 JSON 응답 계약처럼 실행할 때 자동으로 붙는 부분만 제외하고/);
assert.match(customTranslatorUi, /내장 기본값 사용 중/);
assert.match(customTranslatorUi, /커스텀 대체 중/);
assert.match(customTranslatorUi, /data-verba-custom-translator-reset-key/);
assert.match(index, /아웃풋 번역/);
assert.match(index, /인풋 번역/);
assert.match(index, /선택 재번역/);
assert.doesNotMatch(index, /label: '채팅 번역'/);
assert.doesNotMatch(index, /label: '내가 보내는 글'/);
assert.match(customTranslatorUi, /new Set\(\['output', 'input', 'selection', 'flavor'\]\)/);
assert.match(customTranslatorUi, /일반 사용자용/);
assert.match(customTranslatorUi, /class="verba-custom-translator-advanced"/);
assert.match(customTranslatorUi, /<summary>고급 내부 항목 <small>내부 처리용 · 수정 비추천<\/small><\/summary>/);
assert.doesNotMatch(customTranslatorUi, /<details class="verba-custom-translator-advanced" open/);
assert.match(index, /bindPromptExpandEditors\(panel\);\s*syncCustomTranslatorControls\(panel\);/);
assert.match(index, /target\.matches\('\[data-verba-custom-translator-key\]'\)[\s\S]*?normalizeCustomTranslatorInstruction\(target\.value\)[\s\S]*?saveSettings\(\)/);
assert.match(index, /customTranslatorModified\[key\] = instruction !== DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES\[key\]/);
assert.match(index, /const outgoingPrompt = applyCustomTranslatorPrompt\(prompt, options\)/);
assert.match(index, /customTargetSegments: pending/);

console.log('PASS: custom translator displays full original built-in prompt bodies, preserves automatic source data, and keeps locked response contracts.');
