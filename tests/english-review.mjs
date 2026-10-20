import assert from 'node:assert/strict';
import fs from 'node:fs';
import { englishReviewTargets, reviewEnglishLeftovers } from '../english-review.js';
import { protectSource } from '../core.js';
import { collectSegmentResponse } from '../response-parser.js';

const narration = { id: 's0', type: 'narration', text: 'Dana smiled at Christopher.' };
const dialogue = { id: 's1', type: 'dialogue_candidate', text: '"Hello, Dana."' };
const segmented = { segments: [narration, dialogue], nameTokens: [], tokens: [] };
const initial = new Map([
    ['s0', 'Dana은(는) 크리스토퍼에게 웃었다.'],
    ['s1', '"Hello, Dana. (안녕, Dana.)"'],
]);
const targets = englishReviewTargets(segmented, initial);
assert.deepEqual(targets.map(row => row.text), ['Dana은(는)', 'Dana']);
const translated = new Map(initial); let calls = 0;
const result = await reviewEnglishLeftovers({ segmented, translations: translated, request: async (prompt, rows) => {
    calls++; assert.match(prompt, /USER\/PERSONA/);
    return new Map(rows.map(row => [row.id, row.text.includes('은') ? '다나는' : '다나']));
} });
assert.equal(calls, 1); assert.equal(result.changed, 2);
assert.equal(translated.get('s0'), '다나는 크리스토퍼에게 웃었다.');
assert.equal(translated.get('s1'), '"Hello, Dana. (안녕, 다나.)"');

// A completely untranslated Korean half must still leave the English half alone.
const englishPair = { segments: [{ id: 's', type: 'dialogue_candidate', text: '"Hello."' }] };
assert.deepEqual(englishReviewTargets(englishPair, new Map([['s', '"Hello. (Hello.)"']])).map(row => row.text), ['Hello']);
assert.equal(englishReviewTargets(segmented, new Map([['s0', '그는 coffee를 마셨다.'], ['s1', '"Hello, Dana. (안녕, 다나.)"']]))[0].text, 'coffee를');

const protectedText = '다나는 `Dana`와 ```js\nconst coffee = 1;\n``` https://example.com/Dana {{user}} user@example.com @dana 155cm를 확인했다.';
const token = protectSource('`code`').tokens[0].token;
const guarded = { segments: [narration], nameTokens: [{ value: 'Dana' }] };
assert.equal(englishReviewTargets(guarded, new Map([['s0', `${protectedText} ${token} Dana는 웃었다.`]])).length, 0);
assert.equal(englishReviewTargets({ segments: [narration] }, new Map([['s0', '<span class="coffee">coffee를 마셨다.</span>']]))[0].text, 'coffee를');
assert.equal(englishReviewTargets({ segments: [narration] }, new Map([['s0', '다나는 웃었다.']])).length, 0);

for (const request of [
    async () => { throw new Error('network'); },
    async () => new Map(),
    async (_p, rows) => new Map(rows.map(row => [row.id, ''])),
    async (_p, rows) => new Map(rows.map(row => [row.id, '@@VERBA_9999@@'])),
    async (_p, rows) => new Map(rows.map(row => [row.id, '<script>무엇</script>'])),
]) {
    const values = new Map(initial);
    await reviewEnglishLeftovers({ segmented, translations: values, request });
    assert.deepEqual(values, initial, 'failed/invalid review retains the original');
}
let unnecessary = 0;
const unused = async () => { unnecessary++; throw new Error('should not run'); };
await reviewEnglishLeftovers({ segmented, translations: initial, settings: { translationEngine: 'google-free' }, request: unused });
await reviewEnglishLeftovers({ segmented: { segments: [narration] }, translations: new Map([['s0', '다나는 웃었다.']]), request: unused });
assert.equal(unnecessary, 0);
const acronym = new Map([['s0', '그는 USB를 확인했다.']]);
await reviewEnglishLeftovers({ segmented: { segments: [narration] }, translations: acronym, request: async (_p, rows) => new Map(rows.map(row => [row.id, row.text])) });
assert.equal(acronym.get('s0'), '그는 USB를 확인했다.');
const controller = new AbortController();
await assert.rejects(reviewEnglishLeftovers({ segmented, translations: new Map(initial), options: { signal: controller.signal }, request: async () => { controller.abort(); throw new Error('cancel'); } }));

// Repeated names keep stable offsets even when replacements are shorter.
const repeated = new Map([['s0', 'Dana는 Dana를 보았다.']]);
await reviewEnglishLeftovers({ segmented: { segments: [narration] }, translations: repeated, request: async (_p, rows) => new Map(rows.map(row => [row.id, row.text.replace('Dana', '다나')])) });
assert.equal(repeated.get('s0'), '다나는 다나를 보았다.');

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const output = index.slice(index.indexOf('async function translateOutputText'), index.indexOf('function inputIdentitySpellingContext'));
assert.ok(output.indexOf('await reviewFinalEnglish') < output.indexOf('const result = assembleTranslation'));
const transport = index.slice(index.indexOf('async function reviewFinalEnglish'), index.indexOf('async function translateOutputText'));
assert.match(transport, /sendProfileRequest/);
assert.ok(!transport.includes('sendWithRetry') && !transport.includes('sendProfileRaceAttempt'));
const minimal = fs.readFileSync(new URL('../minimal-output.js', import.meta.url), 'utf8');
assert.match(minimal, /await reviewEnglish\?\./);
assert.match(minimal, /POST_TRANSLATION_AI_REPAIR_ENABLED = false/);

let transportCalls = 0;
const finalReview = Function('reviewEnglishLeftovers', 'settings', 'configuredProfileCycle', 'sendProfileRequest',
    'normalizedProfileFailureTimeoutSeconds', 'collectPartialSegmentTranslations', 'extractResponseText', 'console',
    transport + '\nreturn reviewFinalEnglish;')(
    reviewEnglishLeftovers, {}, () => ({ active: 'profile-B', slot: 'B' }),
    async (_prompt, options) => {
        transportCalls++;
        assert.equal(options.profileId, 'profile-B');
        assert.equal(options.profileSlot, 'B');
        assert.equal(options.timeoutSecondsOverride, 60);
        assert.equal(options.stage, 'final-english-review');
        return JSON.stringify({ segments: [{ id: 'english_0000', translation: '다나는' }] });
    }, () => 180, collectSegmentResponse, value => value, { warn() {} },
);
const finalMap = new Map([['s0', initial.get('s0')]]);
await finalReview({ segmented: { segments: [narration] }, translations: finalMap });
assert.equal(transportCalls, 1);
assert.equal(finalMap.get('s0'), '다나는 크리스토퍼에게 웃었다.');
console.log('PASS: narration/short names, bilingual halves, code/URL/locks, bounded transport, failure fallback and both output paths.');
