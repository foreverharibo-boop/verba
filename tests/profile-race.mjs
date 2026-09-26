import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert.match(index, /profileRaceEnabled:\s*false/);
assert.match(index, /profileRaceTimeoutMinutes:\s*5/);
assert.match(index, /id="verba-profile-race-enabled"/);
assert.match(index, /id="verba-profile-race-timeout-minutes"/);
assert.match(index, /profileRaceOptions\.hidden\s*=\s*!\(fallbackEnabled && settings\.profileRaceEnabled === true\)/);
assert.match(style, /\.verba-profile-race-options\[hidden\][\s\S]*display:\s*none\s*!important/);

const start = index.indexOf('function sendProfileRaceAttempt(');
const end = index.indexOf('\nasync function sendWithRetry(', start);
assert.ok(start >= 0 && end > start, 'profile race helper source');
const source = index.slice(start, end);

const calls = [];
const aborted = [];
const notices = [];

function abortError() {
    return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function sendProfileRequest(prompt, options) {
    calls.push({ prompt, options });
    const delay = options.profileSlot === 'A' ? 80 : 5;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ content: options.profileSlot }), delay);
        options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            aborted.push(options.profileSlot);
            reject(abortError());
        }, { once: true });
    });
}

const env = {
    configuredProfileCycle: () => ({ active: 'a', slot: 'A', fallbacks: [{ id: 'b', slot: 'B' }] }),
    sendProfileRequest,
    abortError,
    fallbackEligibleError: error => error?.code === 'TRANSIENT',
    profileRaceTimeoutError: () => Object.assign(new Error('race timeout'), { code: 'VERBA_PROFILE_RACE_TIMEOUT' }),
    notifyProfileRaceWinner: profile => notices.push(profile.slot),
    PROFILE_RACE_STAGGER_MS: 12,
    Date, Promise, AbortController, setTimeout, clearTimeout,
};
const { sendProfileRaceAttempt } = Function(
    ...Object.keys(env),
    `${source}\nreturn { sendProfileRaceAttempt };`,
)(...Object.values(env));

const winner = await sendProfileRaceAttempt(
    'translate',
    {},
    { active: 'a', slot: 'A', fallbacks: [{ id: 'b', slot: 'B' }] },
    0,
    Date.now() + 1000,
);
assert.equal(winner.content, 'B');
assert.deepEqual(calls.map(call => call.options.profileSlot), ['A', 'B']);
assert.ok(calls.every(call => call.options.profileRaceRequest === true));
assert.deepEqual(notices, ['B']);
assert.ok(aborted.includes('A'));

calls.length = 0;
aborted.length = 0;
notices.length = 0;
let first = true;
env.sendProfileRequest = undefined;
function immediateFallbackRequest(prompt, options) {
    calls.push({ prompt, options });
    if (first) {
        first = false;
        return Promise.reject(Object.assign(new Error('busy'), { code: 'TRANSIENT' }));
    }
    return Promise.resolve({ content: options.profileSlot });
}
const immediateApi = Function(
    ...Object.keys({ ...env, sendProfileRequest: immediateFallbackRequest }),
    `${source}\nreturn { sendProfileRaceAttempt };`,
)(...Object.values({ ...env, sendProfileRequest: immediateFallbackRequest }));
const immediateStarted = Date.now();
const immediateWinner = await immediateApi.sendProfileRaceAttempt(
    'translate',
    {},
    { active: 'a', slot: 'A', fallbacks: [{ id: 'b', slot: 'B' }] },
    0,
    Date.now() + 1000,
);
assert.equal(immediateWinner.content, 'B');
assert.ok(Date.now() - immediateStarted < 12, 'transient error launches fallback without waiting for stagger');

// The user-selected overall timer starts with A and aborts every in-flight
// race attempt.  A normal user cancellation must remain a normal AbortError.
const retryStart = index.indexOf('async function sendWithRetry(');
const retryEnd = index.indexOf('\nasync function requestSelectionCandidates(', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, 'sendWithRetry source');
const retrySource = index.slice(retryStart, retryEnd);
const retryAbortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
const retryBaseEnv = {
    profileRaceActive: () => true,
    normalizedProfileRaceTimeoutMinutes: () => 0.0003,
    AbortController,
    Date,
    setTimeout,
    clearTimeout,
    applyCustomTranslatorPrompt: prompt => prompt,
    configuredProfileCycle: () => ({ active: 'a', slot: 'A', fallbacks: [{ id: 'b', slot: 'B' }] }),
    sendProfileRaceAttempt: (_prompt, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(retryAbortError()), { once: true });
    }),
    isAbort: (error, signal) => signal?.aborted || error?.name === 'AbortError',
    profileRaceTimeoutError: minutes => Object.assign(new Error(`timeout ${minutes}`), { code: 'VERBA_PROFILE_RACE_TIMEOUT' }),
    abortError: retryAbortError,
    serverRetryStates: new Map(),
    updateServerRetryIndicator: () => {},
    console: { warn() {} },
};
const retryApi = Function(
    ...Object.keys(retryBaseEnv),
    `${retrySource}\nreturn { sendWithRetry };`,
)(...Object.values(retryBaseEnv));
await assert.rejects(
    retryApi.sendWithRetry('translate'),
    error => error?.code === 'VERBA_PROFILE_RACE_TIMEOUT',
);

const cancelController = new AbortController();
const cancelEnv = {
    ...retryBaseEnv,
    normalizedProfileRaceTimeoutMinutes: () => 5,
};
const cancelApi = Function(
    ...Object.keys(cancelEnv),
    `${retrySource}\nreturn { sendWithRetry };`,
)(...Object.values(cancelEnv));
const cancelled = cancelApi.sendWithRetry('translate', { signal: cancelController.signal });
setTimeout(() => cancelController.abort(), 5);
await assert.rejects(cancelled, error => error?.name === 'AbortError' && !error?.code);

console.log('PASS: 지연 경주가 프로필을 시차 호출하고 첫 정상 응답만 채택하며 전체 제한·사용자 취소와 UI 분 입력값을 올바르게 처리함.');
