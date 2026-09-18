import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const between = (a,b) => {
    const start = index.indexOf(a), end = index.indexOf(b,start);
    assert.ok(start >= 0 && end > start, a);
    return index.slice(start,end);
};
const defs = between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =');
const defaults = Function(defs+';return DEFAULT_SETTINGS;')();
const settings = {...defaults,developerMode:false,developerOutputSplitCount:3,
    developerRelationshipExperimentEnabled:true,developerSpeechDistance:'formal',
    developerTargetToUserRegister:'banmal',developerTargetToOtherRegister:'jondaetmal',
    developerTargetToUserAddress:'RELATIONSHIP_SENTINEL',developerTargetToUserAddressStrength:'strict',
    developerTargetToUserAddressFrequency:'often'};
const general = Function('settings','escapeHtml',defs
    +between('function generalSplitSettingsMarkup(', 'function developerSettingsMarkup(')
    +'return generalSplitSettingsMarkup()+generalRelationshipSettingsMarkup();');
assert.equal(general(settings,String,''),general({...settings,developerMode:true},String,''));
assert.doesNotMatch(general(settings,String,''),/🧪|class="[^"]*developer-lab/);
assert.match(general(settings,String,''),/말투·호칭 설정/);
assert.match(general(settings,String,''),/value="3" selected/);
const dev = between('function developerSettingsMarkup(', 'function syncDeveloperQualityControls(');
assert.doesNotMatch(dev,/id="verba-deep-developer-(?:relationship|output-split)-lab"/);
const panel = between('function injectSettingsPanel(', '    host.append(panel);');
assert.match(panel,/<div><b>베에르으바아<\/b><\/div>/);
assert.doesNotMatch(panel,/<small>v\$\{EXTENSION_VERSION\}<\/small>/);
assert.match(style,/#verba-deep-settings > \.inline-drawer > \.inline-drawer-content\s*\{\s*font-size: \.86em;/);
assert.doesNotMatch(style,/#verba-deep-settings\s*\{\s*font-size:/);
assert.doesNotMatch(style,/#verba-deep-settings \.verba-deep-drawer-header\s*\{[^}]*min-height:/s);
assert.match(panel,/id="verba-deep-prompt-conflict-settings"[\s\S]*?<\/details>\s*\$\{generalSplitSettingsMarkup\(\)\}/);
assert.match(panel,/id="verba-deep-expression-detail"[\s\S]*?<\/details>\s*\$\{generalRelationshipSettingsMarkup\(\)\}/);
for (const name of ['Split','Relationship']) assert.equal(panel.split('${general'+name+'SettingsMarkup()}').length,2);
assert.match(style,/#verba-deep-settings #verba-deep-developer-output-split-lab,\s*#verba-deep-settings #verba-deep-developer-relationship-lab\s*\{\s*border-style: solid !important;/);

// Existing developer shutdown must leave all promoted settings alone.
const before=structuredClone(settings);
const shutdown=between("        if (target.closest('#verba-deep-developer-mode-off')) {",'            saveSettings();').split('\n').slice(1).join('\n');
Function('settings',shutdown)(settings);
for (const key of Object.keys(before).filter(k=>/Relationship|SpeechDistance|TargetTo|OutputSplit/.test(k))) assert.equal(settings[key],before[key],key);

// Prompt content remains identical across the developer lock; only target speech receives the rules.
const segmented=core.segmentSource('Alex smiled. "Come here."');
const identity={characterName:'Alex',userName:'Sam',characterGender:'male'};
for(const scope of ['target_dialogue','other_dialogue','narration','tagged_content']) {
    const args={segments:segmented.segments,sourceContext:'',settings,scope,speakerIdentity:identity};
    const prompt=core.buildScopedOutputPrompt(args);
    assert.equal(prompt,core.buildScopedOutputPrompt({...args,settings:{...settings,developerMode:true}}));
    assert.equal(prompt.includes('RELATIONSHIP_SENTINEL'),scope==='target_dialogue',scope);
    assert.ok(!core.buildScopedOutputPrompt({...args,settings:{...settings,developerRelationshipExperimentEnabled:false}}).includes('RELATIONSHIP_SENTINEL'));
}
assert.ok(!core.buildInputPrompt('안녕',settings,'male',identity).includes('RELATIONSHIP_SENTINEL'));

// The actual delegated change branches save every promoted control while locked.
class Input {}
class Select {}
let saves=0;
const change=Function('settings','target','HTMLInputElement','HTMLSelectElement','saveSettings','syncDeveloperQualityControls','panel',
    defs+between("        if (target.id === 'verba-deep-developer-relationship-enabled'", "        if (target.id === 'verba-deep-quality-audit-enabled')"));
const choices=[
    ['relationship-enabled','developerRelationshipExperimentEnabled',false,Input],
    ['relationship-enabled','developerRelationshipExperimentEnabled',true,Input],
    ['speech-distance','developerSpeechDistance','casual',Select],
    ['target-user-register','developerTargetToUserRegister','jondaetmal',Select],
    ['target-other-register','developerTargetToOtherRegister','banmal',Select],
    ['target-user-address','developerTargetToUserAddress','선배님',Input],
    ['target-user-address-strength','developerTargetToUserAddressStrength','prefer',Select],
    ['target-user-address-frequency','developerTargetToUserAddressFrequency','minimal',Select],
];
for(const [id,key,value,Type] of choices){
    change(settings,Object.assign(new Type(),{id:'verba-deep-developer-'+id,checked:value,value}),Input,Select,()=>saves++,()=>{},{},()=>{});
    assert.equal(settings[key],value,key);assert.equal(settings.developerMode,false);
}
assert.equal(saves,choices.length);

// The removed monitor has no UI, settings, runtime or styling path.
assert.doesNotMatch(index,/developerRegisterShiftMonitor|lastRegisterShiftMonitorSummary|runDeveloperRegisterShiftMonitor|renderRegisterShiftMonitorStatus|strongKoreanRegisterProfile|register-shift-monitor/);
assert.doesNotMatch(style,/register-monitor/);
console.log('PASS: general split/relationship layout, solid borders, lock independence, target-only prompts, saved settings and complete monitor removal.');
