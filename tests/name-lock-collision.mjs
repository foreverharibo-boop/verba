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
    'safeLocalNameReplacement',
    'sourceMapAfterSelection',
    'sourceMapAfterGlobalReplacements',
    'normalizedLockedSegments',
    'hashText',
    'STATE_KEY',
    `${index.slice(replaceStart, replaceEnd)}\nreturn replaceStoredNameInExtra;`,
)(
    (source, name) => new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(source),
    extra => ({ record: extra.state, translation: extra.state.translation }),
    value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
    core.replaceOutsideProtected,
    (source, translation, sourceName, oldNames) => {
        const sourceCount = [...source.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${sourceName}(?![\\p{L}\\p{N}_])`, 'giu'))].length;
        const translatedCount = oldNames.reduce((count, name) => count + translation.split(name).length - 1, 0);
        return sourceCount > 0 && translatedCount > 0 && translatedCount <= sourceCount;
    },
    (rows, start, end, replacement) => {
        const delta = replacement.length - (end - start);
        return rows.map(row => {
            if (row.start === start && row.end === end) return { ...row, end: row.end + delta };
            if (row.start >= end) return { ...row, start: row.start + delta, end: row.end + delta };
            return row;
        });
    },
    (rows, previousTranslation, nextTranslation, replacements) => rows.map(row => {
        let translated = previousTranslation.slice(row.start, row.end);
        for (const replacement of replacements) {
            translated = core.replaceOutsideProtected(translated, replacement.search, replacement.value);
        }
        const start = nextTranslation.indexOf(translated);
        return start < 0 ? row : { ...row, start, end: start + translated.length };
    }),
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

const legacyExtra = {
    display_text: '데이나가 웃었다. 데이나는 손을 흔들었다.',
    state: {
        translation: '데이나가 웃었다. 데이나는 손을 흔들었다.',
        sourceMap: [],
        lockedSegments: [],
    },
};
assert.equal(
    replaceStoredNameInExtra(legacyExtra, 'Dana smiled. Dana waved.', 'Dana', ['데이나'], '다나', 0),
    true,
);
assert.equal(legacyExtra.state.translation, '다나가 웃었다. 다나는 손을 흔들었다.');

const ambiguousExtra = {
    display_text: repeatedTranslation,
    state: {
        translation: repeatedTranslation,
        sourceMap: [sharedRowSnapshot.sourceMap[0]],
        lockedSegments: [],
    },
};
assert.equal(
    replaceStoredNameInExtra(ambiguousExtra, sharedRowSnapshot.source, 'Nyon', ['니옌'], '니욘', 0),
    false,
);
assert.equal(ambiguousExtra.state.translation, repeatedTranslation);

const currentStart = index.indexOf('function replaceNameInCurrentSnapshot');
const currentEnd = index.indexOf('function replaceNameInKoreanRawSource', currentStart);
assert.ok(currentStart >= 0 && currentEnd > currentStart);
const replaceNameInCurrentSnapshot = Function(
    'normalizedSourceMap',
    'sourceContainsExactName',
    'safeLocalNameReplacement',
    'replaceOutsideProtected',
    'sourceMapAfterSelection',
    `${index.slice(currentStart, currentEnd)}\nreturn replaceNameInCurrentSnapshot;`,
)(
    value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
    (source, name) => new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(source),
    (source, translation, sourceName, oldNames) => {
        const sourceCount = [...source.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${sourceName}(?![\\p{L}\\p{N}_])`, 'giu'))].length;
        const translatedCount = oldNames.reduce((count, name) => count + translation.split(name).length - 1, 0);
        return sourceCount > 0 && translatedCount > 0 && translatedCount <= sourceCount;
    },
    core.replaceOutsideProtected,
    (rows, start, end, replacement) => {
        const delta = replacement.length - (end - start);
        return rows.map(row => row.start >= end
            ? { ...row, start: row.start + delta, end: row.end + delta }
            : row.start <= start && row.end >= end
                ? { ...row, end: row.end + delta }
                : row);
    },
);
const ambiguousCurrent = replaceNameInCurrentSnapshot(
    sharedRowSnapshot,
    'Nyon',
    ['니옌'],
    '니욘',
);
assert.equal(ambiguousCurrent.translation, '니옌은 기다렸다. 니욘은 따라왔다.');

const repeatedDanaSnapshot = {
    source: 'Dana smiled. Dana waved.',
    translation: '데이나가 웃었다. 데이나는 손을 흔들었다.',
    selected: '데이나',
    start: 0,
    end: 3,
    sourceMap: [{ id: 'seg_0000', source: 'Dana smiled. Dana waved.', start: 0, end: 23 }],
};
assert.equal(
    replaceNameInCurrentSnapshot(repeatedDanaSnapshot, 'Dana', ['데이나'], '다나').translation,
    '다나가 웃었다. 다나는 손을 흔들었다.',
);

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
assert.ok(lockFlow.includes('detectHistoricalNameForms('));
assert.ok(lockFlow.includes('skipMessageId: snapshot.messageId'));
assert.ok(lockFlow.includes('replaceNameInCurrentSnapshot'));
assert.ok(lockFlow.includes('useAiHistory'));

const lockUiStart = index.indexOf('function requestNameLockTarget');
const lockUi = index.slice(lockUiStart, index.indexOf('function sourceContainsExactName', lockUiStart));
assert.match(lockUi, /verba-name-lock-ai-history/);
assert.match(lockUi, /AI로 다른 번역 표기·애매한 위치도 찾아 변경/);
assert.match(lockUi, /requestDetectedNameFormsConfirmation/);

const historyPrompt = core.buildNameHistoryFormsPrompt({
    sourceName: 'Dana',
    currentName: '데이나',
    candidates: ['데이나', '대나', '니옌'],
    contexts: [{ source: 'Dana waved to Nyen.', korean: '대나는 니옌에게 손을 흔들었다.' }],
});
assert.match(historyPrompt, /ALIGNED EVIDENCE/);
assert.match(historyPrompt, /Different source spellings are different identities/);

console.log('PASS: exact source identities stay separate; safe repeated names update locally, ambiguous rows change only the selected occurrence, and optional AI history uses aligned evidence.');
