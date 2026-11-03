import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
for (const [name,createEngine] of [['verba',verba],['deep',deep]]) {
 test(`${name}: serialized USER register reaches output and existing voice review without extra calls`,async()=>{
  const snapshot=JSON.parse(JSON.stringify({settings:{profileId:'A',activeProfileSlot:'A',serverRetryLimit:1,dialogueEndingRepetitionReduction:false,developerRelationshipExperimentEnabled:true,developerUserToTargetRegister:'jondaetmal',aiPostReview:{voice:true}},profiles:{A:{}},nameLocks:[],character:{name:'Morgan'},context:{name1:'Alex',name2:'Morgan'}}));
  let calls=0;
  const engine=createEngine(snapshot,async(_id,messages)=>{
   calls++;const prompt=messages[0].content;
   assert.match(prompt,/USER-TO-CHARACTER SPEECH REGISTER/);
   assert.match(prompt,/USER→TARGET=JONDAETMAL/);
   if(prompt.startsWith('UNIFIED OUTPUT POST REVIEW')){
    const rows=JSON.parse(prompt.split('\nREVIEW_UNITS\n').at(-1));
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.current_translation}))})};
   }
   return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"기다려 주세요."'}]})};
  });
  await engine.output('"Wait for me."',{speakerIdentity:{characterName:'Morgan',userName:'Alex'}});
  assert.equal(calls,2);
 });
}
