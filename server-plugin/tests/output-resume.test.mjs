import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '../../server-client.js';
import { createJobs } from '../jobs.cjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function within(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('completed output was not delivered')),300);})]);}finally{clearTimeout(timer);}}

for(const bodyStall of [false,true])test(`automatic output notifies and resumes its completed result (bodyStall=${bodyStall})`,async t=>{
 const handlers={},storage=new Map(),waiting=deferred(),stale=deferred();
 let translations=0,notices=0,submits=0,reads=0,job;
 const notification={protocol:1,translationEnabled:true,clientId:'tab',generationId:'reply',type:'normal',characterName:'Original'};
 globalThis.sillyPopNotifications={captureTranslation:()=>notification};
 t.after(()=>delete globalThis.sillyPopNotifications);
 const jobs=createJobs({engines:{verba:{createEngine:()=>({output:async()=>{translations++;return{translation:'완료된 번역',sourceMap:[]};}})}},prepareNotification:(_owner,marker)=>{
  assert.match(marker.generationId,/^verba:verba:[a-f0-9]{32}$/);
  assert.deepEqual({...marker,generationId:notification.generationId},notification);return()=>{notices++;};
 }});
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.window={addEventListener:(n,f)=>handlers[n]=f};
 globalThis.document={hidden:false,addEventListener:(n,f)=>handlers[n]=f};
 globalThis.location={origin:'http://localhost',href:'http://localhost/'};
 globalThis.fetch=async(url,init={})=>{
  if(url.endsWith('/capabilities'))return Response.json({protocol:1,engines:{verba:{version:'fixture'}}});
  if(url.endsWith('/jobs')){submits++;job=jobs.start('alice',JSON.parse(init.body),{});await job.done;return Response.json(jobs.status(job));}
  reads++;
  if(reads===1){waiting.resolve();if(bodyStall)return{ok:true,json:()=>stale.promise};return stale.promise.then(Response.json);}
  return Response.json(jobs.status(job));
 };
 const settings={serverTranslation:true,translationEngine:'google-free'};
 const context={getRequestHeaders:()=>({}),chatId:'one',characterId:0,name2:'Original'};
 const client=createServerClient({variant:'verba',version:'fixture',getSettings:()=>settings,getContext:()=>context,isActive:()=>true,getSnapshot:()=>({settings}),getGenerationOptions:()=>({options:{}})});
 client.install();
 const result=client.output('English reply',{automatic:true,stage:'output-translation'},()=>{throw Error('local fallback');});
 try{
  await waiting.promise;await job.notificationDone;
  assert.equal(notices,1,'automatic fallback must notify even before browser reads result');
  handlers.visibilitychange?.();handlers.pageshow?.();handlers.online?.();
  assert.equal((await within(result)).translation,'완료된 번역');
  stale.resolve({...jobs.status(job),result:{translation:'stale'}});await tick();
  assert.equal(submits,1);assert.equal(translations,1);assert.equal(notices,1);
 }finally{stale.resolve(jobs.status(job));await result.catch(()=>{});}
});

test('only explicitly automatic output translation is eligible for output notifications',async()=>{
 for(const options of [{},{automatic:false,stage:'output-translation'},{automatic:true,stage:'output-retranslation'},{automatic:true,stage:'output-translation'}]){
  let notices=0;
  const jobs=createJobs({engines:{verba:{createEngine:()=>({output:async()=>({translation:'번역'})})}},prepareNotification:()=>()=>{notices++;}});
  const job=jobs.start('alice',{id:'a'.repeat(32),kind:'output',source:'Hello',snapshot:{variant:'verba',settings:{}},options,notification:{translationEnabled:true}},{});
  await job.done;await job.notificationDone;
  assert.equal(notices,options.automatic===true&&options.stage==='output-translation'?1:0);
 }
});
