import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, buildOutputPrompt, buildScopedOutputPrompt, buildSelectionPrompt } from '../core.js';
import { enforceMadKoreanOnly } from '../mad-output.js';
import { planPostReview, buildPostReviewPrompt } from '../post-review.js';

const base = { developerMadKoreanOutputEnabled:true, globalPromptEnabled:true, globalPrompt:'GLOBAL_MARKER',
 allDialoguePromptEnabled:true,allDialoguePrompt:'ALL_MARKER',dialoguePromptEnabled:true,dialoguePrompt:'TARGET_MARKER',
 otherDialoguePromptEnabled:true,otherDialoguePrompt:'OTHER_MARKER',customTranslatorEnabled:true,
 customTranslatorTemplates:{output:'CUSTOM_OUTPUT_MARKER',selection:'CUSTOM_SELECTION_MARKER',mad:'CUSTOM_MAD_MARKER'},
 customTranslatorModified:{output:true,selection:true,mad:true},developerDeepseekKoreanEnabled:true,
 englishFlavorEnabled:true,englishFlavorProfanityTone:'dry',koreanFlavorEnabled:true,koreanFlavorPronounOmission:'active'};
const source='Alex waited.\n\n"Stay here."';
const segmented=segmentSource(source);
const who={characterName:'Alex',userName:'Dana'};
test('MAD combines active slots and custom instructions without changing settings or speaker scope',()=>{
 const before=structuredClone(base);
 for(const omitDeepseekBaseline of [false,true]) {
  const p=buildOutputPrompt(segmented,base,'ONETIME_MARKER',who,null,{}, {omitDeepseekBaseline});
  for(const marker of ['GLOBAL_MARKER','ALL_MARKER','TARGET_MARKER','OTHER_MARKER','CUSTOM_OUTPUT_MARKER','CUSTOM_MAD_MARKER','ONETIME_MARKER']) assert.ok(p.includes(marker),marker);
  assert.doesNotMatch(p,/Ignore every saved\/custom|Existing bilingual.*ignored/);
 }
 for(const [key,flag] of [['globalPrompt','globalPromptEnabled'],['allDialoguePrompt','allDialoguePromptEnabled'],['dialoguePrompt','dialoguePromptEnabled'],['otherDialoguePrompt','otherDialoguePromptEnabled']]) {
  const p=buildOutputPrompt(segmented,{...base,[flag]:false});
  assert.ok(!p.includes(base[key]),key+' OFF');
  assert.ok(p.includes('CUSTOM_MAD_MARKER'));
 }
 for(const scope of ['narration','target_dialogue','other_dialogue','tagged_content']) {
  const p=buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings:base,scope,speakerIdentity:who});
  assert.equal(p.includes('TARGET_MARKER'),scope==='target_dialogue');
  assert.equal(p.includes('OTHER_MARKER'),scope==='other_dialogue');
  assert.equal(p.includes('ALL_MARKER'),scope.endsWith('_dialogue'));
  assert.match(p,/GLOBAL_MARKER/);
 }
 const selection=buildSelectionPrompt({source,sourceContext:source,translation:'"여기 있어."',selected:'여기 있어.',start:1,end:7,settings:base,speakerIdentity:who,oneTimeInstruction:'ONETIME_MARKER'});
 for(const marker of ['CUSTOM_SELECTION_MARKER','CUSTOM_MAD_MARKER','GLOBAL_MARKER','ALL_MARKER','TARGET_MARKER','OTHER_MARKER','ONETIME_MARKER']) assert.ok(selection.includes(marker),marker+' selection');
 assert.deepEqual(base,before);
 const galbwae=buildOutputPrompt(segmented,{...base,developerMode:true,chuseokGalbwaeScope:'all'},'ONETIME_MARKER');
 for(const marker of ['GLOBAL_MARKER','ALL_MARKER','TARGET_MARKER','OTHER_MARKER','CUSTOM_OUTPUT_MARKER','CUSTOM_MAD_MARKER','ONETIME_MARKER']) assert.ok(!galbwae.includes(marker),marker+' Galbwae exclusive');
});

function clean(source,translation,extra={}) {
 const data=segmentSource(source), row=data.segments[0], values=new Map([[row.id,translation]]);
 enforceMadKoreanOnly(data,values,{developerMadKoreanOutputEnabled:true,...extra});
 return {text:values.get(row.id),data,values};
}
test('MAD keeps explicitly requested bilingual layouts and still cleans unrequested source copies',()=>{
 for(const text of ['"Stay here. [여기 있어.]"','"여기 있어. (Stay here.)"']) {
  assert.equal(clean('"Stay here."',text,{allDialoguePrompt:'대사 한영병기'}).text,text);
  assert.equal(clean('"Stay here."',text,{allDialoguePrompt:'대사 한영병기',allDialoguePromptEnabled:false}).text,'"여기 있어."');
 }
 assert.equal(clean('He waited.','He waited.\n그는 기다렸다.',{globalPrompt:'모든 문장 한영병기'}).text,'He waited.\n그는 기다렸다.');
 assert.equal(clean('He waited.','He waited. [그는 기다렸다.]',{allDialoguePrompt:'대사 한영병기'}).text,'그는 기다렸다.');
 assert.equal(clean('<Info_panel>He waited.</Info_panel>','He waited. [그는 기다렸다.]',{globalPrompt:'모든 문장 한영병기'}).text,'그는 기다렸다.');
 const settings={developerMadKoreanOutputEnabled:true,globalPrompt:'For italics, preserve English and include Korean in brackets.'};
 const row={id:'row',type:'narration',text:'*Stay here.* **Come here.**'};
 const values=new Map([['row','*Stay here. [여기 있어.]* **Come here. [이리 와.]**']]);
 enforceMadKoreanOnly({segments:[row]},values,settings);
 assert.equal(values.get('row'),'*Stay here. [여기 있어.]* **이리 와.**','marked permission must not protect an unrelated span in the same row');
});
test('MAD post-review retains the selected bilingual check and format instructions',()=>{
 const settings={developerMadKoreanOutputEnabled:true,allDialoguePrompt:'대사 한영병기',aiPostReview:{bilingual:true}};
 const {data,values}=clean('"Stay here."','"여기 있어."',settings);
 const plan=planPostReview(data,values,settings);
 assert.ok(plan.selected.includes('bilingual'));
 assert.ok(plan.units.some(row=>row.checks.includes('bilingual')));
 assert.match(buildPostReviewPrompt(plan,data,settings),/대사 한영병기/);
});
