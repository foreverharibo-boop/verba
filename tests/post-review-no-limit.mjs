import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewOutputOnce } from '../post-review.js';

for (const [name,count,reference] of [
 ['long instructions',1,'REFERENCE_START '+ '긴 지침. '.repeat(25000)+' REFERENCE_END'],
 ['more than 300 units',301,''],
]) test(`review sends ${name} completely and applies accepted changes`,async()=>{
 const segmented={segments:Array.from({length:count},(_,i)=>({id:`seg_${i}`,type:'narration',text:'She waited.'}))};
 const translations=new Map(segmented.segments.map(r=>[r.id,'그녀가 기다리는 것을 했다.']));
 let calls=0;
 const result=await reviewOutputOnce({segmented,translations,reference,settings:{debugMode:true,aiPostReview:{translationese:true}},request:async(prompt,rows)=>{
  calls++;
  if(reference){assert.ok(prompt.length>120000);assert.ok(prompt.includes(reference));}
  assert.equal(rows.length,count);
  assert.deepEqual(rows.map(r=>r.SOURCE),segmented.segments.map(r=>r.text));
  assert.ok(rows.every(r=>r.checks.includes('translationese')));
  return new Map(rows.map(r=>[r.id,'그녀는 기다렸다.']));
 }});
 assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.checked,count);
 assert.equal(result.changed,count);assert.equal(result.rejected,0);
 assert.ok([...translations.values()].every(t=>t==='그녀는 기다렸다.'));
});
test('provider rejection remains visible and does not overwrite the available translation',async()=>{
 const segmented={segments:[{id:'seg_0',type:'narration',text:'She waited.'}]};
 const translations=new Map([['seg_0','그녀는 기다렸다.']]);let calls=0;
 const result=await reviewOutputOnce({segmented,translations,reference:'x'.repeat(130000),settings:{debugMode:true,aiPostReview:{meaning:true}},request:async()=>{calls++;throw Object.assign(new Error('input too long'),{status:413});}});
 assert.equal(calls,1);assert.equal(result.status,'failed');assert.notEqual(result.reviewReason,'limit');
 assert.equal(translations.get('seg_0'),'그녀는 기다렸다.');
});
