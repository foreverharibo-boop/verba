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
// General split/relationship controls stay visible; flavors require developer mode.
const state = structuredClone(saved); state.developerMode = false;
const markupCode=between('function developerFlavorSettingsMarkup(', 'function syncDeveloperQualityControls(');
const render=Function('settings','escapeHtml','baseTranslationEditorMarkup','lastQualityAuditSummary',definitions+'\n'+markupCode+'\nreturn {general:generalTranslationSettingsMarkup(),developer:developerSettingsMarkup()};');
const {general:markup,developer:locked}=render(state,String,()=>'', '');
const {general:markupOn,developer:unlocked}=render({...state,developerMode:true},String,()=>'', '');
assert.equal(markup,markupOn);
for(const id of ['output-split','relationship']) {
 assert.ok(markup.includes(`id="verba-developer-${id}-lab"`));
 assert.ok(!locked.includes(`id="verba-developer-${id}-lab"`));
 assert.ok(!unlocked.includes(`id="verba-developer-${id}-lab"`));
}
for(const id of ['mad-korean','hongjin']) {
 assert.ok(!markup.includes(`id="verba-developer-${id}-lab"`));
 assert.ok(!locked.includes(`id="verba-developer-${id}-lab"`));
 assert.match(unlocked,new RegExp(`id="verba-developer-${id}-enabled" checked`));
 assert.ok(unlocked.includes(`id="verba-developer-${id}-lab" class="verba-tool-details verba-developer-lab"`));
}
assert.ok(!markup.includes('verba-developer-lab"'));
for(const value of ['maximum','late20s','often','banmal','jondaetmal']) assert.match(unlocked,new RegExp(`value="${value}" selected`));
assert.ok(index.includes('${generalTranslationSettingsMarkup()}\n\n                <details id="verba-beginner-character-guide"'));
assert.ok(index.indexOf('id="verba-english-flavor"') < index.indexOf('${generalTranslationSettingsMarkup()}'));
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
// Developer OFF retains stored tastes but does not inject them or their guards.
assert.equal(state.developerRelationshipExperimentEnabled,true);
const segmented = core.segmentSource('Alex waited. "Come here."');
const identity = { characterName: 'Alex', userName: 'Sam', characterGender: 'male' };
for (const dev of [false,true]) for (const mad of [false,true]) for (const hongjin of [false,true]) {
 const settings={...defaults,developerMode:dev,developerMadKoreanOutputEnabled:mad,developerHongjinFlavorEnabled:hongjin};
 const prompt=core.buildOutputPrompt(segmented,settings,'',identity);
 assert.equal(prompt.includes('MAD KOREAN — MANDATORY REAUTHORING'),dev&&mad);
 assert.equal(prompt.includes('KIM HONG-JIN VOICE'),dev&&hongjin);
 assert.equal(prompt.includes('TOP PRIORITY — NO MISOGYNY'),dev&&(mad||hongjin));
 assert.equal(core.buildInputPrompt('안녕',settings,'male',identity),core.buildInputPrompt('안녕',defaults,'male',identity));
 if(!dev) {
  assert.equal(prompt,core.buildOutputPrompt(segmented,{...defaults,developerMode:false},'',identity));
  assert.deepEqual(core.findBannedWords('미친년',settings),[]);
  assert.ok(!core.buildBannedRepairPrompt(segmented.segments,new Map(),settings,identity).includes('USER-directed profanity guard'));
 }
}
// Relationship style works while locked, applies to TARGET only, preserves values.
for(const dev of [false,true]) {
 const settings={...defaults,developerMode:dev,developerRelationshipExperimentEnabled:true,developerTargetToUserRegister:'banmal',developerTargetToOtherRegister:'jondaetmal',developerTargetToUserAddress:'선배님'};
 const before=structuredClone(settings);
 for(const scope of ['mixed','target_dialogue','other_dialogue','narration','tagged_content']) {
  const prompt=core.buildScopedOutputPrompt({segments:segmented.segments,settings,scope,speakerIdentity:identity});
  assert.equal(prompt.includes('TARGET relationship delivery:'),['mixed','target_dialogue'].includes(scope));
  assert.equal(prompt.includes('선배님'),['mixed','target_dialogue'].includes(scope));
 }
 assert.deepEqual(settings,before);
}
console.log('PASS: developer flavor gates, general split/relationship UI, retained values and speaker-scoped relationship rules.');

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
