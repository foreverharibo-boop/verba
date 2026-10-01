import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizedServerRetryLimit, serverRetryBackoffMs, googleRetryHintSeconds } from '../retry-policy.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const prefix = index.includes("const EXTENSION_KEY = 'verba-deep';") ? 'verba-deep' : 'verba';
const slice = (a, b) => {
    const start = index.indexOf(a), end = index.indexOf(b, start);
    assert.ok(start >= 0 && end > start, a);
    return index.slice(start, end);
};
const retryCode = slice('function errorText(', 'function isAbort(')
    + slice('function transientError(', 'function abortError(')
    + slice('async function sendWithRetry(', 'function collectPartialSegmentTranslations(');

assert.equal(normalizedServerRetryLimit(), 5);
assert.equal(normalizedServerRetryLimit('0'), 0);
for (const invalid of ['', '  ', null, -1, Infinity, NaN, 'bad', 1e30]) {
    assert.equal(normalizedServerRetryLimit(invalid), 5);
}
assert.equal(normalizedServerRetryLimit('12'), 12);
assert.equal(normalizedServerRetryLimit('2.9'), 2);
assert.equal(normalizedServerRetryLimit('0.5'), 1, 'only an explicit zero enables unlimited retries');
for (let attempt = 0; attempt < 40; attempt++) {
    const base = [3000, 5000, 8000, 12000, 20000][Math.min(attempt, 4)];
    assert.equal(serverRetryBackoffMs(attempt, () => 1), base);
    assert.equal(serverRetryBackoffMs(attempt, () => 0), base * .95);
    assert.ok(serverRetryBackoffMs(attempt) <= 20000);
}

function make({ limit = 5, successAt = 0, abortAfter = 0, error, fallback = false, mutateLimit } = {}) {
    const calls = [], delays = [], counters = [], states = new Map();
    const settings = { serverRetryLimit: limit };
    const outer = new AbortController();
    const env = {
        settings, normalizedServerRetryLimit, googleRetryHintSeconds,
        serverRetryBackoffMs: n => serverRetryBackoffMs(n, () => 1),
        profileRaceActive: () => false,
        normalizedProfileRaceTimeoutMinutes: () => 5,
        AbortController, Date, setTimeout, clearTimeout,
        applyCustomTranslatorPrompt: p => p,
        configuredProfileCycle: () => ({ active: 'a', slot: 'A', fallbacks: fallback ? [{ id: 'b', slot: 'B' }] : [] }),
        sendProfileRequest: async (_p, options) => {
            calls.push([options.retryAttempt, options.profileSlot]);
            if (mutateLimit !== undefined) settings.serverRetryLimit = mutateLimit;
            if (successAt && calls.length === successAt) return 'translated';
            throw error || Object.assign(new Error('provider busy'), { status: 429 });
        },
        isAbort: (e, signal) => signal?.aborted || e?.name === 'AbortError',
        abortError: () => new DOMException('cancelled', 'AbortError'),
        fallbackEligibleError: e => e.status === 429,
        profileDisplayName: () => 'profile', notifyFallbackUsed: () => {},
        serverRetryStates: states,
        updateServerRetryIndicator: () => {
            for (const state of states.values()) counters.push([state.retryCount, state.maxRetries]);
        },
        outputTiming: { wait: async (_t, action) => action() },
        wait: async ms => { delays.push(ms); if (abortAfter && delays.length === abortAfter) outer.abort(); },
        console: { warn() {} },
    };
    const send = Function(...Object.keys(env), retryCode + '\nreturn sendWithRetry;')(...Object.values(env));
    return { send, calls, delays, counters, states, signal: outer.signal };
}
for (const limit of [1, 2, 5, 12]) {
    const api = make({ limit });
    await assert.rejects(api.send('prompt'), new RegExp(`자동 재시도 ${limit}회`));
    assert.equal(api.calls.length, limit + 1);
    assert.equal(api.delays.length, limit);
    assert.equal(api.states.size, 0);
    assert.ok(api.counters.some(([count, maximum]) => count === limit && maximum === limit));
}
const unlimited = make({ limit: 0, successAt: 9 });
assert.equal(await unlimited.send('prompt'), 'translated');
assert.equal(unlimited.calls.length, 9);
assert.equal(unlimited.states.size, 0);
assert.deepEqual(unlimited.delays, [3000, 5000, 8000, 12000, 20000, 20000, 20000, 20000]);
const cancelled = make({ limit: 0, abortAfter: 7 });
await assert.rejects(cancelled.send('prompt', { signal: cancelled.signal }), { name: 'AbortError' });
assert.equal(cancelled.calls.length, 7);
assert.equal(cancelled.states.size, 0);
for (const status of [400, 401, 402, 403, 404]) {
    const api = make({ limit: 0, error: Object.assign(new Error('invalid request'), { status }) });
    await assert.rejects(api.send('prompt'), /invalid request/);
    assert.equal(api.calls.length, 1);
    assert.equal(api.delays.length, 0);
}
const recovered = make({ limit: 5, successAt: 6 });
assert.equal(await recovered.send('prompt'), 'translated');
assert.equal(recovered.calls.length, 6);
const snapshot = make({ limit: 2, mutateLimit: 0 });
await assert.rejects(snapshot.send('prompt'), /자동 재시도 2회/);
assert.equal(snapshot.calls.length, 3, 'changes apply to the next request, not an ongoing retry sequence');
const fallbacks = make({ limit: 2, fallback: true });
await assert.rejects(fallbacks.send('prompt'), /자동 재시도 2회/);
assert.deepEqual(fallbacks.calls, [[0, 'A'], [0, 'B'], [1, 'A'], [1, 'B'], [2, 'A'], [2, 'B']]);
for (const hint of [
    { retryAfter: 30 },
    { retryAfter: 180 },
    { headers: { 'Retry-After': '30' } },
    { cause: { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } } },
    { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: { seconds: '30', nanos: 0 } }] },
]) {
    const api = make({ limit: 1, successAt: 2, error: Object.assign(new Error('429'), hint) });
    await api.send('prompt');
    assert.deepEqual(api.delays, [hint.retryAfter === 180 ? 180000 : 30000]);
}

// Execute the actual setting event handler and retry-toast formatter.
let handler, saves = 0;
const settings = { serverRetryLimit: 5 };
const panel = { querySelector: selector => {
    assert.equal(selector, `#${prefix}-server-retry-limit`);
    return { addEventListener: (event, callback) => { assert.equal(event, 'change'); handler = callback; } };
} };
Function('panel', 'settings', 'normalizedServerRetryLimit', 'saveSettings',
    slice('    const serverRetryLimitInput =', '    const profileFallbackInput ='))(panel, settings, normalizedServerRetryLimit, () => saves++);
for (const [value, expected] of [['0', 0], ['7', 7], ['', 5], ['-1', 5]]) {
    const target = { value };
    handler({ target });
    assert.equal(settings.serverRetryLimit, expected);
    assert.equal(target.value, String(expected));
}
assert.equal(saves, 4);
assert.match(index, /serverRetryLimit: 5/);
assert.match(index, new RegExp(`id="${prefix}-server-retry-limit"`));

const states = new Map(), messages = [];
let aborts = 0, options, closed = 0;
const noticeUI = { show: (message, opts) => {
    messages.push(message); options = opts;
    return { update: message => messages.push(message), close: () => closed++ };
} };
const update = Function('serverRetryStates', 'noticeUI', 'notify',
    'let serverRetryNotice = null;\n' + slice('function updateServerRetryIndicator(', 'function showProgress(')
    + '\nreturn updateServerRetryIndicator;')(states, noticeUI, () => {});
states.set('test', { maxRetries: 7, retryCount: 2, delayMs: 5000, updatedAt: 1, controller: { abort: () => aborts++ } });
update();
assert.match(messages.at(-1), /2\/7회 · 5초 후 재시도/);
states.get('test').maxRetries = 0; update();
assert.match(messages.at(-1), /2회째 · 무제한/);
assert.doesNotMatch(messages.at(-1), /\/0회/);
states.get('test').delayMs = 0; update();
assert.match(messages.at(-1), /다시 요청 중/);
assert.equal(aborts, 0, 'formatting never cancels a request');
options.onCancel();
assert.equal(aborts, 1, 'explicit cancellation still aborts the request');
states.clear(); update();
assert.ok(closed >= 1);
console.log('PASS: configurable finite/unlimited retries, jitter cap, provider hints, permanent-error stop, cancellation, settings save and toast counts.');
