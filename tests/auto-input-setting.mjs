import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('function bindAutoInputSetting(panel) {');
const end = source.indexOf('\nfunction injectSettingsPanel()', start);
assert.ok(start >= 0 && end > start);
const listeners = new Map();
const input = { checked: false, addEventListener: (type, fn) => listeners.set(type, fn) };
const status = { textContent: '' };
const panel = { querySelector: selector => selector === '#verba-auto-input' ? input : status };
let saves = 0;
const context = vm.createContext({ settings: { autoInput: true }, saveSettings: () => saves++ });
vm.runInContext(source.slice(start, end), context);
context.bindAutoInputSetting(panel);
assert.equal(input.checked, true);
assert.equal(status.textContent, 'ON');
assert.equal(saves, 0, 'displaying a saved setting must not save it again');
for (const value of [false, true, false]) {
    input.checked = value;
    listeners.get('change')();
    assert.equal(context.settings.autoInput, value);
    assert.equal(status.textContent, value ? 'ON' : 'OFF');
}
assert.equal(saves, 3);
assert.ok(source.indexOf('    bindAutoInputSetting(panel);') < source.indexOf('    bindBaseTranslationEditor(panel, settings,'));
assert.equal(source.split("panel.querySelector('#verba-auto-input').addEventListener").length, 1, 'old duplicate handler removed');
context.bindAutoInputSetting({ querySelector: () => null });
console.log('PASS: auto-input initial state, ON/OFF, change/save handling and early binding; DOM adapter, not native browser clicks.');
