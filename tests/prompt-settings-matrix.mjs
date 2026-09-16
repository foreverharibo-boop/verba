import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const defs=index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'),index.indexOf('const baseContext ='));
const {defaults,options}=Function(defs+'\nreturn {defaults:DEFAULT_SETTINGS,options:{narrationLocalizationLevel:LOCALIZATION_LEVEL_OPTIONS,dialogueLocalizationLevel:LOCALIZATION_LEVEL_OPTIONS,relationTemperature:RELATION_TEMPERATURE_OPTIONS,developerHongjinTranscreation:DEVELOPER_HONGJIN_TRANSCREATION_OPTIONS,developerHongjinProfanity:DEVELOPER_HONGJIN_PROFANITY_OPTIONS,developerHongjinTeasing:DEVELOPER_HONGJIN_TEASING_OPTIONS,developerHongjinVulgarity:DEVELOPER_HONGJIN_VULGARITY_OPTIONS,developerHongjinPlayfulness:DEVELOPER_HONGJIN_PLAYFULNESS_OPTIONS,developerHongjinAgeBand:DEVELOPER_HONGJIN_AGE_OPTIONS,developerHongjinOppaFrequency:DEVELOPER_HONGJIN_OPPA_FREQUENCY_OPTIONS}};')();
const segmented=core.segmentSource('Alex waited. "Come here."');
const who={characterName:'Alex',userName:'Sam',characterGender:'male'};
let checks=0;
for(const mode of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}]) {
 const base={...defaults,developerMode:true,...mode};
 for(const [key,choices] of Object.entries(options)) {
  const flags=key.startsWith('developerHongjin')?{developerHongjinFlavorEnabled:true}:{relationTemperatureEnabled:true};
  const prompts=choices.map(({value})=>core.buildOutputPrompt(segmented,{...base,...flags,[key]:value},'',who));
  assert.equal(new Set(prompts).size,choices.length,key+' each option effective');checks+=choices.length;
 }
 for(const [parent,keys] of [['koreanFlavorEnabled',['DialogueRhythm','PronounOmission','ProfanityTone','InterjectionTone','MemeDensity']],['englishFlavorEnabled',['DialogueRhythm','SlangDensity','ProfanityTone','InterjectionTone','MemeDensity','ConversationNaturalization']]]) {
  const prefix=parent.replace('Enabled','');
  for(const key of keys){
   const mk=(enabled,value)=>core.buildOutputPrompt(segmented,{...base,[parent]:enabled,[prefix+key]:value},'',who);
   assert.notEqual(mk(true,'A'),mk(true,'B'));assert.equal(mk(false,'A'),mk(false,'B'));checks+=2;
  }
 }
 const custom='CUSTOM EXACT\nline 2: $ ` \\';
 for(const key of ['beginnerPersonalityCustom','beginnerSpeechCustom']) {
  const p=core.buildOutputPrompt(segmented,{...base,beginnerCharacterGuideEnabled:true,[key]:custom},'',who);
  assert.ok(p.includes(JSON.stringify(custom)));checks++;
 }
 const identityBefore=JSON.stringify(who),sourceBefore=JSON.stringify(segmented),settingsBefore=JSON.stringify(base);
 core.buildOutputPrompt(segmented,base,'',who);
 assert.equal(JSON.stringify(who),identityBefore);assert.equal(JSON.stringify(segmented),sourceBefore);assert.equal(JSON.stringify(base),settingsBefore);
}
console.log(`PASS: ${checks} option/mode sensitivity checks; settings, identity, source and custom notes preserved.`);
