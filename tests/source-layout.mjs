import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { repairUnexpectedProseBreaks as repair, repairSourceEllipses, collectSegmentResponse } from '../response-parser.js';
import { segmentSource, assembleTranslation } from '../core.js';

const prose = { id: 'seg_0000', type: 'narration', text: 'He waited. She smiled.' };
const cases = [
    ['기다렸다.\n웃었다.', '기다렸다. 웃었다.'],
    ['기다렸다.\n\n웃었다.', '기다렸다. 웃었다.'],
    ['그는\n 기다렸다.', '그는 기다렸다.'],
    ['“안녕.”\n\n“왔어?”', '“안녕.” “왔어?”'],
    ['“\n안녕.\n”', '“안녕.”'],
    ['잠깐...\n아니…\n정말……?', '잠깐... 아니… 정말……?'],
    ['\r\n 처음.\r중간.\u2028다음.\u2029끝.\n', '처음. 중간. 다음. 끝.'],
    ['안녕~\n또 왔네.', '안녕~ 또 왔네.'],
    ['**정말.**\n*그래.*', '**정말.** *그래.*'],
    ['내용.\n@@VERBA_DEEP_NAME_0000@@가 왔다.', '내용. @@VERBA_DEEP_NAME_0000@@가 왔다.'],
    ['오전 7시.\n50미터.', '오전 7시. 50미터.'],
    ['첫 문장.<br>다음 문장.<BR />끝.', '첫 문장. 다음 문장. 끝.'],
    ['첫 문장.\n\n🙂 웃었다.', '첫 문장. 🙂 웃었다.'],
    ['문자 그대로 \\n 표시', '문자 그대로 \\n 표시'],
];
let checks = 0;
for (const type of ['narration', 'dialogue_candidate', 'target_dialogue', 'other_dialogue', 'selection', 'multi_selection']) {
    for (const [before, after] of cases) {
        const target = { ...prose, type };
        assert.equal(repair(before, target), after);
        assert.equal(repair(after, target), after, 'idempotent');
        const result = collectSegmentResponse(JSON.stringify({ segments: [{ id: prose.id, translation: before }] }), [target]);
        assert.equal(result.parseError, null, 'layout repair must not request an AI retry');
        assert.equal(result.partial.get(prose.id), after);
        assert.equal(before.replace(/<br\s*\/?\s*>|\s/giu, ''), after.replace(/\s/gu, ''), 'no non-whitespace text changes');
        checks += 5;
    }
}
const candidate = '첫 문장.\n\n다음 문장.';
for (const text of ['First\nSecond', 'First\r\nSecond', 'First\u2028Second', '<div>First</div>', '`First`', '~~~code~~~', '', undefined]) {
    assert.equal(repair(candidate, { ...prose, text }), candidate);
}
for (const type of ['tagged_content', 'user_input', 'name_match', 'role_term', 'passthrough']) {
    assert.equal(repair(candidate, { ...prose, type }), candidate);
}
for (const text of ['<div>내용\n내용</div>', '`내용\n내용`', '```js\na()\n```', '~~~\na()\n~~~']) {
    assert.equal(repair(text, prose), text);
}
assert.equal(repair(undefined, prose), undefined);

// Source paragraph/speaker gaps and protected bytes, including CRLF and HTML,
// survive assembly. Only the translated single-line span loses its added break.
for (const gap of ['\n', '\n\n', '\r\n\r\n', '\n\n\n']) {
    const source = 'He waited.' + gap + '"Come here."' + gap + '<Info_block>Time: 0700<br>Weather: clear</Info_block>' + gap + '```js\nconst x = 1;\n```';
    const segmented = segmentSource(source);
    const translations = new Map(segmented.segments.map(s => [s.id, s.type === 'tagged_content' ? s.text : s.type === 'dialogue_candidate' ? '“이리\n 와.”' : '기다렸다.\n\n웃었다.']));
    assert.equal(assembleTranslation(segmented, translations), '기다렸다. 웃었다.' + gap + '“이리 와.”' + gap + '<Info_block>Time: 0700<br>Weather: clear</Info_block>' + gap + '```js\nconst x = 1;\n```');
}

// Exercise the exact candidate cleanup expression used by the UI without
// browser dependencies; no network request is involved in this step.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const expression = index.match(/\.map\(candidate => (repairSourceEllipses\([^\n]+)\);/)[1];
const cleanCandidate = Function('candidate', 'repairUnexpectedProseBreaks', 'repairKoreanParticleAlternatives', 'repairOutputIdentityNames', 'speakerIdentity', 'expected', 'repairSourceEllipses', 'return ' + expression);
assert.equal(cleanCandidate(candidate, repair, x => x, x => x, {}, [prose], repairSourceEllipses), '첫 문장. 다음 문장.');

const sample = ('그는 기다렸다.\n\n그녀는 웃었다. '.repeat(1500));
const t0 = performance.now();
for (let i = 0; i < 300; i++) repair(sample, prose);
console.log(`PASS: ${checks} layout assertions plus protected layout/candidate checks; ${sample.length} chars, mean ${((performance.now() - t0) / 300).toFixed(3)} ms/local pass (container, not phone).`);
