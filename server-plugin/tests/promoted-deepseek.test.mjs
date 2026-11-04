import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const snapshot=extra=>({settings:{developerMode:false,developerDeepseekKoreanEnabled:true,profileId:'A',activeProfileSlot:'A',serverRetryLimit:0,customTranslatorEnabled:true,customTranslatorTemplates:{deepseek:'CUSTOM_DEEPSEEK_SENTINEL'},customTranslatorModified:{deepseek:true},aiPostReview:{},...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}});
function rows(prompt){const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>prompt.includes(x));assert.ok(marker);return JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));}
const reply=rows=>({content:JSON.stringify({segments:rows})});
for(const [name,create] of [['verba',verba],['deep',deep]]) {
 test(`${name}: server uses edited dedicated prose without developer mode and retains switch/reset behavior`,async()=>{
  for(const [extra,custom,builtin] of [[{},true,false],[{customTranslatorEnabled:false},false,true],[{customTranslatorModified:{deepseek:false}},false,true],[{developerDeepseekKoreanEnabled:false},false,false]]){
   let calls=0;
   const engine=create(snapshot(extra),async(_id,messages)=>{
    calls++;const p=messages[0].content;
    assert.equal(p.includes('CUSTOM_DEEPSEEK_SENTINEL'),custom);assert.equal(p.includes('HIGHEST-PRIORITY TRANSLATION PRINCIPLE'),builtin);
    assert.ok(p.includes('He waited.'));assert.match(p,/JSON|schema/);
    return reply(rows(p).map(r=>({id:r.id,translation:'그는 기다렸다.'})));
   });
   const result=await engine.output('He waited.');assert.equal(calls,1);assert.equal(result.translation,'그는 기다렸다.');
  }
 });
 test(`${name}: dedicated review requires developer mode while custom initial translation stays active`,async()=>{
  for(const developerMode of [false,true]) {
  let calls=0;
  const engine=create(snapshot({developerMode,aiPostReview:{deepseekTranslationese:true}}),async(_id,messages)=>{
   calls++;const p=messages[0].content;
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')){
    assert.match(p,/DEEPSEEK-SPECIFIC TRANSLATIONESE REVIEW/);
    assert.match(p,/CUSTOM_DEEPSEEK_SENTINEL/);
    return reply(JSON.parse(p.split('\nREVIEW_UNITS\n')[1]).map(r=>({id:r.id,translation:'그는 기다렸다.'})));
   }
   return reply(rows(p).map(r=>({id:r.id,translation:'그는 기다리는 것을 했다.'})));
  });
  const result=await engine.output('He waited.');assert.equal(calls,developerMode?2:1);assert.equal(result.translation,developerMode?'그는 기다렸다.':'그는 기다리는 것을 했다.');
  }
 });
}
