import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
import { DEEPSEEK_KOREAN_REVIEW_GUIDANCE } from '../../deepseek-korean.js';
import { reportedPrompt } from '../../tests/fixtures/bilingual-inline-rules.js';
const snapshot = extra => ({settings:{developerMode:true,developerDeepseekKoreanEnabled:true,profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:0,debugMode:true,allDialoguePromptEnabled:true,allDialoguePrompt:reportedPrompt,globalPromptEnabled:true,globalPrompt:'STYLE_SENTINEL',aiPostReview:{deepseekTranslationese:true},...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}});
const source='He lay on his back.\n\n"Enjoy the seat."';
function rows(p){const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(m=>p.includes(m));assert.ok(marker);return JSON.parse(p.slice(p.lastIndexOf(marker)+marker.length));}
const reply = rows => ({content:JSON.stringify({segments:rows})});
for(const [name,create] of [['verba',verba],['deep',deep]]){
 for(const split of [1,2]) test(`${name}: dedicated check shares one final request after ${split} initial batches`,async()=>{
  let initial=0,reviews=0;const config=snapshot({developerOutputSplitCount:split,aiPostReview:{meaning:true,deepseekTranslationese:true}});
  const engine=create(config,async(_id,messages)=>{
   const p=messages.map(m=>m.content).join('\n');
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')){
    reviews++;assert.match(p,/accurate meaning alone is not a reason to retain awkward wording/);assert.equal(initial,split);assert.ok(p.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));assert.match(p,/STYLE_SENTINEL/);
    const targets=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);assert.ok(targets.every(r=>r.checks.includes('deepseekTranslationese')));
    assert.equal(targets.filter(r=>r.type==='bilingual').length,1);
    return reply(targets.map(r=>({id:r.id,translation:r.CURRENT.replace('척추를 대고','등을 대고').replace('좌석을 즐겨.','거기 앉아서 편히 쉬어.')})));
   }
   initial++;return reply(rows(p).map(r=>({id:r.id,translation:r.type==='dialogue_candidate'?'"Enjoy the seat. (좌석을 즐겨.)"':'그는 척추를 대고 누웠다.'})));
  });
  const out=await engine.output(source);
  assert.equal(reviews,1);assert.equal(initial,split);assert.equal(out.outputComparison.postReview.status,'completed');
  assert.deepEqual(out.outputComparison.postReview.checks,['meaning','deepseekTranslationese']);
  assert.equal(out.translation,'그는 등을 대고 누웠다.\n\n"Enjoy the seat. (거기 앉아서 편히 쉬어.)"');
 });
 test(`${name}: disabled developer mode, checkbox or DeepSeek add no review calls`,async()=>{
  for(const extra of [{developerMode:false},{aiPostReview:{}},{developerDeepseekKoreanEnabled:false}]){
   let calls=0;const engine=create(snapshot(extra),async(_id,messages)=>{
    calls++;const p=messages[0].content;assert.ok(!p.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));
    return reply(rows(p).map(r=>({id:r.id,translation:'그는 기다렸다.'})));
   });
   await engine.output('He waited.');assert.equal(calls,1);
  }
 });
 test(`${name}: developer mode off keeps ordinary review but excludes the saved dedicated check`,async()=>{
  let reviews=0;
  const engine=create(snapshot({developerMode:false,aiPostReview:{meaning:true,deepseekTranslationese:true}}),async(_id,messages)=>{
   const p=messages[0].content;
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
    reviews++;assert.ok(!p.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));
    const targets=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
    assert.ok(targets.every(r=>r.checks.includes('meaning')&&!r.checks.includes('deepseekTranslationese')));
    return reply(targets.map(r=>({id:r.id,translation:r.CURRENT})));
   }
   return reply(rows(p).map(r=>({id:r.id,translation:'그는 기다렸다.'})));
  });
  await engine.output('He waited.');assert.equal(reviews,1);
 });
 test(`${name}: input stays independent with dedicated checkbox selected`,async()=>{
  let calls=0;const engine=create(snapshot({}),async(_id,messages)=>{
   calls++;assert.ok(!messages[0].content.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));return reply([{id:'seg_0000',translation:'Hello.'}]);
  });
  assert.equal(await engine.input('안녕.'),'Hello.');assert.equal(calls,1);
 });
 test(`${name}: corrupt dialogue keeps its draft while valid narration applies without retry`,async()=>{
  let reviews=0;const engine=create(snapshot({}),async(_id,messages)=>{
   const p=messages[0].content;
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')){
    reviews++;return reply(JSON.parse(p.split('\nREVIEW_UNITS\n')[1]).map(r=>({id:r.id,translation:r.type==='bilingual'?r.CURRENT.replace('Enjoy the seat.','Take a seat.'):'그는 등을 대고 누웠다.'})));
   }
   return reply(rows(p).map(r=>({id:r.id,translation:r.type==='dialogue_candidate'?'"Enjoy the seat. (좌석을 즐겨.)"':'그는 척추를 대고 누웠다.'})));
  });
  const out=await engine.output(source);assert.equal(reviews,1);assert.equal(out.outputComparison.postReview.status,'partial');
  assert.equal(out.outputComparison.postReview.failures[0].reason,'invalid-bilingual');
  assert.equal(out.translation,'그는 등을 대고 누웠다.\n\n"Enjoy the seat. (좌석을 즐겨.)"');
 });
}
