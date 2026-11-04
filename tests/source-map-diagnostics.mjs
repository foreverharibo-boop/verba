import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sourceMapSummary, createSourceViewDiagnostics } from '../source-map-diagnostics.js';
import { hashText } from '../core.js';

const record = {
    translation: '앞문단.\n\n뒷문단.',
    sourceMap: [{ id: 'seg_0001', source: 'SECOND PRIVATE ORIGINAL', start: 6, end: 10 }],
};
const selection = { ...record, source: 'PRIVATE ORIGINAL', messageId: 118, swipeId: 0,
    selected: '앞문단.', start: 0, end: 4 };

test('diagnoses an unmapped first paragraph in an existing saved translation', () => {
    const report = sourceMapSummary(record, hashText, selection);
    assert.equal(report.validRowCount, 1);
    assert.equal(report.selection.outcome, 'unmapped-selection');
    assert.equal(report.selection.matchesStoredSlice, true);
    assert.deepEqual([report.rows[0].start, report.rows[0].end], [6, 10]);
    assert.equal(report.rows[0].sourceHash, hashText(record.sourceMap[0].source));
    const mapped = sourceMapSummary(record, hashText, { start: 6, end: 10, selected: '뒷문단.' });
    assert.equal(mapped.selection.outcome, 'mapped');
});

test('distinguishes missing, invalid, and out-of-bounds maps', () => {
    assert.equal(sourceMapSummary(null, hashText).present, false);
    assert.equal(sourceMapSummary({ translation: 'abc' }, hashText).hasMapArray, false);
    const report = sourceMapSummary({ translation: 'abc', sourceMap: [
        { source: '', start: 0, end: 1 }, { source: 'a', start: 0, end: 0 },
        { source: 'a', start: -2, end: 8 },
    ] }, hashText, { start: 10, end: 11 });
    assert.equal(report.invalidRowCount, 2);
    assert.equal(report.outOfBoundsCount, 1);
    assert.equal(report.selection.inBounds, false);
});

test('records selected message rather than last chat message; detects stale state without retaining text', () => {
    let enabled = false;
    const trace = createSourceViewDiagnostics({ enabled: () => enabled, hashText });
    trace.record(selection, record);
    assert.equal(trace.diagnostics().events.length, 0);
    enabled = true;
    trace.record(selection, record);
    trace.record(selection, { ...record, translation: 'changed' });
    const events = trace.diagnostics().events;
    assert.equal(events[0].messageId, 118);
    assert.equal(events[0].translationMatchesCurrent, true);
    assert.equal(events[1].translationMatchesCurrent, false);
    assert.equal(events[1].current.selection.matchesStoredSlice, false);
    const json = JSON.stringify(events);
    for (const privateText of ['PRIVATE ORIGINAL', record.translation, selection.selected]) {
        assert.ok(!json.includes(privateText));
    }
    selection.message = { secret: 'not retained' };
    selection.message.self = selection.message;
    for (let i = 0; i < 6; i++) trace.record(selection, record);
    assert.equal(trace.diagnostics().events.length, 4);
    events[0].snapshot.rows[0].start = 900;
    assert.equal(trace.diagnostics().events[0].snapshot.rows[0].start, 6);
    enabled = false;
    assert.equal(trace.diagnostics().events.length, 0);
});

test('caps long maps while retaining rows overlapping the selection', () => {
    const long = { translation: 'x'.repeat(1000), sourceMap: Array.from({ length: 200 }, (_, i) =>
        ({ id: `seg_${i}`, source: 'original', start: i * 4, end: i * 4 + 3 })) };
    const report = sourceMapSummary(long, hashText, { start: 796, end: 799, selected: 'xxx' });
    assert.equal(report.rows.length, 80);
    assert.equal(report.omittedRowCount, 120);
    assert.equal(report.selection.overlapCount, 1);
    assert.ok(report.rows.some(row => row.index === 199));
});

test('actual failed source-view handler captures offsets before hiding selection', () => {
    const code = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = code.indexOf('function showSelectionSource(');
    const end = code.indexOf('\nfunction ', start + 1);
    const trace = createSourceViewDiagnostics({ enabled: () => true, hashText });
    const notices = [];
    let hidden = false;
    const show = Function('settings', 'sourceViewDiagnostics', 'currentSelectionRecord',
        'normalizedSourceMap', 'notify', 'hideSelectionButton',
        code.slice(start, end) + '\nreturn showSelectionSource;')(
        { debugMode: true }, trace, () => record, rows => rows,
        text => notices.push(text), () => { hidden = true; });
    show(selection);
    assert.ok(hidden);
    assert.match(notices[0], /선택한 구간/);
    assert.equal(trace.diagnostics().events[0].snapshot.selection.outcome, 'unmapped-selection');
    assert.match(code, /sourceViewTrace: sourceViewDiagnostics\.diagnostics\(\)/);
    assert.match(code, /sourceMapSummary\(currentRecord\(latest\.message, latest\.id\), hashText\)/);
});
