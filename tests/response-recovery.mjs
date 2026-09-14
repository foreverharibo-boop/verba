import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectSegmentResponse } from '../response-parser.js';
import { parseSegmentResponse, extractResponseText } from '../core.js';
import { rememberRequestError, debugErrorChain, sanitizeDebugValue } from '../diagnostics.js';

const targets = [{ id: 's1' }, { id: 's2' }];
const valid = JSON.stringify({ segments: [{ id: 's1', translation: '번역 하나' }, { id: 's2', translation: '번역 둘' }] });
for (const text of [valid, '```json\n' + valid + '\n```', 'Here is JSON:\n' + valid + '\nEnd.']) {
    const result = collectSegmentResponse(text, targets);
    assert.equal(result.parseError, null); assert.equal(result.partial.get('s1'), '번역 하나');
    assert.equal(result.repairs.length, 0);
}
const controls = '{"segments":[{"id":"s1","translation":"한 줄\n두 줄\t탭\r리턴"},]}';
let r = collectSegmentResponse(controls, [targets[0]]);
assert.equal(r.parseError, null); assert.equal(r.partial.get('s1'), '한 줄\n두 줄\t탭\r리턴');
assert.equal(r.repairs.length, 2);
const literal = '문자열 ,} ,] 와 "따옴표" 그리고 \\n 이스케이프, {"id":"s2","translation":"가짜"}';
const nested = JSON.stringify({ segments: [{ id: 's1', translation: literal }] }).replace(/\}\]\}$/, '},]}');
assert.equal(collectSegmentResponse(nested, [targets[0]]).partial.get('s1'), literal);
const cut = '{"segments":[{"id":"s1","translation":"완성"},{"id":"s2","translation":"잘린';
r = collectSegmentResponse(cut, targets);
assert.deepEqual([...r.partial], [['s1', '완성']]); assert.deepEqual(r.missingIds, ['s2']);
assert.ok(r.parseError); assert.match(r.repairs.join(), /완성된 구간/);
assert.throws(() => parseSegmentResponse(cut, targets), /s2/);
assert.equal(parseSegmentResponse(cut, [targets[0]]).get('s1'), '완성');
const missingBraces = '{"segments":[{"id":"s1","translation":"완성"}';
assert.equal(collectSegmentResponse(missingBraces, [targets[0]]).partial.get('s1'), '완성');

for (const bad of [
    '{"segments":[{"id":"s1","translation":"안쪽 "잘못된" 따옴표"}]}',
    "{'segments':[{'id':'s1','translation':'번역'}]}",
    '{"segments":[{"id":1,"translation":"번역"}]}',
    '{"segments":[{"id":"s1","translation":123}]}',
    '{"segments":[{"id":"s1","translation":" "}]}',
    '{"segments":[{"id":"wrong","translation":"번역"}]}',
    '{"translation":"번역"}',
    '그냥 번역문',
]) {
    const result = collectSegmentResponse(bad, [targets[0]]);
    assert.equal(result.partial.size, 0, bad); assert.ok(result.parseError, bad);
}
const duplicates = JSON.stringify({ segments: [{ id: 's1', translation: '하나' }, { id: 's1', translation: '둘' }, { id: 's2', translation: '정상' }] });
r = collectSegmentResponse(duplicates, targets);
assert.deepEqual([...r.partial], [['s2', '정상']]); assert.match(r.parseError.message, /동일 구간 ID/);
assert.equal(collectSegmentResponse(duplicates.replace('둘', '하나'), targets).parseError, null);

// Actual retry loop + intermediate log helpers: local repair costs no extra AI call;
// truncated row retains completed translations and only requests missing IDs.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (a, b) => index.slice(index.indexOf(a), index.indexOf(b, index.indexOf(a)));
const settings = { debugMode: true };
const copyButton = { disabled: true };
const deps = {
    settings, document: { querySelector: () => copyButton }, rememberRequestError, sanitizeDebugValue,
    createDebugDiagnostic: (stage, error, message) => ({ stage, displayMessage: message, errorChain: debugErrorChain(error) }),
    console: { warn() {} },
};
const log = Function(...Object.keys(deps), 'let lastDebugDiagnostic = null;\n'
    + slice('function storeDebugDiagnostic(', 'function createDebugDiagnostic(')
    + '\nreturn { recordSegmentRecovery, finishSegmentRecovery, latest:()=>lastDebugDiagnostic, clear:()=>{lastDebugDiagnostic=null;} };')(...Object.values(deps));
let responses = [], calls = [], waits = 0, midway = () => {};
const requestEnv = {
    settings, collectSegmentResponse, extractResponseText,
    recordSegmentRecovery: log.recordSegmentRecovery, finishSegmentRecovery: log.finishSegmentRecovery,
    sendWithRetry: async (prompt, options) => { calls.push({ prompt, options }); midway(calls.length); return { content: responses.shift() }; },
    outputTiming: { wait: async (_job, action) => action() }, wait: async () => { waits += 1; },
    isAbort: error => error.name === 'AbortError', errorText: error => error.message, console: { warn() {} },
};
const request = Function(...Object.keys(requestEnv), slice('function collectPartialSegmentTranslations(', 'async function requestSelectionCandidates(') + '\nreturn requestSegments;')(...Object.values(requestEnv));
responses = [controls];
let translated = await request('prompt', [targets[0]], { stage: 'output-translation' });
assert.equal(calls.length, 1); assert.equal(waits, 0);
assert.equal(translated.get('s1'), '한 줄\n두 줄\t탭\r리턴');
assert.equal(log.latest().recovery.status, '로컬 복구 완료'); assert.equal(copyButton.disabled, false);
assert.ok(log.latest().errorChain[0].request.rawResponse);

calls = []; responses = [cut, JSON.stringify({ segments: [{ id: 's1', translation: '덮어쓰면 안 됨' }, { id: 's2', translation: '복구' }] })];
translated = await request('prompt', targets, { stage: 'output-retranslation' });
assert.equal(calls.length, 2); assert.equal(waits, 1);
assert.match(calls[1].prompt, /STILL-MISSING IDS: \["s2"\]/);
assert.equal(translated.get('s1'), '완성'); assert.equal(translated.get('s2'), '복구');
assert.equal(log.latest().recovery.status, '재시도로 복구 완료');
assert.deepEqual(log.latest().recovery.missingSegmentIds, ['s2']);
assert.match(log.latest().errorChain[0].request.rawResponse, /잘린/);

settings.debugMode = false; log.clear(); calls = []; responses = [controls];
await request('prompt', [targets[0]], {}); assert.equal(log.latest(), null); assert.equal(calls.length, 1);
settings.debugMode = true; calls = []; responses = [cut, valid];
midway = n => { if (n === 2) { settings.debugMode = false; log.clear(); settings.debugMode = true; } };
await request('prompt', targets, {}); assert.equal(log.latest(), null, 'successful retry must not resurrect cleared log');
midway = () => {}; calls = []; responses = Array(6).fill('{broken');
await assert.rejects(request('prompt', targets, {}), e => e.missingSegments.length === 2 && e.partialTranslations.size === 0);
assert.equal(calls.length, 6);
assert.equal(log.latest().recovery.status, '재시도 종료·미복구');
console.log('PASS: safe syntax recovery, exact text preservation, truncated-row salvage, malformed/ambiguous rejection, missing-only retry, intermediate recovered logs and debug OFF/reset (mock AI).');
