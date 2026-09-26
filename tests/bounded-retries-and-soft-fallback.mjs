import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (startMarker, endMarker) => {
    const start = index.indexOf(startMarker);
    const end = index.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker);
    return index.slice(start, end);
};

const retrySource = slice('async function sendWithRetry(', 'function collectPartialSegmentTranslations(');
const retryBase = {
    profileRaceActive: () => false,
    normalizedProfileRaceTimeoutMinutes: () => 5,
    AbortController,
    Date,
    setTimeout,
    clearTimeout,
    applyCustomTranslatorPrompt: prompt => prompt,
    configuredProfileCycle: () => ({ active: 'a', slot: 'A', fallbacks: [] }),
    sendProfileRaceAttempt: () => { throw new Error('race must stay off'); },
    sendProfileRequest: null,
    isAbort: error => error?.name === 'AbortError',
    profileRaceTimeoutError: () => Object.assign(new Error('race timeout'), { code: 'VERBA_PROFILE_RACE_TIMEOUT' }),
    abortError: () => Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    fallbackEligibleError: () => false,
    profileDisplayName: () => 'profile',
    notifyFallbackUsed: () => {},
    transientError: error => error?.code === 'TRANSIENT',
    retryAfterMs: () => 0,
    serverRetryStates: new Map(),
    updateServerRetryIndicator: () => {},
    outputTiming: { wait: async (_timing, action) => action() },
    wait: async () => {},
    errorText: error => error?.message || String(error),
    console: { warn() {} },
};

let calls = 0;
let failure = Object.assign(new Error('bad request'), { code: 'PERMANENT' });
const retryApi = Function(
    ...Object.keys(retryBase),
    `${retrySource}\nreturn sendWithRetry;`,
)(...Object.values({
    ...retryBase,
    sendProfileRequest: async () => { calls += 1; throw failure; },
}));

await assert.rejects(retryApi('prompt'), /bad request/);
assert.equal(calls, 1, 'permanent errors stop after the first provider request');

calls = 0;
failure = Object.assign(new Error('busy'), { code: 'TRANSIENT' });
await assert.rejects(retryApi('prompt'), /자동 재시도 2회/);
assert.equal(calls, 3, 'transient errors get one initial request plus two retries');

const requestSource = slice('function collectPartialSegmentTranslations(', 'async function requestSelectionCandidates(');
let transportCalls = 0;
const transportError = Object.assign(new Error('transport exhausted'), { code: 'TRANSIENT' });
const requestEnv = {
    collectSegmentResponse: () => { throw new Error('must not parse a transport failure'); },
    extractResponseText: value => value,
    recordSegmentRecovery: () => null,
    finishSegmentRecovery: () => {},
    sendWithRetry: async () => { transportCalls += 1; throw transportError; },
    outputTiming: { wait: async (_timing, action) => action() },
    wait: async () => {},
    isAbort: () => false,
    errorText: error => error.message,
    console: { warn() {} },
};
const requestSegments = Function(
    ...Object.keys(requestEnv),
    `${requestSource}\nreturn requestSegments;`,
)(...Object.values(requestEnv));
await assert.rejects(requestSegments('prompt', [{ id: 's1' }]), /transport exhausted/);
assert.equal(transportCalls, 1, 'JSON recovery never repeats an exhausted transport request');

const translateSource = slice('async function translateOutputText(', 'function inputIdentitySpellingContext(');
const settings = {};
const warnings = [];
let repairCalls = 0;
let protectedCalls = 0;
const segmented = {
    protectedText: 'source',
    segments: [{ id: 's1', type: 'narration', text: 'source' }],
    parts: [{ id: 's1', type: 'narration', text: 'source' }],
    nameTokens: [],
    tokens: [],
};
const translateEnv = {
    settings,
    POST_TRANSLATION_AI_REPAIR_ENABLED: false,
    normalizedCharacterNameLocks: () => [],
    segmentSource: () => segmented,
    minimalOutputEnabled: () => false,
    translateMinimalOutput: () => { throw new Error('minimal path must stay off'); },
    requestSegments: () => {},
    buildSourceMap: () => [],
    planRepeatedRoleTermLocks: async () => [],
    assembleTranslation: (_segmented, translations) => translations.get('s1'),
    inferLocalTargetDialogueScopes: () => ({}),
    requestScopedOutputTranslations: async () => new Map([['s1', '최초 BAD 번역본']]),
    normalizeTaggedOutputTranslations: (_segmented, translations) => translations,
    findBannedWords: text => String(text).includes('BAD') ? ['BAD'] : [],
    repairSegmentsByOutputScope: async ({ translations }) => {
        repairCalls += 1;
        translations.set('s1', '망가진 BAD 보정본');
    },
    buildBannedRepairPrompt: () => '',
    findUntranslatedSegments: () => [],
    buildUntranslatedRepairPrompt: () => '',
    isAbort: () => false,
    repairRepeatedRoleTermConsistency: async () => {},
    repairProtectedTokenIntegrity: async () => { protectedCalls += 1; },
    repairKoreanParticleAlternatives: value => value,
    repairIndivisibleIdentityNames: value => value,
    runExperimentalQualityAudit: async () => {},
    ensureBilingualDialogueFormat: (_segment, value) => value,
    restoreTranslationSnapshot: (translations, snapshot) => {
        translations.clear();
        for (const [id, value] of snapshot) translations.set(id, value);
    },
    console: { warn: (...args) => warnings.push(args) },
};
const translateOutputText = Function(
    ...Object.keys(translateEnv),
    `${translateSource}\nreturn translateOutputText;`,
)(...Object.values(translateEnv));
const result = await translateOutputText('source');
assert.equal(result.translation, '최초 BAD 번역본');
assert.equal(repairCalls, 0, 'banned-word AI repair stays dormant behind the reversible switch');
assert.equal(protectedCalls, 0, 'protected-token AI repair stays dormant behind the reversible switch');
assert.ok(warnings.some(args => String(args[0]).includes('금지어 의심이 남았지만')));
assert.match(index, /if \(POST_TRANSLATION_AI_REPAIR_ENABLED && banned\.length\)/);
assert.match(index, /repairProtectedTokenIntegrity/);

console.log('PASS: permanent errors stop immediately, transient retries stay bounded, transport and JSON retries do not multiply, and reversible post-translation AI repair paths remain present but inactive.');
