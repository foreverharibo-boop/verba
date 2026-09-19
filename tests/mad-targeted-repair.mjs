import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildMadFlashV2AuditPrompt,
    repairCanonicalKoreanNameSuffixes,
    repairCanonicalKoreanVocatives,
} from '../core.js';

const names = ['담은', '민철', '지수', '혜담은'];
const repaired = repairCanonicalKoreanNameSuffixes(
    '담은이를 밀고 민철이는 멈춰 서있었다. 지수이를 불렀고, 혜담은이에게 줄 것도 챙겼다.',
    names,
);
assert.equal(repaired, '담은을 밀고 민철은 멈춰 서있었다. 지수를 불렀고, 혜담은에게 줄 것도 챙겼다.');
assert.equal(
    repairCanonicalKoreanNameSuffixes('담은이은 담은이을 담은이과 담은이에서 봤다.', names),
    '담은은 담은을 담은과 담은에서 봤다.',
);

// A normal subject particle, vocative, comitative and unrelated noun survive.
for (const [before, after] of [
    ['담은이 달렸다.', '담은이 달렸다.'],
    ['담은아, 와.', '담은아, 와.'],
    ['담은이랑 갔다.', '담은이랑 갔다.'],
    ['어린이를 보호했다.', '어린이를 보호했다.'],
]) {
    assert.equal(repairCanonicalKoreanNameSuffixes(before, names), after);
}

assert.equal(
    repairCanonicalKoreanVocatives('"담은이!"', { type: 'dialogue_candidate', text: '"Dam-eun!"' }, names),
    '"담은아!"',
);
assert.equal(
    repairCanonicalKoreanVocatives('"지수이, 뛰어!"', { type: 'dialogue_candidate', text: '"Jisoo, run!"' }, names),
    '"지수야, 뛰어!"',
);
assert.equal(
    repairCanonicalKoreanVocatives('담은이 파이프를 휘둘렀다.', { type: 'narration', text: 'Dam-eun swung the pipe.' }, names),
    '담은이 파이프를 휘둘렀다.',
);
assert.equal(
    repairCanonicalKoreanVocatives('"담은이!"', { type: 'dialogue_candidate', text: '"It is Dam-eun!"' }, names),
    '"담은이!"',
);
const nameToken = '@@VERBA_DEEP_NAME_0000@@';
assert.equal(
    repairCanonicalKoreanVocatives(
        `"${nameToken}이! 뛰어!"`,
        { type: 'dialogue_candidate', text: `"${nameToken}! Run!"` },
        names,
        [{ token: nameToken, value: '담은' }],
    ),
    `"${nameToken}아! 뛰어!"`,
);

const segments = [
    { id: 'seg_0000', type: 'dialogue_candidate', outputScope: 'target_dialogue', text: '"The front\'s a death trap!"' },
    { id: 'seg_0001', type: 'narration', outputScope: 'narration', text: 'He shoved Alex through the service entrance.' },
];
const prompt = buildMadFlashV2AuditPrompt({
    segments,
    currentTranslations: new Map([
        ['seg_0000', '"정문은 좆밥이야!"'],
        ['seg_0001', '그는 민철이를 비상구로 밀어 넣었다.'],
    ]),
    sourceContext: segments.map(row => row.text).join('\n'),
    speakerIdentity: {
        characterName: '김홍진',
        userName: '담은',
        nameLocks: [{ source: 'Alex', target: '민철' }],
    },
    settings: { developerHongjinFlavorEnabled: true, developerHongjinProfanity: 'natural' },
});
assert.match(prompt, /ONE FINAL SOURCE AUDIT/i);
assert.match(prompt, /return ONLY ids that clearly fail/i);
assert.match(prompt, /"source":"\\"The front's a death trap!/i);
assert.match(prompt, /target_dialogue only/i);
assert.match(prompt, /without changing facts, speech act/i);
assert.match(prompt, /If every row passes/i);

// Exercise the exact sparse parser/request loop extracted from index.js.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const quoteStart = index.indexOf('function repairDialogueQuotationEnvelope(');
const quoteEnd = index.indexOf('function hasKoreanFinalConsonant(', quoteStart);
const repairDialogueQuotationEnvelope = Function(
    `${index.slice(quoteStart, quoteEnd)}\nreturn repairDialogueQuotationEnvelope;`,
)();
assert.equal(
    repairDialogueQuotationEnvelope('운 좋으면 방송이라도 잡히겠지.', { type: 'dialogue_candidate', text: '"Might catch a broadcast."' }),
    '"운 좋으면 방송이라도 잡히겠지."',
);
assert.equal(
    repairDialogueQuotationEnvelope('“이미 따옴표가 있다.”', { type: 'dialogue_candidate', text: '"Already quoted."' }),
    '“이미 따옴표가 있다.”',
);
assert.equal(
    repairDialogueQuotationEnvelope('서술은 그대로다.', { type: 'narration', text: 'Narration.' }),
    '서술은 그대로다.',
);
const start = index.indexOf('function parseSparseMadRepairResponse(');
const end = index.indexOf('async function requestSelectionCandidates(', start);
assert.ok(start >= 0 && end > start);
const calls = [];
const responses = [
    '```json\n{"repairs":[{"id":"seg_0000","translation":"\\\"정문으로 가면 뒤져!\\\""}]}\n```',
];
const request = Function(
    'sendWithRetry', 'extractResponseText', 'isAbort', 'errorText',
    `${index.slice(start, end)}\nreturn {parseSparseMadRepairResponse, requestSparseMadRepairs};`,
)(
    async (requestPrompt, options) => {
        calls.push({ requestPrompt, options });
        return { content: responses.shift() };
    },
    response => response.content,
    error => error?.name === 'AbortError',
    error => error?.message || String(error),
);
const sparse = await request.requestSparseMadRepairs('audit', segments, { stage: 'mad-targeted-audit' });
assert.deepEqual([...sparse], [['seg_0000', '"정문으로 가면 뒤져!"']]);
assert.equal(calls.length, 1);
assert.equal(request.parseSparseMadRepairResponse('{"repairs":[]}', segments).size, 0);
assert.throws(
    () => request.parseSparseMadRepairResponse('{"repairs":[{"id":"seg_0000","translation":"A"},{"id":"seg_0000","translation":"B"}]}', segments),
    /중복 수정/,
);

const identityStart = index.indexOf('const KOREAN_NAME_PARTICLE_LIKE_ENDINGS');
const identityEnd = index.indexOf('function hasKoreanFinalConsonant(', identityStart);
const identityHelpers = Function(
    'repairCanonicalKoreanNameSuffixes',
    'repairCanonicalKoreanVocatives',
    'repairIndivisibleIdentityNames',
    'madKoreanExclusiveMode',
    `${index.slice(identityStart, identityEnd)}\nreturn {canonicalKoreanIdentityNames, repairOutputIdentityNames, repairStrictCanonicalIdentityNames};`,
)(repairCanonicalKoreanNameSuffixes, repairCanonicalKoreanVocatives, value => value, () => true);
const fullIdentity = { userName: '혜담은', characterName: '김홍진' };
assert.deepEqual(identityHelpers.canonicalKoreanIdentityNames(fullIdentity), ['혜담은', '담은', '김홍진', '홍진']);
assert.equal(
    identityHelpers.repairOutputIdentityNames('담은이은 담은이을 밀었다.', fullIdentity, { type: 'narration' }),
    '담은은 담은을 밀었다.',
);
assert.equal(
    identityHelpers.repairOutputIdentityNames('"담은이!"', fullIdentity, { type: 'dialogue_candidate', text: '"Dam-eun!"' }),
    '"담은아!"',
);
assert.equal(
    identityHelpers.repairOutputIdentityNames('담은이 파이프를 휘둘렀다.', fullIdentity, { type: 'narration', text: 'Dam-eun swung the pipe.' }),
    '담은이 파이프를 휘둘렀다.',
);
assert.equal(
    identityHelpers.repairOutputIdentityNames(
        '담은이은 물러났다. 담은이의 후드를 잡고 담은이을 밀었다. 담은이 놓친 파이프였다. 담은이 아니라 홍진이었다. 담은이가 말을 듣는지 봤다.',
        fullIdentity,
        { type: 'narration' },
    ),
    '담은은 물러났다. 담은의 후드를 잡고 담은을 밀었다. 담은이 놓친 파이프였다. 담은이 아니라 홍진이었다. 담은이 말을 듣는지 봤다.',
);
assert.equal(
    identityHelpers.repairOutputIdentityNames('농담은이 먹히지 않았다. 부담은이 컸고 상담은은 끝났다.', fullIdentity, { type: 'narration' }),
    '농담은 먹히지 않았다. 부담은 컸고 상담은 끝났다.',
);
assert.equal(
    identityHelpers.repairStrictCanonicalIdentityNames('농담은이 먹히지 않았다. 부담은이 컸고 상담은은 끝났다.', fullIdentity),
    '농담은 먹히지 않았다. 부담은 컸고 상담은 끝났다.',
);

// The audit is transactional: any downstream validation failure restores the
// complete first-pass translation map instead of leaving a half-applied repair.
const auditStart = index.indexOf('async function runMadKoreanTargetedAudit(');
const auditEnd = index.indexOf('async function runExperimentalQualityAudit(', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart);
let auditRequests = 0;
let failIntegrity = false;
const auditEnv = {
    madKoreanExclusiveMode: () => true,
    settings: { developerHongjinFlavorEnabled: true },
    outputScopeForSegment: segment => segment.outputScope,
    buildMadFlashV2AuditPrompt: () => 'audit-v2',
    buildMadKoreanTargetedAuditPrompt: () => 'audit',
    requestSparseMadRepairs: async () => {
        auditRequests += 1;
        if (failIntegrity) throw new Error('audit failed');
        return new Map([['seg_0000', '"정문으로 가면 뒤져!"']]);
    },
    runWithConcurrency: async (items, _limit, worker) => Promise.all(items.map(worker)),
    SCOPED_PARALLEL_REQUEST_LIMIT: 3,
    splitMadAuditSegments: rows => [rows],
    repairKoreanParticleAlternatives: value => value,
    repairStrictCanonicalIdentityNames: value => value,
    repairCanonicalKoreanVocatives: value => value,
    canonicalKoreanIdentityNames: () => [],
    repairIndivisibleIdentityNames: value => value,
    findBannedWords: () => [],
    repairSegmentsByOutputScope: async () => {},
    buildBannedRepairPrompt: () => '',
    findUntranslatedSegments: () => [],
    buildUntranslatedRepairPrompt: () => '',
    repairProtectedTokenIntegrity: async () => {
        if (failIntegrity) throw new Error('integrity failed');
    },
    isAbort: () => false,
    console: { info() {}, warn() {} },
};
const runAudit = Function(
    ...Object.keys(auditEnv),
    `${index.slice(auditStart, auditEnd)}\nreturn runMadKoreanTargetedAudit;`,
)(...Object.values(auditEnv));
const auditTranslations = new Map([
    ['seg_0000', '"정문은 좆밥이야!"'],
    ['seg_0001', '민철이를 비상구로 밀었다.'],
]);
const auditArgs = {
    segmented: { segments, protectedText: segments.map(row => row.text).join('\n') },
    translations: auditTranslations,
    speakerScopes: {},
    speakerIdentity: {},
    options: {},
};
let auditResult = await runAudit(auditArgs);
assert.equal(auditResult.changed, 1);
assert.equal(auditTranslations.get('seg_0000'), '"정문으로 가면 뒤져!"');
auditTranslations.set('seg_0000', '1차 번역');
failIntegrity = true;
auditResult = await runAudit(auditArgs);
assert.equal(auditResult.changed, 0);
assert.equal(auditTranslations.get('seg_0000'), '1차 번역');
assert.equal(auditTranslations.get('seg_0001'), '민철이를 비상구로 밀었다.');
assert.equal(auditRequests, 2);

console.log('PASS: generic canonical-name suffix/vocative repair, full-name given-name aliases, sparse Mad+Hongjin semantic audit prompt, parser and transactional rollback.');
