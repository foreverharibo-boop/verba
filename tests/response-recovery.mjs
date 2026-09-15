import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectSegmentResponse, repairUnexpectedProseBreaks } from '../response-parser.js';
import { parseSegmentResponse, extractResponseText, segmentSource, assembleTranslation, restoreProtected } from '../core.js';
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

// Leading zeros only: unique request/response correspondence, never positional repair.
const paddedTargets = [{ id: 'seg_0000' }, { id: 'seg_0001' }, { id: 'seg_0002' }];
const encode = segments => JSON.stringify({ segments });
const paddedRows = [
    { id: 'seg_0002', translation: '마지막' },
    { id: 'seg_001', translation: '내용 @@VERBA_NAME_0000@@ ... 그대로' },
    { id: 'seg_0000', translation: '처음' },
];
const paddingResponse = encode(paddedRows);
r = collectSegmentResponse(paddingResponse, paddedTargets);
assert.equal(r.parseError, null);
assert.equal(r.partial.get('seg_0001'), paddedRows[1].translation);
assert.deepEqual(r.repairs, ['구간 ID 앞자리 0 보정: seg_001 → seg_0001']);
for (const id of ['seg_1', 'seg_01', 'seg_00001']) {
    assert.equal(collectSegmentResponse(encode([{ id, translation: '유지' }]), [paddedTargets[1]]).partial.get('seg_0001'), '유지');
}
assert.equal(collectSegmentResponse(encode([{ id: 'seg_0', translation: '영' }]), [paddedTargets[0]]).partial.get('seg_0000'), '영');
for (const id of ['seg_10', 'SEG_001', 'seg_+1', 'seg_1.0', 'seg_1e0', 'seg_001 ', 'other_001', 'seg_9007199254740993']) {
    r = collectSegmentResponse(encode([{ id, translation: '잘못 붙이면 안 됨' }]), [paddedTargets[1]]);
    assert.ok(r.parseError, id); assert.equal(r.partial.size, 0, id);
}
for (const extraId of ['seg_0001', 'seg_01', 'seg_001']) {
    r = collectSegmentResponse(encode([...paddedRows, { id: extraId, translation: paddedRows[1].translation }]), paddedTargets);
    assert.deepEqual(r.missingIds, ['seg_0001']); assert.equal(r.partial.size, 2);
    assert.equal(r.repairs.length, 0);
}
r = collectSegmentResponse(encode([{ id: 'seg_1', translation: '모호함' }]), [{ id: 'seg_01' }, { id: 'seg_001' }]);
assert.equal(r.partial.size, 0); assert.equal(r.missingIds.length, 2);
for (const translation of ['', ' ', null, 123]) {
    r = collectSegmentResponse(encode([{ id: 'seg_001', translation }]), [paddedTargets[1]]);
    assert.ok(r.parseError); assert.equal(r.repairs.length, 0);
}
assert.equal(parseSegmentResponse(paddingResponse, paddedTargets).get('seg_0001'), paddedRows[1].translation);

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

for (const debugMode of [true, false]) {
    settings.debugMode = debugMode; log.clear(); calls = []; waits = 0;
    responses = [paddingResponse];
    translated = await request('prompt', paddedTargets, { stage: 'output-translation' });
    assert.equal(calls.length, 1); assert.equal(waits, 0);
    assert.equal(translated.get('seg_0001'), paddedRows[1].translation);
    if (debugMode) {
        assert.equal(log.latest().recovery.status, '로컬 복구 완료');
        assert.match(log.latest().recovery.localRepairs.join(), /seg_001 → seg_0001/);
    } else assert.equal(log.latest(), null);
}
settings.debugMode = true;
calls = []; waits = 0;
responses = [encode([...paddedRows, { id: 'seg_0001', translation: '충돌' }]), encode([{ id: 'seg_0001', translation: '재요청 결과' }])];
translated = await request('prompt', paddedTargets, {});
assert.equal(calls.length, 2); assert.equal(waits, 1);
assert.match(calls[1].prompt, /STILL-MISSING IDS: \["seg_0001"\]/);
assert.equal(translated.get('seg_0001'), '재요청 결과');
assert.equal(translated.get('seg_0000'), '처음');
waits = 0;

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


// Blank-line cleanup is local, scoped to single-line prose, and idempotent.
const prose = { id: 'seg_0000', type: 'narration', text: 'She could hardly believe it.' };
const breakCases = [
    ['믿을\n\n 수 없었다.', '믿을 수 없었다.'],
    ['머리\n\n 위였다.', '머리 위였다.'],
    ['엎질\n\n러진 커피였다.', '엎질러진 커피였다.'],
    ['그러\r\n\r\n셨어요?', '그러셨어요?'],
    ['믿을 \n\n수 없었다.', '믿을 수 없었다.'],
    ['그의 말.\n\n그녀의 대답.', '그의 말.\n\n그녀의 대답.'],
    ['한 줄\n다음 줄', '한 줄\n다음 줄'],
    ['문자 그대로 \\n\\n 표시', '문자 그대로 \\n\\n 표시'],
];
for (const [before, after] of breakCases) {
    assert.equal(repairUnexpectedProseBreaks(before, prose), after);
    assert.equal(repairUnexpectedProseBreaks(after, prose), after);
    for (const wire of [encode([{ id: prose.id, translation: before }]),
        encode([{ id: prose.id, translation: before }]).replaceAll('\\n', '\n').replaceAll('\\r', '\r')]) {
        // Literal backslash text is checked above; do not corrupt its escaping here.
        if (before.includes('\\')) continue;
        const parsed = collectSegmentResponse(wire, [prose]);
        assert.equal(parsed.parseError, null);
        assert.equal(parsed.partial.get(prose.id), after);
    }
}
for (const type of ['tagged_content', 'user_input', 'name_match', 'role_term']) {
    assert.equal(repairUnexpectedProseBreaks('믿을\n\n 수', { ...prose, type }), '믿을\n\n 수');
}
assert.equal(repairUnexpectedProseBreaks('믿을\n\n 수', { ...prose, text: 'First\nSecond' }), '믿을\n\n 수');
for (const text of ['`믿을\n\n 수`', '```text\n믿을\n\n 수\n```', '<div>믿을\n\n 수</div>']) {
    assert.equal(repairUnexpectedProseBreaks(text, prose), text);
}
for (const debugMode of [true, false]) {
    settings.debugMode = debugMode; log.clear(); calls = []; waits = 0;
    responses = [encode([{ id: prose.id, translation: '믿을\n\n 수 없었다.' }])];
    const result = await request('unchanged prompt', [prose], { stage: 'output-translation' });
    assert.equal(result.get(prose.id), '믿을 수 없었다.');
    assert.equal(calls.length, 1); assert.equal(waits, 0);
    if (debugMode) assert.match(log.latest().recovery.localRepairs.join(), /한글 사이 빈줄 제거/);
    else assert.equal(log.latest(), null);
}
// Assembly also cleans later-pass text before building offsets. Protected blocks
// and original paragraph gaps survive byte for byte.
const source = 'She spilled coffee.\n\n`Keep this English.`\n\n```js\nconst x = "Keep";\n\n// code\n```\n\nHe replied.';
const segmented = segmentSource(source);
const translations = new Map(segmented.segments.map((s, i) => [s.id, i ? '그러\n\n셨어요?' : '엎질\n\n러진 커피였다.']));
const assembled = assembleTranslation(segmented, translations);
assert.equal(assembled, '엎질러진 커피였다.\n\n`Keep this English.`\n\n```js\nconst x = "Keep";\n\n// code\n```\n\n그러셨어요?');
const mapBuilder = Function('restoreProtected', 'repairKoreanParticleAlternatives',
    slice('function restoredSegmentText(', 'const CONSISTENCY_ROLE_TERMS') + '\nreturn buildSourceMap;')(restoreProtected, value => value); // No particle alternatives in this fixture.
const sourceMap = mapBuilder(segmented, translations, assembled);
assert.equal(sourceMap.length, segmented.segments.length);
for (const entry of sourceMap) {
    assert.equal(assembled.slice(entry.start, entry.end), translations.get(entry.id));
    assert.equal(entry.source, segmented.segments.find(s => s.id === entry.id).text);
}
console.log('PASS: unexpected prose blank lines, protected layout, source-map offsets and one-call cleanup with debug ON/OFF.');
