import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const prompt = 'BILINGUAL OUTPUT FORMAT\nFor source text enclosed in italics (*...*), backticks (`...`), or square brackets ([...]), preserve the original English exactly and include its Korean translation once inside the same original markers.\nNever remove the original English or replace it with Korean inside these marked spans.\nTranslate everything outside these marked spans into Korean only, without retaining the English.';
for (const [name, create] of [['verba',verba],['deep',deep]]) {
 for(const [mode, extra] of [['normal',{}], ['minimal',{developerMode:true,developerMinimalPromptEnabled:true}]]) {
  test(`${name}/${mode}: marked global request does not force unrequested dialogue bilingual`,async()=>{
   let calls=0;
   const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:1,globalPrompt:prompt,...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
    calls++;
    const sent=messages.map(x=>x.content).join('\n');
    if(sent.includes('\nBILINGUAL_TARGETS\n')) {
     const rows=JSON.parse(sent.split('\nBILINGUAL_TARGETS\n')[1]);
     return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.CURRENT}))})};
    }
    assert.doesNotMatch(sent,/BILINGUAL DIALOGUE IS REQUIRED/);
    const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>sent.includes(x));
    assert.ok(marker,'no extra classification or repair call');
    const rows=JSON.parse(sent.slice(sent.lastIndexOf(marker)+marker.length));
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:
     row.type==='dialogue_candidate'?'"여기서 기다려."':row.type==='code_content'?'Door locked. [문이 잠겼다.]':'*Stay quiet. [조용히 있어.]*'}))})};
   });
   const result=await engine.output('"Wait here."\n\n*Stay quiet.*\n\n`Door locked.`',{});
   assert.equal(calls,2);
   assert.doesNotMatch(result.translation,/Wait here/);
   assert.match(result.translation,/Stay quiet/);
   assert.match(result.translation,/Door locked/);
  });
 }
}
