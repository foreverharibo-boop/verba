import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

const matchStart = index.indexOf('const NAME_MATCH_SENTENCE_WORDS');
const matchEnd = index.indexOf('function previousAssistantMessages', matchStart);
assert.ok(matchStart >= 0 && matchEnd > matchStart);
const matchHelpers = Function(
    'normalizedCharacterNameLocks',
    'escapeRegularExpression',
    'selectionSourceRows',
    `${index.slice(matchStart, matchEnd)}\nreturn { selectionNameMatchContext, resolveSelectionSourceNameLocally };`,
)(
    () => [],
    value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    snapshot => (snapshot.sourceMap || []).filter(row => snapshot.start < row.end && snapshot.end > row.start),
);

const repeatedTranslation = '니옌은 기다렸다. 니옌은 따라왔다.';
const secondStart = repeatedTranslation.lastIndexOf('니옌');
const sharedRowSnapshot = {
    source: 'Nyen waited. Nyon followed.',
    translation: repeatedTranslation,
    selected: '니옌',
    start: secondStart,
    end: secondStart + 2,
    sourceMap: [{
        id: 'seg_0000',
        source: 'Nyen waited. Nyon followed.',
        start: 0,
        end: repeatedTranslation.length,
    }],
};
const sharedContext = matchHelpers.selectionNameMatchContext(sharedRowSnapshot);
assert.equal(matchHelpers.resolveSelectionSourceNameLocally(sharedContext), 'Nyon');

const firstTranslation = '니옌은 기다렸다. ';
const splitRowSnapshot = {
    ...sharedRowSnapshot,
    sourceMap: [
        { id: 'seg_0000', source: 'Nyen waited.', start: 0, end: firstTranslation.length },
        { id: 'seg_0001', source: 'Nyon followed.', start: firstTranslation.length, end: repeatedTranslation.length },
    ],
};
const splitContext = matchHelpers.selectionNameMatchContext(splitRowSnapshot);
assert.equal(splitContext.source, 'Nyon followed.');
assert.equal(matchHelpers.resolveSelectionSourceNameLocally(splitContext), 'Nyon');

const replaceStart = index.indexOf('function replaceStoredNameInExtra');
const replaceEnd = index.indexOf('function replaceNameInKoreanRawSource', replaceStart);
assert.ok(replaceStart >= 0 && replaceEnd > replaceStart);
const replaceStoredNameInExtra = Function(
    'sourceContainsExactName',
    'storedTranslationView',
    'normalizedSourceMap',
    'replaceOutsideProtected',
    'sourceMapAfterSelection',
    'normalizedLockedSegments',
    'hashText',
    'STATE_KEY',
    `${index.slice(replaceStart, replaceEnd)}\nreturn replaceStoredNameInExtra;`,
)(
    (source, name) => new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(source),
    extra => ({ record: extra.state, translation: extra.state.translation }),
    value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
    core.replaceOutsideProtected,
    (rows, start, end, replacement) => {
        const delta = replacement.length - (end - start);
        return rows.map(row => {
            if (row.start === start && row.end === end) return { ...row, end: row.end + delta };
            if (row.start >= end) return { ...row, start: row.start + delta, end: row.end + delta };
            return row;
        });
    },
    value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
    value => `hash:${value}`,
    'state',
);

const extra = {
    display_text: repeatedTranslation,
    state: {
        translation: repeatedTranslation,
        sourceMap: splitRowSnapshot.sourceMap,
        lockedSegments: [
            { id: 'seg_0000', source: 'Nyen waited.', translation: '니옌은 기다렸다.' },
            { id: 'seg_0001', source: 'Nyon followed.', translation: '니옌은 따라왔다.' },
        ],
    },
};
assert.equal(
    replaceStoredNameInExtra(extra, sharedRowSnapshot.source, 'Nyen', ['니옌'], '나이엔', 0),
    true,
);
assert.equal(extra.state.translation, '나이엔은 기다렸다. 니옌은 따라왔다.');
assert.equal(extra.state.lockedSegments[0].translation, '나이엔은 기다렸다.');
assert.equal(extra.state.lockedSegments[1].translation, '니옌은 따라왔다.');

const rawStart = index.indexOf('function replaceNameInKoreanRawSource');
const rawEnd = index.indexOf('function replaceNameAcrossChatTranslations', rawStart);
const replaceNameInKoreanRawSource = Function(
    'isPredominantlyKorean',
    'replaceOutsideProtected',
    `${index.slice(rawStart, rawEnd)}\nreturn replaceNameInKoreanRawSource;`,
)(() => true, core.replaceOutsideProtected);
assert.deepEqual(
    replaceNameInKoreanRawSource('니옌과 니욘이 만났다.', ['니옌'], '나이엔'),
    { changed: true, value: '나이엔과 니욘이 만났다.' },
);
const historyFlowStart = index.indexOf('function replaceNameAcrossChatTranslations');
const historyFlow = index.slice(historyFlowStart, index.indexOf('function requestSelectionCandidateChoice', historyFlowStart));
assert.ok(historyFlow.includes('replaceNameInKoreanRawSource(rawSource, candidates, targetName)'));
assert.ok(historyFlow.includes('replaceNameInKoreanRawSource(message.mes, candidates, targetName)'));

const lockFlowStart = index.indexOf('async function lockSelectionName');
const lockFlow = index.slice(lockFlowStart, index.indexOf('async function retranslateSelection', lockFlowStart));
assert.ok(!lockFlow.includes('detectHistoricalNameForms('));
assert.match(lockFlow, /snapshot\.translation\.slice\(0,\s*snapshot\.start\)/);
assert.ok(lockFlow.includes('skipMessageId: snapshot.messageId'));

console.log('PASS: Nyen/Nyon stay source-scoped while Korean raw chat/swipe global updates remain enabled.');
