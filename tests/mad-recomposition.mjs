import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs=index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'),index.indexOf('const baseContext ='));
const defaults=Function(defs+'\nreturn DEFAULT_SETTINGS;')();
const identity={characterName:'민수',userName:'지수',characterGender:'male',nameLocks:[]};
const segmented=core.segmentSource('Alex opened the door. "Please wait."');
const translations=new Map(segmented.segments.map(x=>[x.id,'번역']));
const selection={source:'Alex opened the door.',sourceContext:'Alex opened the door.',translation:'문을 열었다.',selected:'문을 열었다.',start:0,end:7,speakerIdentity:identity};
const builders={
 output:s=>core.buildOutputPrompt(segmented,s,'',identity),
 narration:s=>core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:'',settings:s,scope:'narration',speakerIdentity:identity}),
 dialogue:s=>core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:'',settings:s,scope:'target_dialogue',speakerIdentity:identity}),
 selection:s=>core.buildSelectionPrompt({...selection,settings:s}),
 multi:s=>core.buildMultiSelectionPrompt({source:selection.source,translation:selection.translation,selections:[{id:'m0',selected:selection.selected,start:0,end:7}],settings:s,speakerIdentity:identity}),
 tokenRepair:s=>core.buildProtectedTokenRepairPrompt(segmented.segments,translations,s,identity),
 bannedRepair:s=>core.buildBannedRepairPrompt(segmented.segments,translations,s,identity),
 untranslatedRepair:s=>core.buildUntranslatedRepairPrompt(segmented.segments,translations,s,identity),
};
const marker='SCENE-FIRST RECOMPOSITION:';
let checks=0;
for(const flags of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}]) {
 for(const hongjin of [false,true]) {
  const settings={...defaults,...flags,developerMode:true,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:hongjin};
  for(const [name,build] of Object.entries(builders)) {
   const prompt=build(settings);
   assert.equal(prompt.split(marker).length-1,1,`${name}: recomposition occurs once`);
   assert.match(prompt,/scene evidence, not a wording template/);
   assert.equal(prompt.split('You are a highly skilled Korean web-novel author.').length-1,1);
   assert.match(prompt,/completely destroy and rebuild sentence structure and replace EVERY word and expression/);
   assert.match(prompt,/Translationese is unacceptable/);
   assert.match(prompt,/actor→action→target/);
   assert.match(prompt,/plot-relevant/);
   assert.match(prompt,/speech act/);
   assert.match(prompt,/consent/);
   assert.match(prompt,/protected token|protected structure|protected layout/i);
   assert.doesNotMatch(prompt,/Do not erase a meaningful image|Preserve meaningful imagery and wordplay effects/);
   assert.equal(build({...settings,developerMode:false}).includes(marker),false);
   assert.equal(build({...settings,developerMadKoreanOutputEnabled:false}).includes(marker),false);
   checks+=13;
  }
  assert.equal(core.buildInputPrompt('안녕',settings,'male',identity).includes(marker),false);
 }
}
console.log(`PASS Mad recomposition: ${checks} routing/content checks, single rule per request in normal/compact/extreme, Hongjin ON/OFF, developer gate, non-Mad/input isolation. Prompt construction only; no live AI.`);
