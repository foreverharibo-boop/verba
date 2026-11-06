import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as verba} from '../engines/verba.mjs';
import {createEngine as deep} from '../engines/verba-deep.mjs';
const source='He waited.\n\n"Stay here."\n\n<Info_panel>Sunny</Info_panel>';
for(const [name,create] of [['verba',verba],['deep',deep]]) for(const second of [false,true]) for(const review of [false,true]) {
 test(`${name}: MAD preserves enabled rules and bilingual output through ${second?'two':'one'} passes, review=${review}`,async()=>{
  const settings={profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,
   developerMadKoreanOutputEnabled:true,developerDeepseekKoreanEnabled:second,developerSecondTranslationEnabled:second,
   globalPromptEnabled:true,globalPrompt:'GLOBAL_MARKER',allDialoguePromptEnabled:true,allDialoguePrompt:'대사 한영병기. ALL_MARKER',
   dialoguePromptEnabled:true,dialoguePrompt:'TARGET_MARKER',otherDialoguePromptEnabled:true,otherDialoguePrompt:'OTHER_MARKER',
   translateTaggedContent:true,aiPostReview:review?{meaning:true,bilingual:true}:{},
   customTranslatorEnabled:true,customTranslatorTemplates:{output:'CUSTOM_OUTPUT_MARKER',mad:'CUSTOM_MAD_MARKER'},customTranslatorModified:{output:true,mad:true}};
  const before=structuredClone(settings);let translations=0,reviews=0,rewrites=0;
  const engine=create({settings,profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
   const p=messages.map(x=>x.content).join('\n');
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
    reviews++;
    assert.match(p,/대사 한영병기/);
    const rows=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
    assert.ok(rows.some(r=>r.checks.includes('bilingual')));
    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.CURRENT}))})};
   }
   translations++;
   if(p.startsWith('SECOND TRANSLATION'))rewrites++;
   for(const marker of ['GLOBAL_MARKER','ALL_MARKER','TARGET_MARKER','OTHER_MARKER','CUSTOM_OUTPUT_MARKER','CUSTOM_MAD_MARKER','ONETIME_MARKER'])assert.ok(p.includes(marker),marker);
   const rows=JSON.parse(p.slice(p.lastIndexOf('\nSEGMENTS\n')+'\nSEGMENTS\n'.length));
   return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.type==='dialogue_candidate'?'"Stay here. [여기 있어.]"':r.type==='tagged_content'?'맑음':'그는 기다렸다.'}))})};
  });
  const result=await engine.output(source,{oneTimeInstruction:'ONETIME_MARKER'});
  assert.match(result.translation,/Stay here\./);assert.match(result.translation,/여기 있어\./);
  assert.doesNotMatch(result.translation,/He waited|Sunny/);assert.match(result.translation,/<Info_panel>맑음<\/Info_panel>/);
  assert.equal(translations,second?2:1);assert.equal(rewrites,Number(second));assert.equal(reviews,Number(review));
  assert.deepEqual(settings,before);
 });
}
