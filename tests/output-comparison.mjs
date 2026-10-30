import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOutputText, createOutputComparison, sanitizeOutputComparison, appendOutputComparison, createOutputComparisonStore } from '../output-comparison.js';

const source = '*Stay quiet.*';
const good = '*Stay quiet. [조용히 있어.]*';
const bad = '*조용히 있어. [조용히 있어.]*';
const segmented = { segments: [{ id: 'seg_0000', type: 'narration', text: source }] };
const map = value => new Map([['seg_0000', value]]);

test('first response already contains duplicate Korean; no postprocessing blamed', () => {
    const trace = createOutputComparison(segmented, true);
    trace.response(map(bad)); trace.initial(map(bad)); trace.capture('english-review', map(bad));
    const report = trace.finish(bad);
    assert.equal(report.stages[0].totals.duplicateKoreanPairs, 1);
    assert.equal(report.stages[1].changedRows, 0);
    assert.equal(report.stages[1].newDuplicateRows, 0);
    assert.doesNotMatch(JSON.stringify(report), /Stay quiet|조용히|seg_0000/);
});

test('English lost and duplicate introduced by a later stage', () => {
    const trace = createOutputComparison(segmented, true);
    trace.initial(map(good)); trace.capture('dialogue-format', map(good)); trace.capture('english-review', map(bad));
    const report = trace.finish(bad);
    assert.equal(report.stages[0].totals.duplicateKoreanPairs, 0);
    assert.equal(report.stages[1].changedRows, 0);
    assert.equal(report.stages[2].lostLatinRows, 1);
    assert.equal(report.stages[2].newDuplicateRows, 1);
});

test('reverse bilingual order and real protected tokens are not duplicate Korean', () => {
    const reverse = summarizeOutputText('*조용히 있어. [Stay quiet.]*');
    assert.equal(reverse.duplicateKoreanPairs, 0);
    assert.equal(reverse.mixedLines, 1);
    assert.equal(summarizeOutputText('@@VERBA_NAME_0000@@ 조용히').latinLetters, 0);
    assert.equal(summarizeOutputText('@@VERBA_0000@@조용히@@VERBA_0001@@').latinLetters, 0);
});

test('split responses and parse retry preserve first accepted values', () => {
    const two = { segments: [...segmented.segments, { id: 'seg_0001', type: 'code_content', codeKind: 'fenced', text: 'Go.' }] };
    const trace = createOutputComparison(two, true);
    trace.response(map(good));
    trace.response(new Map([['seg_0001', 'Go. [가.]']]), 1);
    trace.initial(new Map([['seg_0000', bad], ['seg_0001', '가.']]));
    trace.capture('repairs', new Map([['seg_0000', bad], ['seg_0001', '가.']]));
    const report = trace.finish(bad);
    assert.equal(report.initialResponseBatches, 2);
    assert.equal(report.parseRetryResponses, 1);
    assert.equal(report.stages[0].totals.duplicateKoreanPairs, 0);
    assert.equal(report.stages[1].lostLatinRows, 2);
});

test('bounded details retain suspicious rows beyond first 32 segments', () => {
    const many = { segments: Array.from({ length: 100 }, (_, index) => ({ id: `seg_${index}`, text: source, type: 'narration' })) };
    const values = new Map(many.segments.map((s, i) => [s.id, i === 99 ? bad : good]));
    const trace = createOutputComparison(many, true); trace.initial(values);
    const stage = trace.finish('').stages[0];
    assert.equal(stage.rows.length, 32);
    assert.equal(stage.rowsOmitted, 68);
    assert.equal(stage.rows[0].index, 99);
    assert.equal(stage.totals.duplicateKoreanPairs, 1);
});

test('server whitelist discards arbitrary contents and unknown stages', () => {
    const report = sanitizeOutputComparison({ version: 1, source: 'SECRET', stages: [
        { stage: 'initial-parsed', text: 'SECRET', totals: { latinLetters: 'SECRET' }, rows: [{ index: 'SECRET', type: 'SECRET', text: 'SECRET', codeKind: 'SECRET' }] },
        { stage: 'SECRET', totals: {} },
    ] });
    assert.doesNotMatch(JSON.stringify(report), /SECRET/);
    assert.equal(report.stages.length, 1);
    assert.equal(report.contentIncluded, false);
});

test('local display normalization is tracked; wrong chat/swipe/source cannot reuse report', () => {
    const trace = createOutputComparison(segmented, true); trace.initial(map(good));
    let report = appendOutputComparison(trace.finish(good), 'received', undefined, good);
    assert.equal(report.stages.at(-1).comparedRows, 0);
    report = appendOutputComparison(report, 'display-normalization', good, bad);
    assert.equal(report.stages.at(-1).newDuplicateRows, 1);
    const store = createOutputComparisonStore(), message = {};
    store.set(message, 'hash1', 0, report);
    assert.ok(store.get(message, 'hash1', 0));
    assert.equal(store.get({}, 'hash1', 0), null);
    assert.equal(store.get(message, 'hash1', 1), null);
    assert.equal(store.get(message, 'hash2', 0), null);
    store.set(message, 'hash1', 0, null);
    assert.equal(store.get(message, 'hash1', 0), null);
});

test('disabled diagnostics are a no-op', () => {
    const trace = createOutputComparison(segmented, false);
    trace.response(map(bad)); trace.initial(map(bad)); trace.capture('english-review', map(good));
    assert.equal(trace.finish(good), null);
});
