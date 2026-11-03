import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const settings={profileId:'A',activeProfileSlot:'A',serverRetryLimit:1,dialogueEndingRepetitionReduction:false,aiPostReview:{}};
for(const [name,createEngine] of [['verba',verba],['deep',deep]])for(const enabled of [false,true]) {
 test(`${name} server transports captured reference, one call, DeepSeek=${enabled}`,async()=>{
  const snapshot=JSON.parse(JSON.stringify({settings:{...settings,developerDeepseekKoreanEnabled:enabled},profiles:{A:{}},nameLocks:[],character:{name:'Morgan'},context:{name1:'Alex',name2:'Morgan'},translationReference:'SNAPSHOT_ONLY_NOT_SOURCE'}));
  const options=JSON.parse(JSON.stringify({speakerIdentity:{characterName:'Morgan',userName:'Alex',translationReference:'CAPTURED_ROLE_FACT'},previousUserSource:'PREVIOUS_USER_SENTINEL'}));
  let calls=0;
  const engine=createEngine(snapshot,async(_id,messages)=>{
   calls++;const p=messages[0].content;
   assert.match(p,/CONTEXT AND MEANING/);assert.equal(p.split('CAPTURED_ROLE_FACT').length-1,1);assert.match(p,/PREVIOUS_USER_SENTINEL/);assert.doesNotMatch(p,/SNAPSHOT_ONLY_NOT_SOURCE/);
   return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'부주장이 기다렸다.'}]})};
  });
  const result=await engine.output('The vice-captain waited.',options);
  assert.equal(calls,1);assert.match(result.translation,/부주장/);
 });
 test(`${name} enabled review keeps reference/rules out of review and does not add calls, DeepSeek=${enabled}`,async()=>{
  const snapshot={settings:{...settings,developerDeepseekKoreanEnabled:enabled,aiPostReview:{voice:true}},profiles:{A:{}},nameLocks:[],character:{name:'Morgan'},context:{name1:'Alex',name2:'Morgan'}};
  let calls=0;
  const engine=createEngine(snapshot,async(_id,messages)=>{
   calls++;const p=messages[0].content;
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')){
    assert.doesNotMatch(p,/CONTEXT AND MEANING|CAPTURED_ROLE_FACT/);
    const rows=JSON.parse(p.split('\nREVIEW_UNITS\n').at(-1));
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.current_translation}))})};
   }
   assert.match(p,/CAPTURED_ROLE_FACT/);
   return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"기다려."'}]})};
  });
  await engine.output('"Wait."',{speakerIdentity:{characterName:'Morgan',userName:'Alex',translationReference:'CAPTURED_ROLE_FACT'}});
  assert.equal(calls,2);
 });
}
test('reference participates in client reuse identity instead of silently reusing old facts',()=>{
 for(const repo of ['../../index.js','../../../veereubaa/index.js']){
  const index=fs.readFileSync(new URL(repo,import.meta.url),'utf8');
  assert.match(index,/getSnapshot: \(\) => \(\{[\s\S]*?translationReference: characterTranslationReference\.read\(\)/);
 }
});
