const test=require('node:test');
const assert=require('node:assert/strict');
const {createJobs}=require('../jobs.cjs');
const snapshot={variant:'verba',settings:{}};
const response={state:'completed',status:200,type:'application/json',body:Buffer.from('{"choices":[{"message":{"content":"Hello"}}]}')};
const envelope=(kind='generation',extra={})=>({id:'a'.repeat(32),kind,snapshot,source:'Hello',generation:{path:'/api/backends/chat-completions/generate',payload:{}},notification:{translationEnabled:true},...extra});
function setup({output=async()=>({translation:'안녕'}),shouldTranslate=()=>true,request=async()=>response,prepareNotification}={}) {
 return createJobs({engines:{verba:{createEngine:()=>({shouldTranslate,output,input:output,segments:async()=>[],request:output})}},request,prepareNotification});
}
test('both generation routes notify after translation, without a browser; reads/retries never repeat',async()=>{
 for(const kind of ['generation','observed-generation']) {
  let resolveTranslation,notices=0,prepares=0;
  const jobs=setup({output:()=>new Promise(r=>resolveTranslation=r),prepareNotification:(owner,metadata)=>{
   prepares++;assert.equal(owner,'alice');assert.equal(metadata.translationEnabled,true);
   return async()=>{notices++;assert.equal(job.state,'completed');assert.equal(job.result.translation,'안녕');return{reason:'dispatched'};};
  }});
  const input=envelope(kind);const job=jobs.start('alice',input,{});
  if(kind==='observed-generation')jobs.observed('alice',job.id,response);
  await Promise.resolve();assert.equal(notices,0);
  resolveTranslation({translation:'안녕'});await job.done;await job.notificationDone;
  assert.equal(notices,1);assert.equal(jobs.start('alice',input,{}),job);
  for(let i=0;i<5;i++)jobs.status(jobs.lookup('alice',job.id));
  assert.equal(notices,1);assert.equal(prepares,1);assert.equal(job.events.at(-1).code,'dispatched');
 }
});
test('helper/manual/input jobs, skips, empty output, HTTP failures and translation failures never notify',async()=>{
 let notices=0,prepares=0;const prepareNotification=()=>{prepares++;return()=>{notices++;};};
 for(const kind of ['output','input','segments','request']) {
  const jobs=setup({prepareNotification});const job=jobs.start('alice',envelope(kind),{});await job.done;
  assert.equal(job.state,'completed');assert.equal(job.notificationDone,undefined);
 }
 assert.equal(prepares,0);
 for(const config of [{shouldTranslate:()=>false},{output:async()=>({translation:'  '})},
  {request:async()=>({...response,status:500})},{output:async()=>{throw Error('provider failed');}}]) {
  const jobs=setup({...config,prepareNotification});const job=jobs.start('alice',envelope(),{});
  await job.done;await job.notificationDone;
 }
 assert.equal(notices,0);
});
test('cancellation while translation runs prevents notification even if engine returns a result',async()=>{
 let resolveTranslation,notices=0;
 const jobs=setup({output:()=>new Promise(r=>resolveTranslation=r),prepareNotification:()=>()=>{notices++;}});
 const job=jobs.start('alice',envelope(),{});await Promise.resolve();
 jobs.cancel('alice',job.id);resolveTranslation({translation:'안녕'});await job.done;
 assert.equal(job.state,'cancelled');assert.equal(notices,0);
});
test('missing, throwing, or rejected notifier never breaks or repeats translation',async()=>{
 for(const prepareNotification of [undefined,()=>{throw Error('secret');},()=>()=>{throw Error('secret');},()=>async()=>{throw Error('secret');}]) {
  let calls=0;
  const jobs=setup({prepareNotification,output:async()=>{calls++;return{translation:'안녕'};}});
  const job=jobs.start('alice',envelope(),{});await job.done;await job.notificationDone;
  assert.equal(job.state,'completed');assert.equal(calls,1);assert.equal(job.result.translation,'안녕');
  assert.doesNotMatch(JSON.stringify(jobs.status(job)),/secret/);
 }
});
