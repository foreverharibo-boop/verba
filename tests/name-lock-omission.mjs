import assert from 'node:assert/strict';
import {
    assembleTranslation,
    findProtectedTokenIntegrityProblems,
    restoreProtected,
    segmentSource,
} from '../core.js';

const source = '"If Nyen finds out Nyon slept in Dana\'s room, Nyen will talk. Nyen will complain. Nyen will keep going."';
const segmented = segmentSource(source, [
    { source: 'Nyen', target: '니옌' },
    { source: 'Nyon', target: '니욘' },
    { source: 'Dana', target: '다나' },
]);

assert.equal(segmented.segments.length, 1);
const nyen = segmented.nameTokens.filter(row => row.source === 'Nyen');
const nyon = segmented.nameTokens.find(row => row.source === 'Nyon');
const dana = segmented.nameTokens.find(row => row.source === 'Dana');
assert.equal(nyen.length, 4);
assert.ok(nyon && dana);

// The Korean sentence legitimately keeps only two of four repeated Nyen
// subjects. Missing NAME tokens must not trigger AI repair or local insertion.
const translated = `"${nyon.token}이 ${dana.token} 방에서 잤다는 걸 ${nyen[0].token}이 알면, ${nyen[2].token}은 무례한 말을 할 거야."`;
const translations = new Map([[segmented.segments[0].id, translated]]);
assert.deepEqual(findProtectedTokenIntegrityProblems(segmented.segments, translations), []);

const assembled = assembleTranslation(segmented, translations);
assert.equal((assembled.match(/니옌/g) || []).length, 2);
assert.equal((assembled.match(/니욘/g) || []).length, 1);
assert.equal((assembled.match(/다나/g) || []).length, 1);
assert.doesNotMatch(assembled, /니옌니옌/);

// Missing names are allowed only when restoring registered NAME tokens.
assert.equal(restoreProtected('문장', [{ token: nyen[1].token, value: '니옌' }], {
    strict: true,
    allowMissing: true,
}), '문장');
assert.throws(() => restoreProtected('문장', [{ token: '@@VERBA_0000@@', value: '<tag>' }], {
    strict: true,
}), /보호 요소가 손상/);

// An extra or moved NAME token is still corruption and must be caught.
const extra = new Map([[segmented.segments[0].id, `${translated}${nyen[0].token}`]]);
assert.equal(findProtectedTokenIntegrityProblems(segmented.segments, extra).length, 1);

console.log('PASS: omitted repeated NAME tokens stay omitted; present names restore once; excess names and missing structural tokens remain strict.');
