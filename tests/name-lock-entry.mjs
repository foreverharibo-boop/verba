import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindNameLockEntry, nameLockEntryMarkup } from '../name-lock-entry.js';
import { segmentSource, assembleTranslation } from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const prefix = index.includes("prefix: 'verba-deep'") ? 'verba-deep' : 'verba';
const matchBlock = index.slice(index.indexOf('const NAME_MATCH_SENTENCE_WORDS'), index.indexOf('function previousAssistantMessages'));
const matchName = Function('normalizedCharacterNameLocks', 'escapeRegularExpression', 'selectionSourceRows', matchBlock + '\nreturn resolveSelectionSourceNameLocally;')(
    () => [], value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), () => [],
);
for (const [source, selected, expected] of [
    ['Christopher watched Dana. Dana waved.', 'Dana', 'Dana'],
    ['Dana smiled.', 'dana', 'Dana'],
    ['Mary Jane spoke to Dana.', 'Mary Jane', 'Mary Jane'],
    ['Anna smiled.', 'Ann', ''],
    ['Ann-Marie smiled.', 'Ann', ''],
]) {
    assert.equal(matchName({ source, selected, translation: selected, start: 0, end: selected.length }), expected);
}

class Element {
    value = ''; disabled = false; isConnected = true; events = {};
    addEventListener(type, handler) { this.events[type] = handler; }
    focus() { this.focused = true; }
}
const reference = { characterId: 2, character: { name: 'Christopher' } };
const markup = nameLockEntryMarkup(prefix, reference, String);
assert.match(markup, /Dana/);
assert.match(markup, /다나/);
assert.match(markup, /Christopher/);
assert.match(nameLockEntryMarkup(prefix, null, String), /disabled/);
assert.ok(!nameLockEntryMarkup(prefix, { ...reference, character: { name: '<test>' } }, s => s.replaceAll('<', '&lt;')).includes('<test>'));

const elements = new Map(['source', 'target', 'save'].map(key => [`#${prefix}-name-entry-${key}`, new Element()]));
const get = key => elements.get(`#${prefix}-name-entry-${key}`);
let active = reference;
const saves = [], warnings = [], errors = [];
let refreshes = 0, release;
bindNameLockEntry({ content: { querySelector: s => elements.get(s) }, prefix, reference,
    currentReference: () => active,
    save: async (...args) => { saves.push(args); await new Promise(resolve => { release = resolve; }); },
    refresh: () => refreshes++, notify: (...args) => warnings.push(args), reportError: (...args) => errors.push(args),
});
await get('save').events.click();
assert.equal(saves.length, 0);
get('source').value = ' Dana '; get('target').value = ' 다나 ';
get('target').events.keydown({ key: 'Enter', isComposing: true });
assert.equal(saves.length, 0, 'IME confirmation must not save');
const pending = get('save').events.click();
assert.equal(get('save').disabled, true);
await get('save').events.click();
assert.equal(saves.length, 1, 'double-click saves only once');
release(); await pending;
assert.deepEqual(saves[0], ['Dana', '다나', reference]);
assert.equal(get('save').disabled, false);
assert.equal(refreshes, 1);
active = { characterId: 3, character: {} };
await get('save').events.click();
assert.equal(saves.length, 1, 'stale form cannot write to a different card');
assert.equal(errors.length, 0);

// The entered mapping must work in the existing name-token/particle pipeline.
for (const [source, target, suffix, expected] of [
    ['Dana', '다나', '은(는)', '다나는 웃었다.'],
    ['Dana', '다나', '이(가)', '다나가 웃었다.'],
    ['Hongjin', '홍진', '은(는)', '홍진은 웃었다.'],
]) {
    const segmented = segmentSource(`${source} smiled.`, [{ source, target }]);
    const token = segmented.nameTokens[0].token;
    const translations = new Map(segmented.segments.map(row => [row.id, `${token}${suffix} 웃었다.`]));
    assert.equal(assembleTranslation(segmented, translations), expected);
}
console.log('PASS: direct entry, IME/double-click/chat-switch guards, Latin name matching, name restoration and particles.');
