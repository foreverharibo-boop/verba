import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { segmentSource, assembleTranslation, restoreTranslationSurface, restoreProtected,
    recoverSourceMapGaps, normalizeBilingualMappedTranslation } from '../core.js';
import { escapeCodeTranslation } from '../code-content.js';

const code = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start) + 1));
const build = Function('restoreProtected', 'restoreTranslationSurface', 'recoverSourceMapGaps', 'escapeCodeTranslation',
    slice('function restoredSegmentText(', 'const CONSISTENCY_ROLE_TERMS') + '\nreturn buildSourceMap;')(
    restoreProtected, restoreTranslationSurface, recoverSourceMapGaps, escapeCodeTranslation);
const source = 'Mira stood by the door.\n\n"Hello," Mira said. "Welcome."\n\nMira waited.';
function fixture() {
    const segmented = segmentSource(source, [{ source: 'Mira', target: '미라' }]);
    const values = ['미라는 문 옆에 섰다.', '"안녕,"', '미라가 말했다.', '"어서 와."', '미라는 기다렸다.'];
    const translations = new Map(segmented.segments.map((s, i) => [s.id, values[i]]));
    const translation = assembleTranslation(segmented, translations);
    const complete = build(segmented, translations, translation);
    const partial = complete.filter(row => ['seg_0001', 'seg_0003'].includes(row.id));
    return { segmented, translation, complete, partial };
}

test('recovers first, middle and last isolated narration using existing anchors', () => {
    const { segmented, translation, complete, partial } = fixture();
    assert.equal(complete.length, 5);
    for (const input of [segmented, segmentSource(source)]) {
        const restored = recoverSourceMapGaps(input, translation, partial);
        assert.deepEqual(restored, complete);
        assert.equal(restored[0].start, 0);
        assert.equal(restored[0].source, 'Mira stood by the door.');
        for (const row of partial) assert.ok(restored.includes(row));
        assert.equal(recoverSourceMapGaps(input, translation, restored), restored);
    }
    assert.equal(partial.length, 2); // No mutation of saved metadata.
});

test('does not fabricate alignment for absent anchors or multiple missing targets', () => {
    const { segmented, translation, complete } = fixture();
    assert.deepEqual(recoverSourceMapGaps(segmented, translation, []), []);
    const onlyLast = [complete.at(-1)];
    assert.equal(recoverSourceMapGaps(segmented, translation, onlyLast), onlyLast);
    // A dialogue row is deliberately outside this narrow narration recovery.
    const missingDialogue = complete.filter(row => row.id !== 'seg_0001');
    assert.equal(recoverSourceMapGaps(segmented, translation, missingDialogue), missingDialogue);
});

test('rejects changed/merged/duplicate/overlapping/out-of-bounds anchor metadata', () => {
    const { segmented, translation, partial } = fixture();
    const variations = [
        partial.map((r, i) => i ? r : { ...r, source: 'Unrelated original.' }),
        partial.map((r, i) => i ? r : { ...r, id: 'seg_0001__selection' }),
        [partial[0], partial[0]], [...partial].reverse(),
        partial.map((r, i) => i ? { ...r, start: partial[0].start } : r),
        partial.map((r, i) => i ? { ...r, end: translation.length + 1 } : r),
        partial.map((r, i) => i ? r : { ...r, start: -1 }),
    ];
    for (const rows of variations) assert.equal(recoverSourceMapGaps(segmented, translation, rows), rows);
});

test('changed paragraph separators and extra hard wraps are not assigned to a missing row', () => {
    const { segmented, translation, partial } = fixture();
    for (const changed of [translation.replace('\n\n', '  '), translation.replace('문 옆', '문\n옆')]) {
        const result = recoverSourceMapGaps(segmented, changed, partial);
        assert.ok(!result.some(row => row.id === 'seg_0000'));
    }
});

test('application normalization repairs metadata without altering the translation', () => {
    const { translation, complete, partial } = fixture();
    const result = normalizeBilingualMappedTranslation(translation, partial, {}, source);
    assert.equal(result.translation, translation);
    assert.deepEqual(result.sourceMap, complete);
});

test('existing saved record gets a recovered selection view without mutation or retranslating', () => {
    const { translation, complete, partial } = fixture();
    const record = { translation, sourceMap: partial };
    const current = Function('isTranslationExtensionActive', 'EXTENSION_KEY', 'currentRecord',
        'recoverSourceMapGaps', 'segmentSource', 'messageSource', 'normalizedSourceMap',
        slice('function currentSelectionRecord(', 'function currentSwipeExtra(') + '\nreturn currentSelectionRecord;')(
        () => true, 'test', () => record, recoverSourceMapGaps, segmentSource, () => source, rows => rows);
    const view = current({});
    assert.deepEqual(view.sourceMap, complete);
    assert.equal(view.translation, translation);
    assert.equal(record.sourceMap, partial);
    const edit = Function('normalizedSourceMap', slice('function sourceMapAfterSelection(', 'function refreshedSourceMap(')
        + '\nreturn sourceMapAfterSelection;')(rows => rows);
    const edited = edit(view.sourceMap, 0, complete[0].end, '문가에 선 미라.');
    assert.equal(edited[0].source, 'Mira stood by the door.');
    assert.equal(edited[0].end, '문가에 선 미라.'.length);
});
