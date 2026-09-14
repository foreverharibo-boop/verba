import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as diagnostics from '../diagnostics.js';
import { extractResponseText } from '../core.js';

const { sanitizeDebugValue, debugRawText, rememberRequestError, debugErrorChain, classifyDebugError, readErrorResponse } = diagnostics;
const category = error => classifyDebugError(debugErrorChain(error)).category;
const httpError = status => Object.assign(new Error('upstream failure'), { response: { status, data: { error: { message: 'original server message' } } } });
assert.equal(category(httpError(503)), '서버 오류');
assert.equal(category(httpError(429)), '요청 한도·할당량 오류');
assert.equal(category(httpError(403)), '인증·권한 오류');
assert.equal(category(new Error('HTTP 502 Bad Gateway')), '서버 오류');
assert.equal(category(new TypeError('Failed to fetch')), '네트워크·연결 오류');
assert.equal(category(Object.assign(new Error('timeout'), { code: 'VERBA_TIMEOUT' })), '시간 초과');
assert.equal(category(Object.assign(new Error('empty'), { code: 'VERBA_RESPONSE_EMPTY' })), 'AI 빈 응답');
assert.equal(category(Object.assign(new SyntaxError('invalid JSON'), { code: 'VERBA_RESPONSE_FORMAT' })), 'AI 응답 형식·누락 오류');
assert.equal(category(new ReferenceError('missingFunction is not defined')), '베르바 실행 오류 의심');
assert.equal(category(new Error('unknown')), '원인 미확정');
const blocked = rememberRequestError(Object.assign(new Error('empty'), { code: 'VERBA_RESPONSE_EMPTY' }), {}, { candidates: [{ finishReason: 'SAFETY' }] });
assert.equal(category(blocked), '안전 필터·정책 차단');
assert.equal(category(rememberRequestError(new Error('empty'), {}, { error: { code: 503, message: 'busy' } })), '서버 오류');
const failure = rememberRequestError(httpError(503), { profileSlot: 'B', retryAttempt: 2, stage: 'output' });
const wrapped = new Error('retries exhausted', { cause: failure });
assert.equal(category(wrapped), '서버 오류');
assert.match(debugErrorChain(wrapped)[1].request.rawResponse, /original server message/);
assert.equal(debugErrorChain(wrapped)[1].request.profileSlot, 'B');
assert.equal(debugErrorChain(wrapped)[1].request.retryAttempt, 2);
failure.cause = wrapped;
assert.equal(debugErrorChain(wrapped).length, 2, 'circular causes do not hang');

const secrets = ['secret-one', 'secret-two', 'secret-three', 'secret-four', 'secret-five'];
const raw = debugRawText({ api_key: secrets[0], nested: { Authorization: 'Bearer ' + secrets[1], password: secrets[2] },
    message: `api key="${secrets[3]}" https://example.test/?key=${secrets[4]}`, request: { messages: ['PRIVATE_REQUEST'] } });
for (const secret of secrets) assert.ok(!raw.includes(secret));
assert.ok(!raw.includes('PRIVATE_REQUEST'));
assert.ok(!sanitizeDebugValue('Authorization: "Basic abcdef"').includes('abcdef'));
assert.ok(!sanitizeDebugValue('https://me:pass@example.test/').includes('me:pass'));
assert.ok(!sanitizeDebugValue('{"access_token":"hello secret with spaces"}').includes('hello secret'));
assert.ok(debugRawText('a'.repeat(30000)).length < 10100);
const circular = {}; circular.self = circular;
assert.match(debugRawText(circular), /순환 참조/);
const response = new Response('{"error":"server raw text"}', { status: 503 });
assert.equal(await readErrorResponse({ response }), '{"error":"server raw text"}');
assert.equal(response.bodyUsed, false, 'original response not consumed');
assert.equal(await response.text(), '{"error":"server raw text"}');
const stalled = new Response(new ReadableStream({ start() {} }));
assert.equal(await readErrorResponse(stalled), undefined, 'stalled diagnostic stream times out');

// Execute the real request boundary with a mocked SillyTavern service. No API calls.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const requestSource = index.slice(index.indexOf('async function sendProfileRequest('), index.indexOf('function fallbackEligibleError('));
const settings = { debugMode: false, profileId: 'test', timeoutSeconds: 20 };
let serviceImpl;
const dependencies = {
    settings, profileSlotForId: () => 'A', profileList: () => [{ id: 'test' }], performance,
    AbortController, Promise, setTimeout, clearTimeout, VERBA_MAX_TOKENS: 1000,
    abortError: () => new DOMException('cancelled', 'AbortError'),
    liveContext: () => ({ ConnectionManagerRequestService: { sendRequest: (...args) => serviceImpl(...args) } }),
    enqueueRequest: execute => execute(), enqueueScopedParallelRequest: execute => execute(),
    extractResponseText, rememberRequestError, readErrorResponse, recordProfileAttempt: () => {},
};
const send = Function(...Object.keys(dependencies), requestSource + '\nreturn sendProfileRequest;')(...Object.values(dependencies));
serviceImpl = async () => ({ content: 'translation' });
assert.deepEqual(await send('test'), { content: 'translation' });
let actualError = httpError(503);
serviceImpl = async () => { throw actualError; };
await assert.rejects(send('test'), error => error === actualError);
assert.equal(debugErrorChain(actualError)[0].request, null, 'debug OFF does not capture request data');
settings.debugMode = true;
await assert.rejects(send('test', { stage: 'input' }), error => error === actualError);
assert.match(debugErrorChain(actualError)[0].request.rawResponse, /original server message/);
assert.equal(debugErrorChain(actualError)[0].request.stage, 'input');
serviceImpl = async () => ({ promptFeedback: { blockReason: 'SAFETY' } });
await assert.rejects(send('test'), error => category(error) === '안전 필터·정책 차단');
serviceImpl = async () => ({ content: '' });
await assert.rejects(send('test'), error => category(error) === 'AI 빈 응답');
serviceImpl = () => new Promise(() => {}); // Provider ignores AbortSignal.
const controller = new AbortController();
const pending = send('test', { signal: controller.signal });
controller.abort();
await assert.rejects(pending, error => error.name === 'AbortError');

// Real last-record / copy gate with a minimal DOM, including an already open panel.
const storeSource = index.slice(index.indexOf('function storeDebugDiagnostic('), index.indexOf('function createDebugDiagnostic('));
const copySource = index.slice(index.indexOf('async function copyDebugDiagnostic('), index.indexOf('function reportError('));
const button = { disabled: true };
const api = Function('settings', 'document', 'copyText', 'debugDiagnosticText',
    'let lastDebugDiagnostic = null;\n' + storeSource + copySource + '\nreturn { storeDebugDiagnostic, copyDebugDiagnostic, latest: () => lastDebugDiagnostic };')(
    settings, { querySelector: () => button }, async value => value, JSON.stringify);
settings.debugMode = false;
api.storeDebugDiagnostic({ id: 1 });
assert.equal(api.latest(), null);
settings.debugMode = true;
api.storeDebugDiagnostic({ id: 1 });
api.storeDebugDiagnostic({ id: 2 });
assert.deepEqual(api.latest(), { id: 2 });
assert.equal(button.disabled, false, 'button updates when an error arrives');
await api.copyDebugDiagnostic();
settings.debugMode = false;
await assert.rejects(api.copyDebugDiagnostic(), /복사할/);
assert.ok(index.includes('if (!settings.debugMode) lastDebugDiagnostic = null;'));
assert.equal((index.match(/>로그 복사<\/button>/g) || []).length, 1);
assert.ok(!index.includes("copy.textContent = '진단 복사'"));
console.log('PASS: diagnostic classification, redaction, bounded raw responses, request ON/OFF, cancellation, last-record UI/copy gates');
