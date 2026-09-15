import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { normalizeBaseTranslationCustom } from '../base-editor.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between = (a, b) => {
    const start = index.indexOf(a), end = index.indexOf(b, start);
    assert.ok(start >= 0 && end > start, a);
    return index.slice(start, end);
};
const definitions = between('const RELATION_TEMPERATURE_OPTIONS', 'const baseContext =');
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const code = /const DEVELOPER_ACCESS_CODE = '([^']+)'/.exec(index)[1];
assert.equal(code, '130918');
const fingerprint = `verba-dev-${core.hashText(code)}`;
const saved = { ...defaults, developerMode: true, developerAccessFingerprint: `verba-dev-${core.hashText('091813')}`,
    developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true,
    developerMadKoreanTargetToUserRegister: 'banmal', developerMadKoreanUserToTargetRegister: 'jondaetmal',
    developerHongjinTranscreation: 'maximum', developerHongjinProfanity: 'high', developerHongjinAgeBand: 'late20s',
    developerHongjinTeasing: 'strong', developerHongjinVulgarity: 'strong', developerHongjinPlayfulness: 'strong',
    developerHongjinOppaFrequency: 'often', developerExtremeCompressedPromptEnabled: true,
    qualityAuditEnabled: true, developerRelationshipExperimentEnabled: true,
    baseTranslationCustom: normalizeBaseTranslationCustom({ enabled: true, prompt: 'KEEP_BASE' }), globalPrompt: 'KEEP_GLOBAL' };
const lock = Function('settings', 'DEVELOPER_ACCESS_FINGERPRINT', 'normalizeBaseTranslationCustom',
    between('settings.developerMode = settings.developerMode === true;', 'settings.developerCompressedPromptEnabled = settings.developerCompressedPromptEnabled === true;'));
for (const oldFingerprint of [saved.developerAccessFingerprint, '', fingerprint]) {
    const state = structuredClone({ ...saved, developerAccessFingerprint: oldFingerprint });
    const before = structuredClone(state);
    lock(state, fingerprint, normalizeBaseTranslationCustom);
    assert.deepEqual(state, { ...before, developerMode: oldFingerprint === fingerprint });
}
// General controls render and retain every select even while experiments are locked.
const state = structuredClone(saved); state.developerMode = false;
const markup = Function('settings', definitions + '\n' + between('function generalFlavorSettingsMarkup(', 'function developerSettingsMarkup(') + '\nreturn generalFlavorSettingsMarkup();')(state);
const markupOn = Function('settings', definitions + '\n' + between('function generalFlavorSettingsMarkup(', 'function developerSettingsMarkup(') + '\nreturn generalFlavorSettingsMarkup();')({ ...state, developerMode: true });
assert.equal(markup, markupOn);
for (const id of ['mad-korean', 'hongjin']) {
    assert.match(markup, new RegExp(`id="verba-developer-${id}-enabled" checked`));
    assert.ok(!between('function developerSettingsMarkup(', 'function syncDeveloperQualityControls(').includes(`id="verba-developer-${id}-lab"`));
}
assert.equal((markup.match(/<select /g) || []).length, 9);
assert.match(markup, /value="maximum" selected/);
assert.match(markup, /value="late20s" selected/);
assert.match(markup, /value="often" selected/);
assert.match(markup, /value="banmal" selected/);
assert.match(markup, /value="jondaetmal" selected/);
assert.ok(index.includes('${generalFlavorSettingsMarkup()}\n\n                <details id="verba-beginner-character-guide"'));
assert.doesNotMatch(markup, /🧪/);
assert.ok(index.indexOf('id="verba-english-flavor"') < index.indexOf('${generalFlavorSettingsMarkup()}'));
// Execute existing change branches with a locked mode: the UI keeps its old IDs
// and setting keys so presets, saved values and change handlers need no migration.
class Input {}
class Select {}
let saves = 0;
const handler = between("        if (target.id === 'verba-developer-hongjin-enabled'", "        if (target.id === 'verba-developer-relationship-enabled'");
const change = Function('settings', 'target', 'HTMLInputElement', 'HTMLSelectElement', 'saveSettings', 'syncDeveloperQualityControls', 'panel', 'document',
    definitions + '\n' + handler);
for (const [id, key] of [['hongjin', 'developerHongjinFlavorEnabled'], ['mad-korean', 'developerMadKoreanOutputEnabled']]) {
    for (const checked of [false, true]) {
        change(state, Object.assign(new Input(), { id: `verba-developer-${id}-enabled`, checked }), Input, Select, () => saves++, () => {}, {}, { querySelector: () => null });
        assert.equal(state[key], checked);
        assert.equal(state.developerMode, false);
    }
}
assert.equal(saves, 4);
const off = between("        if (target.closest('#verba-developer-mode-off')) {", '            saveSettings();').split('\n').slice(1).join('\n');
Function('settings', off)(state);
assert.equal(state.developerHongjinFlavorEnabled, true);
assert.equal(state.developerMadKoreanOutputEnabled, true);
// Both general flavors are effective while locked, but compression and custom
// developer base rules remain gated. Input never inherits either flavor.
const segmented = core.segmentSource('Alex waited. "Come here."');
const identity = { characterName: 'Alex', userName: 'Sam', characterGender: 'male' };
for (const mad of [false, true]) for (const hongjin of [false, true]) {
    const s = { ...defaults, developerMode: false, developerMadKoreanOutputEnabled: mad, developerHongjinFlavorEnabled: hongjin };
    const ordinary = core.buildOutputPrompt(segmented, s, '', identity);
    assert.equal(core.buildOutputPrompt(segmented, { ...s, developerMode: true }, '', identity), ordinary);
    assert.equal(core.buildOutputPrompt(segmented, { ...s, developerExtremeCompressedPromptEnabled: true, developerCompressedPromptEnabled: true }, '', identity), ordinary);
    assert.equal(core.buildInputPrompt('안녕', s, 'male', identity), core.buildInputPrompt('안녕', defaults, 'male', identity));
    assert.equal(ordinary.includes('SCENE-FIRST RECOMPOSITION:'), mad);
    assert.equal(ordinary.includes('DEVELOPER KIM HONGJIN FLAVOR'), hongjin);
}
console.log('PASS: new password, old-session relock without setting loss, general controls/handlers, flavor independence and developer-only gates (local mocks).');

// The actual activation handler rejects the previous password and accepts the new one.
let typed = '091813', refreshes = 0, notifications = [];
const input = { get value() { return typed; }, set value(v) { typed = v; }, focus() {} };
const activate = Function('settings', 'panel', 'DEVELOPER_ACCESS_CODE', 'DEVELOPER_ACCESS_FINGERPRINT', 'saveSettings', 'refreshSettingsPanelForDeveloperMode', 'notify',
    'let lastQualityAuditSummary;\n' + between('    const activateDeveloperMode = () => {', "    panel.addEventListener('click', event => {") + '\nreturn activateDeveloperMode;')(
        state, { querySelector: () => input }, code, fingerprint, () => saves++, () => refreshes++, (...args) => notifications.push(args));
activate();
assert.equal(state.developerMode, false); assert.equal(refreshes, 0);
assert.equal(notifications.at(-1)[1], 'error');
typed = code;
activate();
assert.equal(state.developerMode, true); assert.equal(state.developerAccessFingerprint, fingerprint);
assert.equal(refreshes, 1); assert.equal(notifications.at(-1)[1], 'success');
assert.equal(state.developerHongjinFlavorEnabled, true); assert.equal(state.developerMadKoreanOutputEnabled, true);
