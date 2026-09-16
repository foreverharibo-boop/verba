import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.ok(index.includes('value="selection"> 선택 범위만'));
assert.ok(!index.includes('> 선택 주변</label>'));

const defaultsStart = index.indexOf('const RELATION_TEMPERATURE_OPTIONS');
const defaultsEnd = index.indexOf('const baseContext =');
const defaults = Function(`${index.slice(defaultsStart, defaultsEnd)}\nreturn DEFAULT_SETTINGS;`)();

const translation = 'LEFT_KOREAN_SENTINEL선택문RIGHT_KOREAN_SENTINEL';
const start = 'LEFT_KOREAN_SENTINEL'.length;
const end = 'LEFT_KOREAN_SENTINEL선택문'.length;
const single = core.buildSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    sourceContext: 'MATCHED_SOURCE_ONLY',
    translation,
    selected: '선택문',
    start,
    end,
    settings: defaults,
    contextMode: 'selection',
});
assert.ok(single.includes('MATCHED_SOURCE_ONLY'));
assert.ok(single.includes('선택문'));
assert.ok(!single.includes('FULL_SOURCE_SENTINEL'));
assert.ok(!single.includes('LEFT_KOREAN_SENTINEL'));
assert.ok(!single.includes('RIGHT_KOREAN_SENTINEL'));

const missingMap = core.buildSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    sourceContext: '',
    translation,
    selected: '선택문',
    start,
    end,
    settings: defaults,
    contextMode: 'selection',
});
assert.ok(!missingMap.includes('FULL_SOURCE_SENTINEL'));

const multi = core.buildMultiSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    translation,
    selections: [{
        id: 'multi_0000',
        selected: '선택문',
        sourceContext: 'MATCHED_SOURCE_ONLY',
        start,
        end,
    }],
    settings: defaults,
    contextMode: 'selection',
});
assert.ok(multi.includes('MATCHED_SOURCE_ONLY'));
assert.ok(!multi.includes('FULL_SOURCE_SENTINEL'));
assert.ok(!multi.includes('LEFT_KOREAN_SENTINEL'));
assert.ok(!multi.includes('RIGHT_KOREAN_SENTINEL'));

const slice = (startMarker, endMarker) => {
    const begin = index.indexOf(startMarker);
    const finish = index.indexOf(endMarker, begin + startMarker.length);
    assert.ok(begin >= 0 && finish > begin, `missing source boundary: ${startMarker}`);
    return index.slice(begin, finish);
};
const env = {};
vm.runInNewContext([
    slice('function normalizedSourceMap(', 'function normalizedLockedSegments('),
    slice('function selectionSourceContext(', 'function bundleStillCurrent('),
    'globalThis.sourceContext = selectionSourceContext;',
].join('\n'), env);

const snapshot = {
    source: 'FULL_SOURCE_SENTINEL',
    sourceMap: [
        { id: 'a', source: 'SOURCE_A', start: 0, end: 10 },
        { id: 'b', source: 'SOURCE_B', start: 10, end: 20 },
        { id: 'c', source: 'SOURCE_C', start: 20, end: 30 },
    ],
    start: 12,
    end: 18,
};
assert.equal(env.sourceContext(snapshot, 'selection'), 'SOURCE_B');
assert.equal(env.sourceContext({ ...snapshot, sourceMap: [] }, 'selection'), '');
assert.equal(env.sourceContext(snapshot, 'paragraph'), 'SOURCE_A\n\nSOURCE_B\n\nSOURCE_C');
assert.equal(env.sourceContext(snapshot, 'message'), 'FULL_SOURCE_SENTINEL');

console.log('PASS: selection-only retranslation sends no surrounding Korean or full-source fallback.');
