import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFailureSummary } from '../diagnostics.js';
import { reviewOutputOnce } from '../post-review.js';
import { segmentSource } from '../core.js';
import { sanitizeOutputComparison } from '../output-comparison.js';
import { createDisplayStateTrace } from '../display-state-trace.js';
const secret = 'PRIVATE CHAT AND KEY sk-private-key-never-serialize';
const fixture=()=>{const segmented=segmentSource('She waited.');return {segmented,translations:new Map(segmented.segments.map(s=>[s.id,'그녀는 기다렸다.']))};};
for (const [kind,fields] of [
 ['timeout',{code:'VERBA_TIMEOUT'}],['http-error',{status:503}],['empty-response',{code:'VERBA_RESPONSE_EMPTY'}],
 ['network-error',{code:'ECONNRESET'}],['aborted',{name:'AbortError'}],['request-failed',{}],
 ['response-format',{code:'VERBA_REVIEW_FORMAT',receivedUnits:0}],['incomplete-response',{code:'VERBA_REVIEW_INCOMPLETE',receivedUnits:1}],
]) test(`review failure ${kind}: one request, retained draft, bounded evidence`,async()=>{
 const data=fixture(), before=[...data.translations];let calls=0;
 const stats=await reviewOutputOnce({...data,settings:{debugMode:true,aiPostReview:{meaning:true}},options:{postReviewTimeoutSeconds:60},request:async()=>{
  calls++;throw Object.assign(new Error(secret),fields,{response:{data:secret},stack:secret});
 }});
 assert.equal(calls,1);assert.equal(stats.status,'failed');assert.equal(stats.reviewReason,kind);
 assert.equal(stats.requestedUnits,1);assert.equal(stats.checked,0);assert.equal(stats.receivedUnits,fields.receivedUnits||0);
 assert.equal(stats.requestTimeoutSeconds,60);assert.ok(stats.elapsedMs>=0);assert.deepEqual([...data.translations],before);
 const report=sanitizeOutputComparison({version:1,postReview:stats});
 assert.equal(report.postReview.requestFailure.kind,kind);assert.doesNotMatch(JSON.stringify(report),/PRIVATE|sk-private/);
});
test('deep request codes keep their diagnostic category',()=>{
 assert.equal(requestFailureSummary({code:'VERBA_DEEP_TIMEOUT'}).kind,'timeout');
 assert.equal(requestFailureSummary({code:'VERBA_DEEP_RESPONSE_EMPTY'}).kind,'empty-response');
});
test('complete response is distinguished from requested and partial response counts',async()=>{
 for(const complete of [false,true]){
  const data=fixture();const stats=await reviewOutputOnce({...data,settings:{debugMode:true,aiPostReview:{meaning:true}},request:async(_p,rows)=>new Map(complete?rows.map(r=>[r.id,r.CURRENT]):[['unknown',secret]])});
  assert.equal(stats.checked,complete?1:0);assert.equal(stats.receivedUnits,complete?1:0);
  assert.equal(stats.requestedUnits,1);assert.equal(stats.status,complete?'completed':'failed');
 }
});
test('outer cancellation propagates without partial changes',async()=>{
 const data=fixture(), before=[...data.translations], controller=new AbortController();
 await assert.rejects(reviewOutputOnce({...data,settings:{debugMode:true,aiPostReview:{meaning:true}},options:{signal:controller.signal},request:async()=>{controller.abort();throw new Error('cancel');}}));
 assert.deepEqual([...data.translations],before);
});
test('sanitizer drops arbitrary fields and limits diagnostic metadata',()=>{
 const postReview=sanitizeOutputComparison({version:1,postReview:{requestedUnits:Infinity,receivedUnits:-5,requestTimeoutSeconds:999999,requestFailure:{kind:secret,httpStatus:200,body:secret},prompt:secret}}).postReview;
 assert.equal(postReview.requestedUnits,0);assert.equal(postReview.receivedUnits,0);assert.equal(postReview.requestTimeoutSeconds,3600);
 assert.deepEqual(postReview.requestFailure,{kind:'request-failed',httpStatus:null});assert.doesNotMatch(JSON.stringify(postReview),/PRIVATE/);
 const error=Object.assign(new Error(secret),{cause:Object.assign(new Error(secret),{status:429})});error.cause.cause=error;
 assert.deepEqual(requestFailureSummary(error),{kind:'http-error',httpStatus:429});
});
test('display checkpoints identify divergence without mutation or retained text',()=>{
 let at=0;const trace=createDisplayStateTrace({enabled:()=>true,now:()=>++at});
 const record={translation:secret},message={swipe_id:2,extra:{display_text:secret}};
 trace.observe(102,message,record,'apply-stored',true,false);
 trace.observe(102,message,record,'apply-rendered',true,false);
 message.extra.display_text='another private text';
 trace.observe(102,message,record,'page-resumed',false,false);
 const event=trace.diagnostics().events.at(-1);
 assert.equal(event.before.matches,true);assert.equal(event.after.matches,false);assert.equal(event.previousObservedAt,2);
 assert.equal(event.after.active,false);assert.equal(event.after.swipeId,2);
 assert.equal(message.extra.display_text,'another private text');assert.ok('value' in Object.getOwnPropertyDescriptor(message.extra,'display_text'));
 assert.doesNotMatch(JSON.stringify(trace.diagnostics()),/PRIVATE|another private/);
 const snapshot=trace.diagnostics();snapshot.events[0].after.matches=false;assert.equal(trace.diagnostics().events[0].after.matches,true);
 trace.reset();assert.deepEqual(trace.diagnostics().events,[]);
});
test('display trace is dormant when disabled, bounded, and supports replacements and explicit source view',()=>{
 let enabled=false;const trace=createDisplayStateTrace({enabled:()=>enabled});
 trace.observe(1,{extra:{display_text:secret}},{translation:secret},secret,true,false);assert.equal(trace.diagnostics().events.length,0);
 enabled=true;
 for(let i=0;i<30;i++)trace.observe(1,{swipe_id:i,extra:{display_text:''}},{translation:secret},secret,true,true);
 assert.equal(trace.diagnostics().events.length,24);assert.equal(trace.diagnostics().events.at(-1).after.sourceViewRequested,true);
 assert.equal(trace.diagnostics().events.at(-1).phase,'other');assert.doesNotMatch(JSON.stringify(trace.diagnostics()),/PRIVATE/);
 enabled=false;assert.equal(trace.diagnostics().events.length,0);
});
