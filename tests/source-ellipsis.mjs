import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { repairSourceEllipses as repair, selectionEllipsisReference as reference, repairUnexpectedProseBreaks, collectSegmentResponse } from '../response-parser.js';
import { segmentSource, assembleTranslation } from '../core.js';
const target = text => ({ id: 'seg_0000', type: 'narration', text });
let checks = 0;
for (const sourceMark of ['..', '...', '......', '…', '……', '………'])
for (const translatedMark of ['..', '...', '......', '…', '……', '…….', '...…'])
for (const type of ['narration', 'dialogue_candidate', 'target_dialogue', 'other_dialogue', 'selection', 'multi_selection']) {
 const segment = { ...target('Wait' + sourceMark + ' really?'), type };
 const text = '잠깐' + translatedMark + ' 정말?';
 const expected = '잠깐' + sourceMark + ' 정말?';
 assert.equal(repair(text, segment), expected);
 assert.equal(repair(expected, segment), expected, 'idempotent');
 const result = collectSegmentResponse(JSON.stringify({ segments: [{ id: segment.id, translation: text }] }), [segment]);
 assert.equal(result.parseError, null, 'no retry for punctuation');
 assert.equal(result.partial.get(segment.id), expected);
 assert.equal(result.repairs.some(x => x.includes('말줄임표')), text !== expected);
 checks += 5;
}
assert.equal(repair('첫째…… 둘째... 셋째…', target('First... second… third......')), '첫째... 둘째… 셋째......');
assert.equal(repair('😀 잠깐……\n정말……?', target('😀 Wait...\nReally…?')), '😀 잠깐...\n정말…?');
for (const [source, translation] of [
 ['No pause.', '없는… 말줄임표'],
 ['One... pause.', '하나…… 추가……'],
 ['Two... more…', '빠진…… 말줄임표'],
 ['Wait...', '말줄임표 누락'],
 ['3.14 and 1..9', '3.14와 1..9'],
 ['../.../file', '../.../file'],
 ['https://example.com/a...b', 'https://example.com/a......b'],
 ['www.example.com/a...b', 'www.example.com/a......b'],
 ['{{macro...}} @@VERBA_NAME_...@@', '{{macro...}} @@VERBA_NAME_......@@'],
 ['<div>Wait...</div>', '<div>잠깐……</div>'],
 [String.fromCharCode(96) + 'code...', '코드……'],
 ['~~~code...', '코드……'],
]) assert.equal(repair(translation, target(source)), translation);
assert.equal(repair('주소 https://example.com/a...b 잠깐……', target('URL https://example.com/a...b wait...')), '주소 https://example.com/a...b 잠깐...');
for (const type of ['tagged_content', 'passthrough', 'role_term', 'name_match', 'user_input']) {
 assert.equal(repair('잠깐……', { ...target('Wait...'), type }), '잠깐……');
}
assert.equal(repair(undefined, target('Wait...')), undefined);
assert.equal(repair('잠깐……', {}), '잠깐……');
const original = 'He waited...\n\n"Really…?"\n\n<Info_panel>Code: 1.25...</Info_panel>\n\n~~~js\nconst x = [...rows];\n~~~';
const segmented = segmentSource(original);
const translations = new Map(segmented.segments.map(s => [s.id, s.type === 'tagged_content' ? s.text : s.text.replaceAll('...', '……').replace('Really…', 'Really......')]));
const output = assembleTranslation(segmented, translations);
assert.equal(output, original, 'final surface repair protects structure and code');
for (const row of segmented.segments) {
 if (row.type !== 'tagged_content') assert.equal(translations.get(row.id), row.text, 'source-map offsets use corrected text');
}
const snapshot = { source: 'Wait...', translation: '잠깐……', selected: '잠깐……', start: 0, end: 4 };
assert.equal(reference(snapshot), 'Wait...');
const rows = [{ start: 2, end: 7, source: 'First...' }, { start: 7, end: 12, source: 'Second…' }];
assert.equal(reference({ selected: '선택', start: 2, end: 12, sourceMap: rows }), 'First...\n\nSecond…');
assert.equal(reference({ selected: '부분…', start: 3, end: 6, sourceMap: rows }), '부분…', 'no guessing partial original alignment');
assert.equal(reference({ selected: '선택...', start: 2, end: 6 }), '선택...');
const selection = { id: 'seg_0000', type: 'selection', text: '잠깐……', ellipsisSource: 'Wait...' };
assert.equal(repair('잠깐만……', selection), '잠깐만...');
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const expression = index.match(/\.map\(candidate => (repairSourceEllipses\([^\n]+)\);/)[1];
const clean = Function('candidate', 'repairSourceEllipses', 'repairUnexpectedProseBreaks', 'repairKoreanParticleAlternatives', 'repairIndivisibleIdentityNames', 'speakerIdentity', 'expected', 'return ' + expression);
const candidates = ['잠깐만......', '잠시……\n기다려.', '아니……<br>기다려.'];
assert.deepEqual(candidates.map(c => clean(c, repair, repairUnexpectedProseBreaks, x => x, x => x, {}, [selection])),
 ['잠깐만...', '잠시... 기다려.', '아니... 기다려.']);
assert.match(index, /type: 'selection', text: snapshot.selected, ellipsisSource: selectionEllipsisReference\(snapshot\)/);
assert.match(index, /type: 'multi_selection', text: row.selected, ellipsisSource: selectionEllipsisReference\(\{ \.\.\.state, \.\.\.row \}\)/);
const sample = ('Wait... then pause… finally...... ' + 'a'.repeat(90)).repeat(200);
const translated = sample.replaceAll('...', '……');
const t0 = performance.now();
for (let i = 0; i < 100; i++) repair(translated, target(sample));
console.log('PASS: ' + checks + ' ellipsis assertions plus parser/assembly/candidate/selection/protected-content integration; local mean ' + ((performance.now() - t0) / 100).toFixed(3) + ' ms for ' + sample.length + ' characters. No API calls.');
