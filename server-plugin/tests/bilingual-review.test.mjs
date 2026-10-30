import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const prompt='BILINGUAL OUTPUT FORMAT\nInside italics, inline backticks and fenced code blocks, preserve the original English and add Korean in brackets.\nEverything outside these marked spans must be translated into Korean only.';
for(const [name,create] of [['verba',verba],['deep',deep]]) {
 for(const [mode, extra] of [['normal',{}],['minimal',{developerMode:true,developerMinimalPromptEnabled:true}],['split',{developerMode:true,developerOutputSplitCount:2}],['compressed',{developerMode:true,developerCompressedPromptEnabled:true}]]) {
  test(`${name}/${mode}: one final review repairs marked output without bilingualizing narration/dialogue`,async()=>{
   let reviews=0, initial=0;
   const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode:true,globalPrompt:prompt,...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
    const text=messages.map(x=>x.content).join('\n');
    if(text.includes('\nBILINGUAL_TARGETS\n')) {
     reviews++;const rows=JSON.parse(text.split('\nBILINGUAL_TARGETS\n')[1]);
     assert.equal(rows.length,2);
     assert.deepEqual(rows.map(r=>r.kind).sort(),['code','italic']);
     return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.kind==='italic'?'*Stay quiet. [조용히 있어.]*':'Door locked. [문이 잠겼다.]'}))})};
    }
    initial++;
    const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));assert.ok(marker,'unexpected auxiliary call');
    const rows=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.type==='dialogue_candidate'?'"여기서 기다려."':row.type==='code_content'?'문이 잠겼다. [문이 잠겼다.]':(row.text??row.source).includes('*')?'*조용히 있어. [조용히 있어.]*':'그는 기다렸다.'}))})};
   });
   const result=await engine.output('He waited.\n\n"Wait here."\n\n*Stay quiet.*\n\n`Door locked.`',{});
   assert.equal(reviews,1);assert.equal(initial,mode==='split'?2:1);
   assert.match(result.translation,/\*Stay quiet\. \[조용히 있어\.\]\*/);
   assert.match(result.translation,/`Door locked\. \[문이 잠겼다\.\]`/);
   assert.doesNotMatch(result.translation,/He waited|Wait here/);
   const comparison=result.outputComparison;
   assert.deepEqual(comparison.bilingualReview,{checked:2,changed:2,rejected:0,skipped:0,status:'completed'});
   assert.equal(comparison.stages.find(x=>x.stage==='bilingual-review').changedRows,2);
   assert.doesNotMatch(JSON.stringify(comparison),/Stay quiet|조용히/);
  });
 }
 test(`${name}: failure and malformed review have no retry and keep previous translation`,async()=>{
  for(const mode of ['error','invalid','foreign-id']) {
   let reviews=0;
   const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:4,globalPrompt:prompt,debugMode:true},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
    const text=messages.map(x=>x.content).join('\n');
    if(text.includes('\nBILINGUAL_TARGETS\n')) {
     reviews++;if(mode==='error')throw Error('Unavailable');
     const rows=JSON.parse(text.split('\nBILINGUAL_TARGETS\n')[1]);
     return {content:JSON.stringify({segments:rows.map(r=>({id:mode==='foreign-id'?'wrong':r.id,translation:'*다른 글 [다른 글]*'}))})};
    }
    const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));
    const rows=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:'*조용히 있어. [조용히 있어.]*'}))})};
   });
   const result=await engine.output('*Stay quiet.*',{});
   assert.equal(reviews,1);assert.equal(result.translation,'*조용히 있어. [조용히 있어.]*');
   assert.equal(result.outputComparison.bilingualReview.changed,0);
  }
 });
 test(`${name}: input path never runs a bilingual review`,async()=>{
  let calls=0;
  const engine=create({settings:{profileId:'A',globalPrompt:prompt,autoProfileFallback:false},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
   calls++;assert.doesNotMatch(JSON.stringify(messages),/BILINGUAL FORMAT REVIEW/);
   return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'Stay quiet.'}]})};
  });
  assert.equal(await engine.input('조용히 있어.',{}),'Stay quiet.');assert.equal(calls,1);
 });
}
