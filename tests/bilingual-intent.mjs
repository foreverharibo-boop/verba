import assert from 'node:assert/strict';
import {
    classifyBilingualIntent,
    bilingualPromptRequestsOutput,
    bilingualPromptsNeedingVerdict,
    resolveBilingualIntent,
    clearBilingualPromptVerdicts,
    buildBilingualVerdictPrompt,
} from '../bilingual-intent.js';
import { ensureBilingualDialogueFormat, normalizeBilingualMappedTranslation } from '../core.js';

const ON = [
    '한영병기로 출력해',
    '한영 병기',
    '대사 영어 원문과 한국어 번역을 함께 출력해줘',
    '원문 먼저, 그 뒤 괄호 안에 한국어 번역을 넣어줘.',
    'For dialogue, keep original English with Korean translation.',
    'Output both the original English and Korean dialogue.',
    'Bilingual output for dialogue, Korean only for narration.',
    'Korean only narration, bilingual dialogue required.',
    '한영병기하되 괄호 없이 원문과 한국어를 나란히 출력해.',
];
const OFF = [
    'Preserve the original meaning and tone in natural Korean.',
    'Keep the original meaning, but write only in Korean.',
    '영어 원문의 감정과 말투를 먼저 분석해서 자연스럽게 한국어로 번역해줘.',
    '한영병기는 싫어.',
    '한영병기 피해서 한국어로 번역해.',
    '한영병기는 선택사항이야.',
    'Bilingual output is optional.',
    'This character is bilingual and speaks both languages.',
    'Use bilingual only for narration.',
    'Do not show English and Korean together.',
    '원문과 한국어 번역을 함께 보여주지 마세요.',
];
for (const prompt of ON) assert.equal(classifyBilingualIntent(prompt), 'on', prompt);
for (const prompt of OFF) assert.equal(classifyBilingualIntent(prompt), 'off', prompt);
assert.equal(classifyBilingualIntent('Bilingual.'), 'uncertain');
assert.equal(classifyBilingualIntent('The template supports bilingual dialogue.'), 'uncertain');

clearBilingualPromptVerdicts();
const weak = 'Bilingual.';
assert.deepEqual(bilingualPromptsNeedingVerdict({ globalPrompt: weak, allDialoguePrompt: weak }), [weak]);
assert.deepEqual(bilingualPromptsNeedingVerdict({ globalPrompt: weak, globalPromptEnabled: false }), []);
assert.equal(bilingualPromptRequestsOutput(weak), false);
let calls = 0;
const ask = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return true; };
assert.deepEqual(await Promise.all([resolveBilingualIntent(weak, ask), resolveBilingualIntent(weak, ask)]), [true,true]);
assert.equal(calls, 1);
assert.equal(bilingualPromptRequestsOutput(weak), true);
await resolveBilingualIntent(weak, ask);
assert.equal(calls, 1, 'cached verdict should avoid another provider call');

clearBilingualPromptVerdicts();
calls = 0;
const oldWarn = console.warn;
console.warn = () => {};
try {
    assert.equal(await resolveBilingualIntent(weak, async () => { calls += 1; throw new Error('429'); }), false);
    assert.equal(await resolveBilingualIntent(weak, ask), false, 'failed check should cool down');
} finally {
    console.warn = oldWarn;
}
assert.equal(calls, 1);
clearBilingualPromptVerdicts();
const controller = new AbortController();
const promise = resolveBilingualIntent(weak, async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return true;
}, controller.signal);
controller.abort();
await assert.rejects(promise, { name: 'AbortError' });
assert.equal(bilingualPromptRequestsOutput(weak), false);
assert.ok(buildBilingualVerdictPrompt({ prompt: weak }).includes('bilingual_0000'));

const deniedBilingual = [
    '한영병기 요청 안 함.',
    '한영병기 요청안함',
    '한영병기 요청 안했어',
    '한영병기 요청한 적 없어.',
    '한영병기 요청은 안 했어.',
    '한영병기 시킨 적 없는데요.',
    '한영병기 시키지 마세요.',
    'Bilingual dialogue should not be used.',
    'Bilingual output is not requested.',
    "Bilingual dialogue shouldn't be used.",
    "Bilingual formatting wasn't requested.",
    'Bilingual output should be avoided.',
];
for (const prompt of deniedBilingual) assert.equal(classifyBilingualIntent(prompt), 'off', prompt);
const explicitlyAllowed = [
    '한영병기로 출력해',
    '한영병기하되 괄호 없이 원문과 한국어를 나란히 출력해.',
    'Bilingual dialogue is mandatory.',
    'Do not output bilingual narration. For dialogue, always show bilingual output.',
];
for (const prompt of explicitlyAllowed) assert.equal(classifyBilingualIntent(prompt), 'on', prompt);

// With bilingual OFF, never reconstruct source English, even if the model
// already returned a bilingual-looking output. Don't strip the model's text.
const sampleDialogue = { type: 'dialogue_candidate', text: '"Hello."' };
const koreanOnly = { globalPrompt: '한영병기 요청 안 함.' };
const modelTranslation = '"안녕."';
const modelBilingual = '"Hello. (안녕.)"';
assert.equal(ensureBilingualDialogueFormat(sampleDialogue, modelTranslation, koreanOnly), modelTranslation);
assert.equal(ensureBilingualDialogueFormat(sampleDialogue, modelBilingual, koreanOnly), modelBilingual);
assert.equal(ensureBilingualDialogueFormat(sampleDialogue, modelTranslation, {
    globalPrompt: '한영병기로 출력해',
    globalPromptEnabled: false,
}), modelTranslation);
assert.equal(ensureBilingualDialogueFormat(sampleDialogue, modelTranslation, {
    globalPrompt: '한영병기로 출력해',
}), modelBilingual);
assert.equal(ensureBilingualDialogueFormat(sampleDialogue, modelBilingual, {
    globalPrompt: '한영병기로 출력해',
}), modelBilingual);
assert.equal(ensureBilingualDialogueFormat({ type: 'narration', text: 'Hello.' }, modelTranslation, {
    globalPrompt: '한영병기로 출력해',
}), modelTranslation);
assert.equal(normalizeBilingualMappedTranslation(modelBilingual, [{
    id: 'seg_0000', source: sampleDialogue.text, start: 0, end: modelBilingual.length,
}], koreanOnly, sampleDialogue.text).translation, modelBilingual);

console.log('PASS bilingual intent regression + safe assembly gate + AI fallback');
