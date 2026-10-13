import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { findRemainingProtectedTokens, normalizeBilingualMappedTranslation } from '../core.js';

assert.deepEqual(findRemainingProtectedTokens('정상 번역 {{user}} <b>이름</b> https://example.com'), []);
assert.deepEqual(findRemainingProtectedTokens('@@VERBA_0000@@ 두 번 @@VERBA_0000@@ / @@VERBA_NAME_0012@@'), [
    { token: '@@VERBA_0000@@', count: 2 }, { token: '@@VERBA_NAME_0012@@', count: 1 },
]);
const loose = '내용 ＠＠verba＿name＿ 0 0 1 2＠＠ 남음';
assert.deepEqual(findRemainingProtectedTokens(loose), [{ token: '@@VERBA_NAME_0012@@', count: 1 }]);
assert.deepEqual(findRemainingProtectedTokens('@@VERBA_12345@@'), [{ token: '@@VERBA_12345@@', count: 1 }]);

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = index.indexOf('function applyTranslation(');
const end = index.indexOf('\nfunction sourceViewRequested(', start);
assert.ok(start >= 0 && end > start);
const handler = index.slice(start, end);

function apply(translation, metadata = {}, active = true) {
    const events = [];
    const warnings = [];
    const message = { mes: 'original English', extra: {} };
    const env = {
        activateTranslationExtension: () => {},
        isTranslationExtensionActive: () => active,
        EXTENSION_KEY: 'verba', STATE_KEY: 'record', SOURCE_VIEW_KEY: 'sourceView',
        currentRecord: () => null,
        normalizedSourceMap: rows => rows || [],
        normalizedLockedSegments: rows => rows || [],
        currentSwipeId: () => 0, hashText: text => text,
        findRemainingProtectedTokens: text => {
            assert.equal(message.extra.display_text, undefined, 'inspection precedes display assignment');
            events.push('check');
            return findRemainingProtectedTokens(text);
        },
        rememberTranslationRecovery: () => events.push('recovery'),
        syncOwnedTranslationToCurrentSwipe: () => events.push('swipe'),
        multiSelectionState: null,
        updateMessageBlock: (_id, m) => {
            assert.equal(events[0], 'check');
            assert.equal(m.extra.display_text, translation);
            events.push('render');
            return { status: 'rendered', rendered: true };
        },
        cacheRenderedTranslation: () => events.push('cache'),
        scheduleChatSave: () => events.push('save'),
        console: { warn: (...args) => warnings.push(args) },
        notify: (text, type) => { assert.equal(type, 'warning'); events.push('warning'); },
    };
    vm.runInNewContext(`${handler}\nglobalThis.apply = applyTranslation;`, env);
    const result = env.apply(0, message, message.mes, translation, [message], metadata);
    return { result, message, events, warnings };
}

// Unrecoverable tokens must never block, delete, rewrite, or hide the translation.
for (const text of ['번역 @@VERBA_0000@@ 그대로', loose]) {
    const map = [{ id: 's', source: 'original', start: 0, end: text.length }];
    const locks = [{ text: 'locked' }];
    const { result, message, events, warnings } = apply(text, { sourceMap: map, lockedSegments: locks });
    assert.equal(message.mes, 'original English');
    assert.equal(result.record.translation, text);
    assert.equal(message.extra.display_text, text);
    assert.equal(result.record.sourceMap, map);
    assert.equal(result.record.lockedSegments, locks);
    assert.equal(result.renderResult.rendered, true);
    assert.equal(result.remainingProtectedTokens.length, 1);
    assert.equal(warnings.length, 1);
    assert.deepEqual(events, ['check', 'recovery', 'swipe', 'render', 'cache', 'save', 'warning']);
}

// Actual restoration first, then inspect the final value without a false alarm.
const source = '"Hi, Amelia."';
const leaked = '"Hi, @@VERBA_0000@@. [안녕, 아멜리아.]"';
const restored = normalizeBilingualMappedTranslation(leaked, [{ source, start: 0, end: leaked.length }], {});
assert.equal(restored.translation, '"Hi, Amelia. [안녕, 아멜리아.]"');
const clean = apply(restored.translation, { sourceMap: restored.sourceMap });
assert.equal(clean.result.remainingProtectedTokens.length, 0);
assert.equal(clean.warnings.length, 0);
assert.equal(clean.events.includes('warning'), false);

// An inactive peer must not apply or warn for a result it does not own.
const inactive = apply(leaked, { claimPairOwner: false }, false);
assert.equal(inactive.result.renderResult.status, 'pair-inactive');
assert.deepEqual(inactive.events, []);
console.log('PASS: final protection inspection runs before display; clean output is quiet and residual tokens never block rendering/saving.');
