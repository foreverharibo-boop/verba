import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeBaseTranslationCustom } from '../base-editor.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between = (a,b) => index.slice(index.indexOf(a), index.indexOf(b,index.indexOf(a)));
class Input { checked = false; }
class Select { value = ''; disabled = false; }
class Textarea {}
const nodes = new Map();
const pairs = [
 ['output-split-count','developerOutputSplitCount',3],
 ['relationship-enabled','developerRelationshipExperimentEnabled',true],
 ['register-shift-monitor','developerRegisterShiftMonitor',true],
 ['speech-distance','developerSpeechDistance','casual'],
 ['target-user-register','developerTargetToUserRegister','banmal'],
 ['target-other-register','developerTargetToOtherRegister','jondaetmal'],
 ['target-user-address','developerTargetToUserAddress','선배님'],
 ['target-user-address-strength','developerTargetToUserAddressStrength','strict'],
 ['target-user-address-frequency','developerTargetToUserAddressFrequency','often'],
 ['mad-korean-enabled','developerMadKoreanOutputEnabled',true],
 ['hongjin-enabled','developerHongjinFlavorEnabled',true],
 ['mad-korean-target-user-register','developerMadKoreanTargetToUserRegister','banmal'],
 ['mad-korean-user-target-register','developerMadKoreanUserToTargetRegister','jondaetmal'],
 ['hongjin-transcreation','developerHongjinTranscreation','maximum'],
 ['hongjin-profanity','developerHongjinProfanity','high'],
 ['hongjin-teasing','developerHongjinTeasing','active'],
 ['hongjin-vulgarity','developerHongjinVulgarity','open'],
 ['hongjin-playfulness','developerHongjinPlayfulness','high'],
 ['hongjin-age-band','developerHongjinAgeBand','late20s'],
 ['hongjin-oppa-frequency','developerHongjinOppaFrequency','often'],
];
for (const [id,,value] of pairs) nodes.set(`#verba-developer-${id}`,typeof value==='boolean'?new Input():new Select());
const panel = {querySelector: s => nodes.get(s)||null};
nodes.set('#verba-settings',panel);
for (const name of ['mad-korean','hongjin']) {
 const controls = pairs.filter(([id,,v])=>id.startsWith(name)&&typeof v!=='boolean').map(([id])=>nodes.get(`#verba-developer-${id}`));
 const classes=new Set();
 nodes.set(`#verba-developer-${name}-controls`,{classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)},querySelectorAll:()=>controls});
}
const document={querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[]};
const noop=()=>{};
const code = between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =')
 + '\nconst settings = structuredClone(DEFAULT_SETTINGS);\n'
 + between('function normalizedPromptPresetName(', 'function normalizedPromptPresets(')
 + between('function normalizeTranslationRuleOrder(', 'function renderTranslationRuleOrder(')
 + between('function setCheckedValue(', 'function defaultPromptPresetTranslationSettingsSnapshot(')
 + between('function syncDeveloperQualityControls(', 'function refreshSettingsPanelForDeveloperMode(')
 + between('function setPromptFieldsFromPreset(', 'function optionLabel(')
 + '\nreturn {settings, save:currentPromptPresetSaveSnapshot, apply:setPromptFieldsFromPreset};';
const api=Function('normalizeBaseTranslationCustom','document','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','renderTranslationRuleOrder','refreshSettingsPanelForDeveloperMode','renderCurrentAppliedRules','syncPromptSlotUi','saveSettings','renderPromptConflictInspector',code)(normalizeBaseTranslationCustom,document,Input,Select,Textarea,noop,noop,noop,noop,noop,noop);
const check = expected => {
 for (const [id,key] of pairs) {
  assert.equal(api.settings[key],expected[key],key+' saved value');
  const el=nodes.get(`#verba-developer-${id}`);
  assert.equal(el instanceof Input?el.checked:el.value,el instanceof Input?expected[key]:String(expected[key]),key+' visible value');
 }
 for (const name of ['mad-korean','hongjin']) {
  const enabled=nodes.get(`#verba-developer-${name}-enabled`).checked;
  const group=nodes.get(`#verba-developer-${name}-controls`);
  assert.equal(group.classList.contains('verba-control-disabled'),!enabled);
  for (const el of group.querySelectorAll()) assert.equal(el.disabled,!enabled);
 }
};
const defaults=structuredClone(api.settings);
for (const devMode of [false,true]) {
 api.settings.developerMode=devMode;
 const desired={...defaults,...Object.fromEntries(pairs.map(([,k,v])=>[k,v]))};
 Object.assign(api.settings,desired,{developerMode:devMode});
 const saved=JSON.parse(JSON.stringify(api.save('prompts_translation')));
 for (const [,key] of pairs) assert.equal(saved.translationSettings.developerSettings[key],desired[key]);
 Object.assign(api.settings,defaults,{developerMode:devMode});
 api.apply(saved);check(desired);assert.equal(api.settings.developerMode,devMode);
 // Re-save a loaded preset, restore OFF, then load ON again.
 const resaved=JSON.parse(JSON.stringify(api.save('prompts_translation')));
 Object.assign(api.settings,defaults,{developerMode:devMode});
 const off=JSON.parse(JSON.stringify(api.save('prompts_translation')));
 api.apply(off);check(defaults);
 api.apply(resaved);check(desired);
 // Prompt-only application cannot change any flavor values or controls.
 const promptOnly=api.save('prompts');assert.equal(promptOnly.translationSettings,null);
 api.apply(promptOnly);check(desired);
 // Legacy presets without developer payload retain existing flavor values.
 const legacy=structuredClone(saved);delete legacy.translationSettings.developerSettings;
 api.apply(legacy);check(desired);
}
console.log('PASS: preset JSON roundtrip, ON/OFF, all 9 choices, visible controls and disabled states, re-save, legacy and prompt-only, developer locked/unlocked.');

// Minimal experiment settings roundtrip through the same translation preset.
for(const dev of [false,true]) {
 api.settings.developerMode=dev;
 api.settings.developerMinimalPromptEnabled=true;
 api.settings.developerMinimalPrompt='직접 지침\n두 번째 줄 </textarea>';
 const preset=JSON.parse(JSON.stringify(api.save('prompts_translation')));
 api.settings.developerMinimalPromptEnabled=false;
 api.settings.developerMinimalPrompt='변경됨';
 api.apply(preset);
 assert.equal(api.settings.developerMinimalPromptEnabled,true);
 assert.equal(api.settings.developerMinimalPrompt,'직접 지침\n두 번째 줄 </textarea>');
 assert.equal(api.settings.developerMode,dev);
 const promptOnly=api.save('prompts');api.apply(promptOnly);
 assert.equal(api.settings.developerMinimalPromptEnabled,true);
}
console.log('PASS: minimal experiment flag/text persist in translation presets without unlocking developer mode.');

// Split selection persists independently of minimal mode and developer access.
for(const dev of [false,true])for(const minimal of [false,true])for(const count of [1,2,3]){
 Object.assign(api.settings,{developerMode:dev,developerMinimalPromptEnabled:minimal,developerOutputSplitCount:count});
 const preset=JSON.parse(JSON.stringify(api.save('prompts_translation')));
 assert.equal(preset.translationSettings.developerSettings.developerOutputSplitCount,count);
 Object.assign(api.settings,{developerOutputSplitCount:1,developerMinimalPromptEnabled:!minimal});
 api.apply(preset);assert.equal(api.settings.developerOutputSplitCount,count);
 assert.equal(api.settings.developerMinimalPromptEnabled,minimal);assert.equal(api.settings.developerMode,dev);
 api.apply(api.save('prompts'));assert.equal(api.settings.developerOutputSplitCount,count);
 const legacy=structuredClone(preset);delete legacy.translationSettings.developerSettings.developerOutputSplitCount;
 api.apply(legacy);assert.equal(api.settings.developerOutputSplitCount,1);
 preset.translationSettings.developerSettings.developerOutputSplitCount=99;
 api.apply(preset);assert.equal(api.settings.developerOutputSplitCount,1);
}
console.log('PASS: independent split count in translation presets, prompt-only preservation, legacy defaults, invalid values, no developer auto-unlock.');
