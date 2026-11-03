import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const prompt='Inside italics, inline backticks and fenced code blocks, preserve the original English and add Korean in brackets. Everything outside these marked spans must be translated into Korean only.';
const source='He waited.\n\n*Stay quiet.*\n\n`Door locked.`\n\n<div>Hello.</div>';
function initialRows(text){
 const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));
 assert.ok(marker,'unexpected request: '+text.slice(0,100));
 return JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
}
const draft=r=>r.type==='code_content'?'문이 잠겼다. [문이 잠겼다.]':r.type==='tagged_content'?'Hello.':(r.text??r.source).includes('*')?'*조용히 있어. [조용히 있어.]*':'그는 기다렸다.';
function snapshot(extra={}) {return {settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:0,debugMode:true,globalPrompt:prompt,...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}};}
for(const [name,create] of [['verba',verba],['deep',deep]]) {
 for(const [mode,extra] of [['normal',{}],['minimal',{developerMode:true,developerMinimalPromptEnabled:true}],['split',{developerOutputSplitCount:2}],['compressed',{developerMode:true,developerCompressedPromptEnabled:true}]]){
  test(`${name}/${mode}: combined English/bilingual/meaning review once after all translation batches`,async()=>{
   let reviews=0,initial=0;
   const engine=create(snapshot({...extra,aiPostReview:{english:true,bilingual:true,meaning:true}}),async(_id,messages)=>{
    const text=messages.map(x=>x.content).join('\n');
    if(text.includes('\nREVIEW_UNITS\n')){
     reviews++;assert.equal(initial,mode==='split'?2:1);
     const rows=JSON.parse(text.split('\nREVIEW_UNITS\n')[1]);
     assert.equal(rows.filter(x=>x.type==='bilingual').length,2);
     assert.equal(rows.find(x=>x.scope==='tagged_content').type,'general');
     return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.type==='bilingual'?(r.scope==='italic'?'*Stay quiet. [조용히 있어.]*':'Door locked. [문이 잠겼다.]'):r.scope==='tagged_content'?'안녕.':r.CURRENT}))})};
    }
    initial++;
    return {content:JSON.stringify({segments:initialRows(text).map(r=>({id:r.id,translation:draft(r)}))})};
   });
   const result=await engine.output(source,{});
   assert.equal(reviews,1);assert.equal(initial,mode==='split'?2:1);
   assert.match(result.translation,/\*Stay quiet\. \[조용히 있어\.\]\*/);
   assert.match(result.translation,/`Door locked\. \[문이 잠겼다\.\]`/);
   assert.match(result.translation,/<div>안녕\.<\/div>/);
   assert.doesNotMatch(result.translation,/He waited/);
   assert.equal(result.outputComparison.postReview.status,'completed');
   assert.deepEqual(result.outputComparison.postReview.checks,['meaning','english','bilingual']);
   assert.ok(result.outputComparison.stages.some(x=>x.stage==='output-post-review'));
   assert.doesNotMatch(JSON.stringify(result.outputComparison),/Stay quiet|조용히|REVIEW_LOCK/);
  });
 }
 test(`${name}: all checks off has no post-review or old tag/English/bilingual repair calls`,async()=>{
  let calls=0;
  const engine=create(snapshot({aiPostReview:{}}),async(_id,messages)=>{
   calls++;const rows=initialRows(messages.map(x=>x.content).join('\n'));
   return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:draft(r)}))})};
  });
  const result=await engine.output(source,{});assert.equal(calls,1);assert.match(result.translation,/<div>Hello\.<\/div>/);
 });
 test(`${name}: request failures keep whole draft; markup damage keeps its segment without retry`,async()=>{
  for(const failure of ['network','json','missing','markup']){
   let reviews=0;
   const engine=create(snapshot({aiPostReview:{meaning:true,english:true,bilingual:true},serverRetryLimit:4}),async(_id,messages)=>{
    const text=messages.map(x=>x.content).join('\n');
    if(text.includes('\nREVIEW_UNITS\n')){
     reviews++;if(failure==='network')throw Error('provider error');if(failure==='json')return {content:'not json'};
     const rows=JSON.parse(text.split('\nREVIEW_UNITS\n')[1]);
     return {content:JSON.stringify({segments:rows.slice(failure==='missing'?1:0).map(r=>({id:r.id,translation:r.scope==='tagged_content'?'안녕.</div>':r.type==='bilingual'?(r.scope==='italic'?'*Stay quiet. [조용히 있어.]*':'Door locked. [문이 잠겼다.]'):r.CURRENT}))})};
    }
    return {content:JSON.stringify({segments:initialRows(text).map(r=>({id:r.id,translation:draft(r)}))})};
   });
   const result=await engine.output(source,{});
   assert.equal(reviews,1);
   if(failure==='markup'){
    assert.equal(result.outputComparison.postReview.status,'partial');
    assert.equal(result.translation,'그는 기다렸다.\n\n*Stay quiet. [조용히 있어.]*\n\n`Door locked. [문이 잠겼다.]`\n\n<div>Hello.</div>');
    assert.equal(result.outputComparison.postReview.failures[0].detail,'protected-structure');
   }else{
    assert.equal(result.outputComparison.postReview.status,'failed');
    assert.equal(result.translation,'그는 기다렸다.\n\n*조용히 있어. [조용히 있어.]*\n\n`문이 잠겼다. [문이 잠겼다.]`\n\n<div>Hello.</div>');
   }
  }
 });
 test(`${name}: input unaffected even with all review criteria selected`,async()=>{
  let calls=0;
  const engine=create(snapshot({aiPostReview:{meaning:true,english:true,bilingual:true}}),async(_id,messages)=>{
   calls++;assert.doesNotMatch(JSON.stringify(messages),/UNIFIED OUTPUT POST REVIEW/);
   return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'Hello.'}]})};
  });
  assert.equal(await engine.input('안녕.',{}),'Hello.');assert.equal(calls,1);
 });
}

for (const [name, create] of [['verba', verba], ['deep', deep]]) {
 test(`${name}: banned rejection terms survive engine diagnostics while independent edits apply`, async()=>{
  let reviews=0,initial=0;
  const engine=create(snapshot({globalPrompt:'',bannedWords:'금지표현',aiPostReview:{translationese:true,banned:true}}),async(_id,messages)=>{
   const p=messages.map(x=>x.content).join('\n');
   if(p.includes('\nREVIEW_UNITS\n')){
    reviews++;
    assert.match(p,/CONTEXTUAL REVIEW METHOD/);
    assert.match(p,/Configured terms: \["금지표현"\]/);
    const units=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
    return {content:JSON.stringify({segments:units.map((r,i)=>({id:r.id,translation:i===0?'금지표현이 새로 생겼다.':'그는 쉬었다.'}))})};
   }
   initial++;
   return {content:JSON.stringify({segments:initialRows(p).map((r,i)=>({id:r.id,translation:i===0?'그는 기다렸다.':'그는 쉬는 것을 했다.'}))})};
  });
  const out=await engine.output('He waited.\n\nHe rested.');
  assert.equal(reviews,1);assert.equal(initial,1);
  assert.equal(out.translation,'그는 기다렸다.\n\n그는 쉬었다.');
  const review=out.outputComparison.postReview;
  assert.equal(review.status,'partial');assert.equal(review.changed,1);
  assert.deepEqual(review.failures[0].bannedMatches,[{term:'금지표현',rule:'configured',matchMode:'case-sensitive-substring',presentBefore:false}]);
  assert.doesNotMatch(JSON.stringify(review),/새로 생겼다|He waited/);
 });
}
