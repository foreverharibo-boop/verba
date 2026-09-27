import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = index.indexOf('async function translateOutputText(');
const end = index.indexOf('function inputIdentitySpellingContext(', start);
assert.ok(start >= 0 && end > start);
const source = index.slice(start, end);

let localCleanupCalls = 0;
let postRepairCalls = 0;
const warnings = [];
const segmented = {
    protectedText: 'source',
    segments: [{ id: 's1', type: 'narration', text: 'source' }],
    parts: [{ id: 's1', type: 'narration', text: 'source' }],
    nameTokens: [],
    tokens: [],
};
const env = {
    settings: {},
    POST_TRANSLATION_AI_REPAIR_ENABLED: false,
    normalizedCharacterNameLocks: () => [],
    segmentSource: () => segmented,
    minimalOutputEnabled: () => false,
    translateMinimalOutput: () => { throw new Error('minimal path must stay off'); },
    planRepeatedRoleTermLocks: async () => [],
    assembleTranslation: (_segmented, translations, options) => {
        assert.equal(options.allowDamagedProtected, true);
        return translations.get('s1');
    },
    classifyOutputDialogueSpeakers: async () => ({}),
    requestScopedOutputTranslations: async () => new Map([['s1', '최초 BAD 번역본']]),
    normalizeTaggedOutputTranslations: (_segmented, translations) => translations,
    normalizeLocallyRecoverableProtectedTokens: () => { localCleanupCalls += 1; },
    findBannedWords: text => String(text).includes('BAD') ? ['BAD'] : [],
    repairSegmentsByOutputScope: async () => { postRepairCalls += 1; },
    findUntranslatedSegments: () => [],
    repairRepeatedRoleTermConsistency: async () => { postRepairCalls += 1; },
    repairProtectedTokenIntegrity: async () => { postRepairCalls += 1; },
    repairKoreanParticleAlternatives: value => value,
    repairIndivisibleIdentityNames: value => value,
    runExperimentalQualityAudit: async () => { postRepairCalls += 1; },
    ensureBilingualDialogueFormat: (_segment, value) => value,
    buildSourceMap: () => [],
    console: { warn: (...args) => warnings.push(args) },
};

const translateOutputText = Function(
    ...Object.keys(env),
    `${source}\nreturn translateOutputText;`,
)(...Object.values(env));
const result = await translateOutputText('source');
assert.equal(result.translation, '최초 BAD 번역본');
assert.equal(localCleanupCalls, 1, 'deterministic local cleanup remains active');
assert.equal(postRepairCalls, 0, 'every post-translation AI repair stays dormant');
assert.ok(warnings.some(args => String(args[0]).includes('금지어 의심이 남았지만')));
assert.match(index, /if \(POST_TRANSLATION_AI_REPAIR_ENABLED\)[\s\S]*repairProtectedTokenIntegrity/);
assert.match(index, /if \(POST_TRANSLATION_AI_REPAIR_ENABLED\)[\s\S]*runExperimentalQualityAudit/);

console.log('PASS: local cleanup remains active while every post-translation AI repair path is preserved but dormant.');
