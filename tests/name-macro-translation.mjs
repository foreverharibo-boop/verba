import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTranslationNameMacros, resolveOutputSpeakerIdentity, segmentSource, assembleTranslation, ensureBilingualDialogueFormat } from '../core.js';
import { reviewEnglishLeftovers, englishReviewTargets } from '../english-review.js';
import { translateMinimalOutput } from '../minimal-output.js';

const identity = resolveOutputSpeakerIdentity({ userName: 'Dana', characterName: 'Christopher' });
const raw = '{{user}} waited. "Hi, {{user}}."';
assert.equal(resolveTranslationNameMacros(raw, identity), 'Dana waited. "Hi, Dana."');
assert.equal(resolveTranslationNameMacros('{{ USER }} met {{char}}.', identity), 'Dana met Christopher.');
assert.equal(resolveTranslationNameMacros('{{user}}.', {}), '{{user}}.');
assert.equal(resolveTranslationNameMacros('{{user}}.', { userName: '{{getvar::name}}' }), '{{user}}.');
assert.equal(resolveTranslationNameMacros('{{user}}.', { userName: '다나' }), '다나.');
const protectedParts = [
    '`{{user}}`', '```text\n{{user}} {{char}}\n```', '~~~text\n{{user}}\n~~~',
    '<!-- {{user}} -->', '<script>const n = "{{user}}";</script>',
    '<style>/* {{user}} */</style>', '<thought>{{user}}</thought>',
    'https://example.com/{{user}}', '{{getvar::name}}', '{{random::Dana::Jane}}',
];
for (const part of protectedParts) assert.equal(resolveTranslationNameMacros(part, identity), part);
assert.equal(resolveTranslationNameMacros('<span title="{{user}}">{{user}}</span>', identity), '<span title="{{user}}">Dana</span>');

// Reproduce the prior opaque-macro path, then exercise the corrected pipeline.
const before = segmentSource(raw);
assert.ok(before.tokens.some(token => token.value === '{{user}}'));
const segmented = segmentSource(raw, [], { speakerIdentity: identity });
assert.ok(!segmented.tokens.some(token => token.value === '{{user}}'));
assert.equal(segmented.source, 'Dana waited. "Hi, Dana."');
assert.equal(raw, '{{user}} waited. "Hi, {{user}}."', 'stored raw message stays unchanged');
const [narration, dialogue] = segmented.segments;
const translations = new Map([
    [narration.id, 'Dana는 기다렸다.'],
    [dialogue.id, '"Hi, Dana. (안녕, Dana.)"'],
]);
assert.deepEqual(englishReviewTargets(segmented, translations, identity).map(row => row.text), ['Dana는', 'Dana']);
await reviewEnglishLeftovers({ segmented, translations, identity, request: async (_prompt, targets) => new Map(targets.map(row => [row.id, row.text.replace('Dana', '다나')])) });
assert.equal(assembleTranslation(segmented, translations), '다나는 기다렸다. "Hi, Dana. (안녕, 다나.)"');

// A user-defined spelling is applied AFTER resolving the macro, including
// correct single particles and English source spelling in paired dialogue.
const locks = [{ source: 'Dana', target: '다나' }];
const lockedIdentity = resolveOutputSpeakerIdentity({ userName: 'Dana', characterName: 'Christopher' }, locks);
assert.equal(resolveTranslationNameMacros('{{user}}', lockedIdentity), 'Dana');
const locked = segmentSource('{{user}} waited.', locks, { speakerIdentity: lockedIdentity });
const name = locked.nameTokens[0].token;
assert.equal(assembleTranslation(locked, new Map([[locked.segments[0].id, `${name}은(는) 기다렸다.`]])), '다나는 기다렸다.');
const lockedPair = segmentSource('"Hi, {{user}}."', locks, { speakerIdentity: lockedIdentity });
const ds = lockedPair.segments[0];
const paired = ensureBilingualDialogueFormat(ds, `"안녕, ${lockedPair.nameTokens[0].token}."`, { allDialoguePromptEnabled: true, allDialoguePrompt: 'Use bilingual dialogue: English original (한국어 번역).' }, null, lockedPair.nameTokens, lockedPair.tokens);
assert.equal(assembleTranslation(lockedPair, new Map([[ds.id, paired]])), '"Hi, Dana. (안녕, 다나.)"');
const englishLock = segmentSource('{{user}} waited.', [{ source: 'Dana', target: 'Dana' }], { speakerIdentity: identity });
assert.equal(assembleTranslation(englishLock, new Map([[englishLock.segments[0].id, `${englishLock.nameTokens[0].token}는 기다렸다.`]])), 'Dana는 기다렸다.');

// Actual output entry point passes the identity to segmentation before either
// the minimal branch or normal planning. Both use the same prepared source.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const body = index.slice(index.indexOf('async function translateOutputText('), index.indexOf('function inputIdentitySpellingContext('));
let minimal = true;
const env = {
    settings: {}, normalizedCharacterNameLocks: () => [], segmentSource,
    minimalOutputEnabled: () => minimal,
    translateMinimalOutput: async prepared => prepared,
    requestSegments: () => {}, buildSourceMap: () => [], reviewFinalEnglish: () => {},
    planRepeatedRoleTermLocks: async prepared => {
        assert.equal(prepared.source, 'Dana waited. "Hi, Dana."');
        throw Error('normal path reached with resolved names');
    },
};
const translate = Function(...Object.keys(env), body + '\nreturn translateOutputText;')(...Object.values(env));
const prepared = await translate(raw, { speakerIdentity: identity });
assert.equal(prepared.source, segmented.source);
minimal = false;
await assert.rejects(translate(raw, { speakerIdentity: identity }), /normal path reached with resolved names/);

// The real minimal pipeline also exposes leftovers to the final review and
// preserves the source English in bilingual pairs.
let reviews = 0;
const result = await translateMinimalOutput(segmented, { developerMode: true, developerMinimalPromptEnabled: true }, { speakerIdentity: identity }, {
    requestSegments: async (_prompt, segments) => new Map(segments.map(segment => [segment.id, segment.type === 'dialogue_candidate' ? '"Hi, Dana. (안녕, Dana.)"' : 'Dana는 기다렸다.'])),
    buildSourceMap: () => [],
    reviewEnglish: async args => {
        reviews++;
        await reviewEnglishLeftovers({ ...args, identity: args.speakerIdentity, request: async (_prompt, targets) => new Map(targets.map(row => [row.id, row.text.replace('Dana', '다나')])) });
    },
});
assert.equal(reviews, 1);
assert.equal(result.translation, '다나는 기다렸다. "Hi, Dana. (안녕, 다나.)"');
console.log('PASS: visible identity macros, protected contexts, name locks/particles, bilingual source, normal/minimal entry and final review.');
