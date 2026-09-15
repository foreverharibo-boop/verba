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
 otherDialogue:s=>core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:'',settings:s,scope:'other_dialogue',speakerIdentity:identity}),
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
   assert.equal(prompt.split('You are a contemporary Korean web-novel author skilled in lifelike everyday dialogue and vivid, natural narration.').length-1,1);
   assert.equal(prompt.split('MANDATORY REAUTHORING:').length-1,1);
   assert.match(prompt,/discard the source sentence structure and expression system; reconstruct the entire passage in original Korean/);
   assert.doesNotMatch(prompt,/You may completely destroy/);
   assert.match(prompt,/exact names/);
   assert.match(prompt,/Translationese is unacceptable/);
   assert.equal(prompt.split('EVERYDAY KOREAN EXAMPLES —').length-1,1);
   assert.equal(prompt.split('"I can explain." → "잠깐만, 말 좀 들어봐."').length-1,1);
   assert.match(prompt,/진짜 너 때문에 못 살겠다/);
   assert.match(prompt,/안도한 것도 잠시, 다시 불안해졌다/);
   assert.match(prompt,/not a fixed substitution or a mandate for 반말/);
   assert.match(prompt,/EVERYDAY DIALOGUE/);
   assert.match(prompt,/EVERYDAY NARRATION/);
   assert.equal(prompt.split('PERSONAL PRONOUN DEFAULT:').length-1,1);
   assert.match(prompt,/he\/him → 그, she\/her → 그녀, his → 그의, possessive her → 그녀의/);
   assert.match(prompt,/여자\/남자\/녀석/);
   assert.equal(prompt.split('DIALOGUE TIME AND GROUP REFERENCES —').length-1,1);
   assert.match(prompt,/SPOKEN CLOCK TIMES:/);
   assert.match(prompt,/0600 → 오전 6시/);
   assert.match(prompt,/around 0700 hours → 아침 7시쯤/);
   assert.match(prompt,/1830 → 오후 6시 30분/);
   assert.match(prompt,/value.*not.*padding/);
   assert.match(prompt,/codes\/IDs/);
   assert.match(prompt,/durations/);
   assert.match(prompt,/metadata layout/);
   assert.match(prompt,/GROUP REFERENCES:/);
   assert.match(prompt,/네 녀석들/);
   assert.match(prompt,/affiliation/);
   assert.match(prompt,/not fixed substitutions/);
   assert.doesNotMatch(prompt,/잠깐만요. 일단 얘기 좀 들어보세요/);
   assert.match(prompt,/actor→action→target/);
   assert.match(prompt,/plot-relevant/);
   assert.match(prompt,/speech act/);
   assert.match(prompt,/consent/);
   assert.match(prompt,/protected token|protected structure|protected layout/i);
   assert.doesNotMatch(prompt,/Do not erase a meaningful image|Preserve meaningful imagery and wordplay effects/);
   assert.equal(build({...settings,developerMode:false}).includes(marker),false);
   assert.equal(build({...settings,developerMadKoreanOutputEnabled:false}).includes(marker),false);
   assert.equal(build({...settings,developerMode:false}).includes('SPOKEN CLOCK TIMES:'),false);
   assert.equal(build({...settings,developerMadKoreanOutputEnabled:false}).includes('GROUP REFERENCES:'),false);
   assert.equal(prompt.split('KOREAN METRIC UNITS:').length-1,1,`${name}: metric policy occurs once`);
   assert.match(prompt,/Preserve the actual physical value; do not arbitrarily round/);
   assert.match(prompt,/50 yards → 45.72미터, never 50미터/);
   assert.match(prompt,/Keep product specifications, proper names and context-standard units/);
   assert.match(prompt,/Metadata keeps its existing number\/layout rules/);
   assert.equal(build({...settings,developerMode:false}).includes('KOREAN METRIC UNITS:'),false);
   assert.equal(build({...settings,developerMadKoreanOutputEnabled:false}).includes('KOREAN METRIC UNITS:'),false);
   checks+=49;
  }
  assert.equal(core.buildInputPrompt('안녕',settings,'male',identity).includes(marker),false);
  assert.equal(core.buildInputPrompt('안녕',settings,'male',identity).includes('KOREAN METRIC UNITS:'),false);
  assert.equal(core.buildInputPrompt('안녕',settings,'male',identity).includes('SPOKEN CLOCK TIMES:'),false);
 }
}
console.log(`PASS Mad recomposition: ${checks} routing/content checks, single rule per request in normal/compact/extreme, Hongjin ON/OFF, developer gate, non-Mad/input isolation. Prompt construction only; no live AI.`);
