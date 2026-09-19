import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createOutputTiming, outputTimingText } from '../timing.js';
import { outputSplitCount, createSplitRequestQueue } from '../output-splitting.js';
import { minimalOutputEnabled, translateMinimalOutput } from '../minimal-output.js';
import { extractResponseText, parseSegmentResponse, segmentSource } from '../core.js';
import { rememberRequestError, readErrorResponse } from '../diagnostics.js';
import { collectSegmentResponse } from '../response-parser.js';

let time = 0;
const recorder = createOutputTiming({ now: () => time, date: () => '2026-09-14T00:00:00Z' });
assert.equal(recorder.begin(), null);
recorder.setEnabled(true);
const begin = () => recorder.begin({ slot: 'A', mode: '미친압축' });
const enqueue = (job, stage = 'output-translation', extra = {}) => recorder.enqueue(job, { stage, profileSlot: 'A', ...extra });
const job = begin();
time = 100;
const first = enqueue(job);
time = 500; recorder.sent(job, first);
time = 51700; recorder.received(job, first); recorder.settled(job, first, '응답 수신');
const repair = enqueue(job, 'untranslated-repair:other_dialogue');
recorder.sent(job, repair);
time = 76400; recorder.received(job, repair); recorder.settled(job, repair, '응답 수신');
recorder.applying(job);
time = 76600; recorder.finish(job, '완료');
let r = recorder.latest();
assert.equal(r.totalMs, 76600);
assert.deepEqual(r.counts, { total: 2, repair: 1, retry: 0, aux: 0 });
assert.equal(r.durations.primary, 51200); assert.equal(r.durations.repair, 24700);
assert.equal(r.durations.queue, 400); assert.equal(r.durations.other, 100); assert.equal(r.durations.apply, 200);
assert.match(outputTimingText(r), /미번역 복구/);
assert.equal(Object.values(r.durations).reduce((a, b) => a + b), r.totalMs);

// Overlap is not double-counted; row durations remain individually useful.
time = 0;
const parallel = begin();
const a = enqueue(parallel), b = enqueue(parallel, 'output-translation:other_dialogue');
time = 10; recorder.sent(parallel, a);
time = 20; recorder.sent(parallel, b);
time = 60; recorder.received(parallel, a);
time = 100; recorder.received(parallel, b); recorder.finish(parallel, '완료');
r = recorder.latest();
assert.equal(r.durations.primary, 90); assert.equal(r.durations.queue, 10);
assert.equal(r.rows.reduce((n, row) => n + row.responseMs, 0), 130);
assert.equal(Object.values(r.durations).reduce((x, y) => x + y), 100);

// Turning OFF invalidates in-flight traces; turning ON cannot resurrect them.
const invalidated = begin(); const pending = enqueue(invalidated);
recorder.sent(invalidated, pending);
recorder.setEnabled(false); recorder.setEnabled(true);
recorder.received(invalidated, pending); recorder.finish(invalidated, '완료');
assert.equal(recorder.latest(), null);
const older = begin(), newer = begin();
time += 10; recorder.finish(newer, '완료'); const newestRecord = recorder.latest();
time += 10; recorder.finish(older, '취소·전환'); assert.equal(recorder.latest(), newestRecord);
assert.equal(recorder.enqueue(null, { stage: 'input-translation' }), null);

// Real request / transport retry / segment parse retry implementations, fake provider + clock.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => index.slice(index.indexOf(start), index.indexOf(end, index.indexOf(start)));
let provider = async () => ({ content: 'ok' });
let queue = execute => execute();
let parallelQueue = execute => execute();
let splitQueue = createSplitRequestQueue(3);
let fallbacks = [];
const env = {
    outputTiming: recorder, settings: { debugMode: true, profileId: 'a', timeoutSeconds: 20 },
    profileSlotForId: () => 'A', profileList: () => [{ id: 'a' }, { id: 'b' }],
    performance: { now: () => time }, AbortController, Promise, setTimeout, clearTimeout, VERBA_MAX_TOKENS: 1000,
    liveContext: () => ({ ConnectionManagerRequestService: { sendRequest: (...args) => provider(...args) } }),
    enqueueRequest: execute => queue(execute), enqueueScopedParallelRequest: execute => parallelQueue(execute), enqueueSplitOutputRequest: execute => splitQueue(execute),
    extractResponseText, parseSegmentResponse, rememberRequestError, readErrorResponse,
    collectSegmentResponse, recordSegmentRecovery: () => null, finishSegmentRecovery: () => {},
    recordProfileAttempt: () => {}, abortError: () => new DOMException('cancel', 'AbortError'),
    isAbort: (e, signal) => signal?.aborted || e.name === 'AbortError',
    configuredProfileCycle: () => ({ active: 'a', slot: 'A', fallbacks }),
    fallbackEligibleError: () => true, transientError: () => false, retryAfterMs: () => 0,
    errorText: e => e.message, profileDisplayName: id => id, notifyFallbackUsed: () => {},
    serverRetryStates: new Map(), updateServerRetryIndicator: () => {},
    wait: async ms => { time += ms; }, console: { warn() {} },
};
const functions = slice('async function sendProfileRequest(', 'function fallbackEligibleError(')
    + slice('async function sendWithRetry(', 'async function requestSelectionCandidates(');
const api = Function(...Object.keys(env), functions + '\nreturn { sendProfileRequest, sendWithRetry, requestSegments };')(...Object.values(env));
const success = { content: JSON.stringify({ segments: [{ id: 's1', translation: '번역' }] }) };
const expected = [{ id: 's1', type: 'narration', text: 'source' }];
time = 0;
const parseJob = begin(); let calls = 0;
provider = async () => { time += 100; return ++calls === 1 ? { content: 'invalid JSON' } : success; };
assert.equal((await api.requestSegments('PRIVATE_PROMPT', expected, { timing: parseJob, stage: 'output-translation' })).get('s1'), '번역');
recorder.finish(parseJob, '완료'); r = recorder.latest();
assert.equal(calls, 2); assert.equal(r.counts.retry, 1); assert.equal(r.durations.backoff, 500);
assert.equal(r.totalMs, 700); assert.match(outputTimingText(r), /응답 형식·구간 누락 재시도/);
assert.ok(!JSON.stringify(r).includes('PRIVATE_PROMPT'));

time = 0; calls = 0; const retryJob = begin();
provider = async () => { time += 100; if (++calls === 1) throw new Error('503'); return success; };
await api.sendWithRetry('private', { timing: retryJob, stage: 'output-translation' });
recorder.finish(retryJob, '완료'); r = recorder.latest();
assert.equal(r.counts.total, 2); assert.equal(r.counts.retry, 1); assert.equal(r.durations.backoff, 800);
assert.equal(r.rows[0].status, '오류'); assert.equal(r.rows[1].reason, '요청 오류 재시도');

time = 0; calls = 0; fallbacks = [{ id: 'b', slot: 'B' }]; const fallbackJob = begin();
provider = async () => { time += 100; if (++calls === 1) throw new Error('503'); return success; };
await api.sendWithRetry('private', { timing: fallbackJob, stage: 'output-translation' });
recorder.finish(fallbackJob, '완료'); r = recorder.latest();
assert.equal(r.counts.total, 2); assert.equal(r.rows[1].slot, 'B'); assert.equal(r.rows[1].reason, '대체 프로필');
fallbacks = [];

// Minimal split -> real segment parser -> transport -> real shared parallel queue.
// The serial queue would fail this test: both provider calls must start together.
const actualParallelQueue = Function(`
const SCOPED_PARALLEL_REQUEST_LIMIT = 2;
const scopedParallelRequestQueue = [];
let scopedParallelRequestActive = 0;
${slice('function drainScopedParallelRequestQueue(', 'async function runWithConcurrency(')}
return enqueueScopedParallelRequest;
`)();
parallelQueue = actualParallelQueue;
queue = () => { throw Error('minimal halves must not use serial queue'); };
const splitSource = segmentSource('First paragraph.\n\nSecond paragraph.');
const minimalSettings = { developerMode: true, developerOutputSplitCount: 2, developerMinimalPrompt: '자연스럽게 한국어로 번역하라.' };
let deliveries = [];
provider = async (_profile, messages) => {
    const targets = JSON.parse(messages[0].content.split('TARGETS\n')[1]);
    return new Promise(resolve => deliveries.push(() => resolve({content:JSON.stringify({segments:targets.map(s=>({id:s.id,translation:`번역 ${s.id}`}))})})));
};
time = 0;
const splitJob = recorder.begin({slot:'A',mode:'최소 프롬프트'});
const splitWork = translateMinimalOutput(splitSource,minimalSettings,{timing:splitJob}, {requestSegments:api.requestSegments,buildSourceMap:()=>[]});
await new Promise(resolve => setImmediate(resolve));
assert.equal(deliveries.length,2);
time=100;deliveries[1]();await new Promise(resolve=>setImmediate(resolve));
time=200;deliveries[0]();await splitWork;recorder.finish(splitJob,'완료');
r=recorder.latest();assert.equal(r.counts.total,2);assert.equal(r.durations.primary,200);
assert.equal(r.rows.reduce((sum,row)=>sum+row.responseMs,0),300);
assert.match(outputTimingText(r),/본 번역 \(1\/2\)/);
assert.match(outputTimingText(r),/본 번역 \(2\/2\)/);
// Three-part transport actually starts all three, with correct diagnostics.
const thirdSource=segmentSource('First part.\n\nSecond part.\n\nThird part.');
time=0;deliveries=[];
const tripleJob=recorder.begin({slot:'A',mode:'최소 프롬프트',splitCount:3});
const tripleWork=translateMinimalOutput(thirdSource,{...minimalSettings,developerOutputSplitCount:3},{timing:tripleJob},{requestSegments:api.requestSegments,buildSourceMap:()=>[]});
await new Promise(resolve=>setImmediate(resolve));assert.equal(deliveries.length,3);
time=100;deliveries[2]();time=200;deliveries[1]();time=300;deliveries[0]();
await tripleWork;recorder.finish(tripleJob,'완료');
assert.equal(recorder.latest().counts.total,3);assert.equal(recorder.latest().durations.primary,300);
const tripleLog=outputTimingText(recorder.latest());assert.match(tripleLog,/최소 프롬프트 · 3분할/);
for(const i of [1,2,3])assert.ok(tripleLog.includes(`본 번역 (${i}/3)`));
// Bad JSON in half 1 retries only half 1; half 2's result is reused.
let halfCalls = [0,0];
provider=async(_profile,messages)=>{
 const targets=JSON.parse(messages[0].content.split('TARGETS\n')[1].split('\n\nRetry ')[0]);
 const half=targets[0].id===splitSource.segments[0].id?0:1;
 halfCalls[half]++;time+=10;
 if(half===0&&halfCalls[half]===1)return {content:'bad JSON'};
 return {content:JSON.stringify({segments:targets.map(s=>({id:s.id,translation:`번역 ${s.id}`}))})};
};
const splitRetryJob=recorder.begin({slot:'A',mode:'최소 프롬프트'});
await translateMinimalOutput(splitSource,minimalSettings,{timing:splitRetryJob},{requestSegments:api.requestSegments,buildSourceMap:()=>[]});
recorder.finish(splitRetryJob,'완료');assert.deepEqual(halfCalls,[2,1]);
assert.equal(recorder.latest().counts.retry,1);
queue=execute=>execute();parallelQueue=execute=>execute();

// Cancel queued request; it must never be counted as a sent AI request later.
time = 0; const cancelled = begin(); let queued;
queue = execute => new Promise((resolve, reject) => { queued = () => execute().then(resolve, reject); });
const ctrl = new AbortController();
const waiting = api.sendProfileRequest('private', { timing: cancelled, stage: 'output-translation', signal: ctrl.signal });
time = 100; ctrl.abort(); await assert.rejects(waiting, e => e.name === 'AbortError');
recorder.finish(cancelled, '취소·전환'); r = recorder.latest();
assert.equal(r.counts.total, 0); assert.equal(r.durations.queue, 100);
await queued(); assert.equal(recorder.latest().counts.total, 0);

// Provider ignores abort; Verba still records elapsed time and exits immediately.
queue = execute => execute(); time = 0; const active = begin();
provider = () => new Promise(() => {});
const activeCtrl = new AbortController();
const working = api.sendProfileRequest('private', { timing: active, stage: 'output-translation', signal: activeCtrl.signal });
await new Promise(resolve => setImmediate(resolve)); time = 200; activeCtrl.abort();
await assert.rejects(working, e => e.name === 'AbortError'); recorder.finish(active, '취소·전환');
assert.equal(recorder.latest().counts.total, 1); assert.equal(recorder.latest().durations.primary, 200);

// No timing handle for inputs/connection tests: cannot change the last output result.
const before = recorder.latest(); provider = async () => success;
await api.sendProfileRequest('private', { stage: 'input-translation' });
assert.equal(recorder.latest(), before);

// Real output-job lifecycle: automatic/full retranslation, application failure, and debug OFF.
const message = { is_user: false, mes: 'source' };
const context = { chat: [message] };
let applied = true;
let seenTrace;
const lifecycleEnv = {
    minimalOutputEnabled, outputSplitCount,
    EXTENSION_KEY: 'verba',
    isTranslationExtensionActive: () => true,
    activateTranslationExtension: () => 'verba',
    settings: env.settings, outputTiming: recorder, performance: env.performance, AbortController,
    liveContext: () => context, isNameReplacementMessage: () => true, messageSource: m => m?.mes || '',
    isPredominantlyKorean: () => false, hasForeignText: () => true, currentRecord: () => null,
    failedOutputSignatures: new Map(), pendingOutputs: new Map(), activeProfileSlot: () => 'A',
    hashText: v => v, currentSwipeId: () => 0, showProgress: () => null,
    clearProgress: () => {}, notify: () => {}, recentDialogueEndingRepeatHints: () => [], outputSpeakerIdentity: () => ({}),
    translateOutputText: async (_source, options) => {
        seenTrace = options.timing;
        await api.sendProfileRequest('private', options);
        return { translation: '번역', sourceMap: [] };
    },
    translationWithLockedSegments: v => v,
    applyTranslation: () => { time += 20; return { renderResult: { status: applied ? 'applied' : 'failed' } }; },
    clearTransientTranslationSelections: () => {}, refreshRetranslateButton: () => {}, renderOutputTiming: () => {},
    recordOutputTranslation: () => {}, isAbort: env.isAbort, reportError: () => {}, console: { info() {}, warn() {}, error() {} },
};
const translate = Function(...Object.keys(lifecycleEnv), slice('async function translateMessage(', 'function latestAssistantMessage(') + '\nreturn translateMessage;')(...Object.values(lifecycleEnv));
for (const force of [false, true]) {
    provider = async () => { time += 100; return success; };
    assert.equal(await translate(0, { force, automatic: !force }), true);
    assert.ok(seenTrace); assert.equal(recorder.latest().retranslation, force);
    assert.equal(recorder.latest().counts.total, 1); assert.equal(recorder.latest().durations.primary, 100);
    assert.equal(recorder.latest().durations.apply, 20); assert.equal(recorder.latest().status, '완료');
}
// Preserve the selected mode through the REAL recorder, summary and rendered log.
// Minimal wins over compression only while the developer gate is open.
for (const [developerMode, minimal, compressed, extreme, expectedMode] of [
    [true, true, false, false, '최소 프롬프트'],
    [true, true, true, true, '최소 프롬프트'],
    [false, true, true, true, '일반'],
    [true, false, true, false, '압축'],
    [true, false, true, true, '미친압축'],
    [true, false, false, false, '일반'],
]) {
    Object.assign(env.settings, { developerMode, developerMinimalPromptEnabled: minimal,
        developerCompressedPromptEnabled: compressed, developerExtremeCompressedPromptEnabled: extreme });
    for (const force of [false, true]) {
        await translate(0, { force, automatic: !force });
        assert.equal(seenTrace.mode, expectedMode);
        assert.equal(recorder.latest().mode, expectedMode);
        assert.ok(outputTimingText(recorder.latest()).includes(`프로필 A · ${expectedMode}\n`));
    }
}
Object.assign(env.settings, { developerMode: true, developerMinimalPromptEnabled: true });
applied = false; assert.equal(await translate(0, {}), undefined);
assert.equal(recorder.latest().status, '실패');
recorder.setEnabled(false); applied = true;
assert.equal(await translate(0, {}), true); assert.equal(seenTrace, null); assert.equal(recorder.latest(), null);

// Real debug UI handlers: copy one record, clear on OFF, do not resurrect on ON.
recorder.setEnabled(true); await translate(0, {});
const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, { handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } });
    return elements.get(id);
};
let copied = '';
const uiEnv = {
    settings: env.settings, outputTiming: recorder, outputTimingText,
    document: { querySelector: element }, panel: { querySelector: element },
    saveSettings: () => {}, notify: () => {}, copyText: async v => { copied = v; },
    copyDebugDiagnostic: async () => {}, EXTENSION_VERSION: 'test', console,
};
const uiBody = 'let lastDebugDiagnostic = null;\n'
    + slice('function renderOutputTiming(', 'function storeDebugDiagnostic(')
    + slice('    const debugModeInput = panel.querySelector', "    panel.querySelector('#verba-reset-profile-stats')")
    + '\nrenderOutputTiming();';
Function(...Object.keys(uiEnv), uiBody)(...Object.values(uiEnv));
assert.match(element('#verba-output-timing').textContent, /AI 요청: 1회/);
assert.equal(element('#verba-copy-output-timing').disabled, false);
await element('#verba-copy-output-timing').handlers.click();
assert.match(copied, /프로필 A · 최소 프롬프트/);
assert.match(copied, /베르바 vtest/); assert.ok(!copied.includes('private'));
element('#verba-debug-mode').handlers.change({ target: { checked: false } });
assert.equal(recorder.latest(), null); assert.equal(element('#verba-copy-output-timing').disabled, true);
copied = ''; await element('#verba-copy-output-timing').handlers.click(); assert.equal(copied, '');
element('#verba-debug-mode').handlers.change({ target: { checked: true } });
assert.equal(recorder.latest(), null);
console.log('PASS: output timing accounting, parallel overlap, OFF/reset, newest-job isolation, real request/parse/transport retry/fallback paths, queued/active cancellation; simulated provider only.');
