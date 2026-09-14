import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => {
    const begin = index.indexOf(start);
    const finish = index.indexOf(end, begin + start.length);
    assert.ok(begin >= 0 && finish > begin, `missing source boundary: ${start}`);
    return index.slice(begin, finish);
};
const env = {};
vm.runInNewContext([
    slice('function normalizedSourceMap(', 'function normalizedLockedSegments('),
    slice('function sourceMapAfterSelection(', 'function refreshedSourceMap('),
    'globalThis.updateMap = sourceMapAfterSelection;',
].join('\n'), env);

const plain = value => JSON.parse(JSON.stringify(value));
const rows = [
    { id: 'a', source: 'SOURCE A', start: 0, end: 10 },
    { id: 'b', source: 'SOURCE B', start: 10, end: 20 },
    { id: 'c', source: 'SOURCE C', start: 20, end: 30 },
];

assert.deepEqual(plain(env.updateMap(rows, 12, 18, 'XYZ')), [
    rows[0],
    { id: 'b', source: 'SOURCE B', start: 10, end: 17 },
    { id: 'c', source: 'SOURCE C', start: 17, end: 27 },
]);

assert.deepEqual(plain(env.updateMap(rows, 5, 15, 'EDIT')), [
    { id: 'a__selection', source: 'SOURCE A\n\nSOURCE B', start: 0, end: 14 },
    { id: 'c', source: 'SOURCE C', start: 14, end: 24 },
]);

const once = env.updateMap(rows, 15, 25, 'LONGER EDIT');
const twice = plain(env.updateMap(once, 5, 12, 'Q'));
assert.equal(twice[0].source, 'SOURCE A\n\nSOURCE B\n\nSOURCE C');
assert.ok(twice[0].start <= 5 && twice[0].end > 5);

assert.deepEqual(plain(env.updateMap(rows, 30, 32, 'ABCDE')), rows);

console.log('PASS: selection retranslation preserves source mapping across single, crossed, and repeated ranges.');
