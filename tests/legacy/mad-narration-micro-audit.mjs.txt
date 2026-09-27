import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMadNarrationMicroAuditPrompt } from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = index.indexOf('function applyMadNarrationDeterministicRepairs(');
const end = index.indexOf('async function runMadKoreanTargetedAudit(', start);
assert.ok(start >= 0 && end > start);

let requests = 0;
let lastCandidates = [];
const env = {
    settings: { developerHongjinFlavorEnabled: false },
    canonicalKoreanIdentityNames: () => ['김홍진', '홍진', '담은'],
    outputScopeForSegment: segment => segment.outputScope || 'narration',
    escapeRegularExpression: value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    madKoreanExclusiveMode: () => true,
    buildMadNarrationMicroAuditPrompt,
    requestSparseMadRepairs: async (_prompt, candidates, options) => {
        requests += 1;
        lastCandidates = candidates;
        assert.equal(options.maxParseRetries, 0);
        return new Map([[candidates[0].id, '피로가 뼛속까지 내려앉았다.']]);
    },
    repairKoreanParticleAlternatives: value => value,
    repairStrictCanonicalIdentityNames: value => value,
    isAbort: () => false,
    console: { info() {}, warn() {} },
};
const helpers = Function(
    ...Object.keys(env),
    `${index.slice(start, end)}\nreturn {applyMadNarrationDeterministicRepairs, madNarrationLocalAuditCandidates, runMadNarrationMicroAudit};`,
)(...Object.values(env));

const segments = [
    { id: 'seg_0000', type: 'narration', outputScope: 'narration', text: 'A deep, grinding exhaustion remained.' },
    { id: 'seg_0001', type: 'narration', outputScope: 'narration', text: 'The split knuckles pulled under their wrapping.' },
    { id: 'seg_0002', type: 'narration', outputScope: 'narration', text: 'Hong-jin stared at the canvas ceiling.' },
    { id: 'seg_0003', type: 'narration', outputScope: 'narration', text: 'The camp was still moving.' },
    { id: 'seg_0004', type: 'dialogue_candidate', outputScope: 'target_dialogue', text: '"Move."' },
];
const translations = new Map([
    ['seg_0000', '깊고 갈리는 피로가 남았다.'],
    ['seg_0001', '붕대 아래 갈라진 손등이 당겼다.'],
    ['seg_0002', '홍진 천장의 천을 올려다보았다.'],
    ['seg_0003', '밖에서는 야영지가 여전히 움직이고 있었다.'],
    ['seg_0004', '"움직여."'],
]);
const identity = { characterName: '김홍진', userName: '담은' };
const candidates = helpers.madNarrationLocalAuditCandidates(
    { segments },
    translations,
    {},
    identity,
);
assert.deepEqual(candidates.map(row => row.id), ['seg_0000', 'seg_0001', 'seg_0002']);
assert.ok(candidates.every(row => row.localAuditReasons.length));

const result = await helpers.runMadNarrationMicroAudit({
    segmented: { segments }, translations, speakerScopes: {}, speakerIdentity: identity, options: {},
});
assert.equal(result.requested, 0);
assert.equal(result.changed, 2);
assert.equal(requests, 0);

// Combined Mad Korean + Hongjin keeps deterministic fixes but never adds an
// AI request after the parallel primary authoring lanes.
env.settings.developerHongjinFlavorEnabled = true;
const hongjinDeterministic = new Map([
    ['seg_0000', '깊고 갈리는 피로가 남았다.'],
]);
const hongjinResult = await helpers.runMadNarrationMicroAudit({
    segmented: { segments: [segments[0]] },
    translations: hongjinDeterministic,
    speakerScopes: {},
    speakerIdentity: identity,
    options: {},
});
assert.equal(hongjinResult.requested, 0);
assert.equal(hongjinResult.changed, 1);
assert.equal(requests, 0);
assert.equal(lastCandidates.length, 0);
assert.equal(translations.get('seg_0000'), '무겁고 지독한 피로가 남았다.');

const deterministicOnly = new Map([
    ['seg_0000', '깊고 갈리는 피로가 남았다.'],
]);
const deterministicResult = await helpers.runMadNarrationMicroAudit({
    segmented: { segments: [segments[0]] },
    translations: deterministicOnly,
    speakerScopes: {},
    speakerIdentity: identity,
    options: {},
});
assert.equal(deterministicResult.requested, 0);
assert.equal(deterministicResult.changed, 1);
assert.equal(deterministicOnly.get('seg_0000'), '무겁고 지독한 피로가 남았다.');
assert.equal(requests, 0);

const cleanTranslations = new Map([
    ['seg_0003', '밖에서는 야영지가 여전히 움직이고 있었다.'],
]);
const cleanResult = await helpers.runMadNarrationMicroAudit({
    segmented: { segments: [segments[3]] },
    translations: cleanTranslations,
    speakerScopes: {},
    speakerIdentity: identity,
    options: {},
});
assert.equal(cleanResult.requested, 0);
assert.equal(requests, 0);

const calqueSegments = [
    { id: 'shoulder', type: 'narration', outputScope: 'narration', text: 'Shoulder reduced.' },
    { id: 'list', type: 'narration', outputScope: 'narration', text: 'He read it like a grocery list.' },
    { id: 'cuff', type: 'narration', outputScope: 'narration', text: 'The medic checked a blood pressure cuff.' },
    { id: 'look', type: 'narration', outputScope: 'narration', text: 'He gave him a measuring look.' },
];
const calqueTranslations = new Map([
    ['shoulder', '어깨는 정복됐고 눈썹은 꿰맸다.'],
    ['list', '장바구니를 읽는 것처럼 말했다.'],
    ['cuff', '혈압 커프를 확인했다.'],
    ['look', '무표정하고 탐색하는 눈빛이었다.'],
]);
assert.equal(helpers.applyMadNarrationDeterministicRepairs(
    { segments: calqueSegments }, calqueTranslations, {},
), 4);
assert.equal(calqueTranslations.get('shoulder'), '빠진 어깨는 제자리로 맞췄고 눈썹은 꿰맸다.');
assert.equal(calqueTranslations.get('list'), '장보기 목록을 읽는 것처럼 말했다.');
assert.equal(calqueTranslations.get('cuff'), '혈압계를 확인했다.');
assert.equal(calqueTranslations.get('look'), '무표정하게 재어 보는 눈빛이었다.');

const prompt = buildMadNarrationMicroAuditPrompt({
    segments: candidates,
    currentTranslations: translations,
    speakerIdentity: identity,
});
assert.match(prompt, /FAST NARRATION MICRO-AUDIT/);
assert.match(prompt, /local_flags/);
assert.match(prompt, /This is narration only/);
assert.doesNotMatch(prompt, /FULL SCENE SOURCE/);

console.log('PASS: local narration shortlist, zero-request clean path, and one-request sparse micro-audit.');
