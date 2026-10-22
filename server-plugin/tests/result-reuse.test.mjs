import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '../../server-client.js';
import { createJobs } from '../jobs.cjs';
const BRIDGE=Symbol.for('silly-pop.apk.notifications.v1');
function fixture(t, prepareNotification) {
 const storage=new Map(),handlers={},submitted=[];
 let translations=0,reply='Original reply';
 const settings={serverTranslation:true,autoOutput:true,translationEngine:'google-free'};
 const context={chatId:'one',characterId:0,name2:'Character',getRequestHeaders:()=>({}),
  eventTypes:{GENERATION_STARTED:'start',GENERATE_AFTER_DATA:'data',CHAT_COMPLETION_SETTINGS_READY:'settings',GENERATION_ENDED:'end'},
  eventSource:{on:(name,fn)=>handlers[name]=fn}};
 const jobs=createJobs({prepareNotification,engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{translations++;return{translation:'Translated: '+source,sourceMap:[]};}})}},request:async(_c,_p,_payload,o)=>{
  const body=Buffer.from(JSON.stringify({choices:[{message:{content:reply}}]}));o.onHeaders(200,'application/json');o.onChunk(body);return{status:200,type:'application/json',body};
 }});
 t.after(()=>{jobs.stopAll();delete globalThis[BRIDGE];delete globalThis.sillyPopNotifications;});
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.window={addEventListener(){}};globalThis.document={hidden:false,addEventListener(){}};
 globalThis.location={origin:'http://localhost',href:'http://localhost/'};
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url,'http://localhost');
  if(u.pathname.endsWith('/capabilities'))return Response.json({protocol:1,engines:{verba:{version:'fixture'}}});
  if(u.pathname==='/api/plugins/verba-server/jobs'){
   const envelope=JSON.parse(init.body);submitted.push(envelope);const job=jobs.start('user',envelope,{});await job.done;return Response.json(jobs.status(job));
  }
  if(u.pathname.startsWith('/api/plugins/verba-server/jobs/'))return Response.json(jobs.status(jobs.lookup('user',u.pathname.split('/').at(-1)),Number(u.searchParams.get('cursor'))));
  throw Error('unexpected native generation');
 };
 const client=createServerClient({variant:'verba',version:'fixture',getSettings:()=>settings,getContext:()=>context,isActive:()=>true,getSnapshot:()=>({settings:{...settings}}),getGenerationOptions:()=>({options:{}})});
 client.install();
 const generate=async(source=reply)=>{
  reply=source;handlers.start('normal',{},false);const messages=[{role:'user',content:'Generate'}];handlers.data({prompt:messages});const payload={messages,type:'normal',stream:false};handlers.settings(payload);
  const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(payload)});await response.text();handlers.end();
 };
 const output=(source=reply,stage='output-translation')=>client.output(source,{automatic:stage==='output-translation',stage},()=>{throw Error('unexpected fallback');});
 return{client,generate,output,settings,context,submitted,count:()=>translations};
}
test('completed generation remains reusable after a UI apply retry and foreground return',async t=>{
 const f=fixture(t);await f.generate();const first=await f.output();const second=await f.output();
 assert.deepEqual(second,first);assert.equal(f.count(),1,'reading a used result must not translate it again');assert.equal(f.submitted.length,1);
 assert.equal(f.client.diagnostics().pendingAutomatic,0);
});
test('changed source, settings, chat and explicit retranslation never reuse incompatible generation',async t=>{
 const f=fixture(t);await f.generate();await f.output();
 await f.output('Different swipe');assert.equal(f.count(),2);
 f.settings.temperature=0.5;await f.output('Original reply');assert.equal(f.count(),3);
 delete f.settings.temperature;f.context.chatId='two';await f.output('Original reply');assert.equal(f.count(),4);
 f.context.chatId='one';await f.output('Original reply','output-retranslation');assert.equal(f.count(),5);
});
test('a newer generation blocks falling back to an older used reply',async t=>{
 const f=fixture(t);await f.generate('First');await f.output('First');await f.generate('Second');await f.output('Second');
 assert.equal(f.count(),2);await f.output('First');assert.equal(f.count(),3);
});
test('APK-specific bridge survives a different legacy bridge for both generation and fallback',async t=>{
 const f=fixture(t);const marker={protocol:1,translationEnabled:true,clientId:'tab',generationId:'reply',type:'normal'};
 globalThis[BRIDGE]={apiVersion:1,captureTranslation:()=>marker};
 globalThis.sillyPopNotifications={apiVersion:1,captureTranslation:()=>null};
 await f.generate();await f.output('Different final source');
 assert.equal(f.submitted.length,2);assert.deepEqual(f.submitted[0].notification,marker);assert.deepEqual(f.submitted[1].notification,{...marker,generationId:`verba:verba:${f.submitted[1].id}`});
});
test('disabled dedicated bridge does not fall through to a legacy opt-in',async t=>{
 const f=fixture(t);globalThis[BRIDGE]={apiVersion:1,captureTranslation:()=>null};
 globalThis.sillyPopNotifications={captureTranslation:()=>({translationEnabled:true})};
 await f.generate();assert.equal(f.submitted[0].notification,undefined);
});

test('manual retranslation is a barrier against restoring an older automatic result',async t=>{
 const f=fixture(t);await f.generate();await f.output();await f.output('Original reply','output-retranslation');
 assert.equal(f.count(),2);await f.output('Original reply');assert.equal(f.count(),3,'do not resurrect the generation result after a newer manual translation');
});

test('reuse survives closed control block removal after the first result read without another model call',async t=>{
 const f=fixture(t);await f.generate('Hello\n<archive-now>state</archive-now>');await f.output();
 const result=await f.output('Hello');assert.equal(result.translation,'Translated: Hello');assert.equal(f.count(),1);
 assert.equal(f.client.diagnostics().events.at(-1).relation,'closed-state-blocks-removed');
});
test('removed real tail is not silently reused and reports bounded structural evidence',async t=>{
 const f=fixture(t);await f.generate('Hello unchanged tail');await f.output();await f.output('Hello');
 assert.equal(f.count(),2);const event=f.client.diagnostics().events.find(e=>e.event==='reuse-skipped');
 assert.equal(event.relation,'tail-removed');assert.equal(event.afterLength,5);assert(!JSON.stringify(event).includes('unchanged'));
});

// The APK bridge may keep the same generationId throughout one reply. A new
// final-source translation must not collide with the original completion key.
test('changed final source gets a separate completion notice; rereading it never retranslates or renotifies',async t=>{
 const handled=new Set(),notices=[];
 const f=fixture(t,(_owner,marker)=>marker?.translationEnabled?async()=>{
  if(handled.has(marker.generationId))return{reason:'duplicate'};
  handled.add(marker.generationId);notices.push(marker.generationId);return{reason:'dispatched'};
 }:null);
 const marker={protocol:1,translationEnabled:true,clientId:'tab',generationId:'one-reply',type:'normal'};
 globalThis[BRIDGE]={apiVersion:1,captureTranslation:()=>marker};
 await f.generate();await f.output();assert.equal(notices.length,1);
 await f.output('Revised reply');assert.equal(notices.length,2,'the new translation completion must not be suppressed as the old reply');
 assert.equal(marker.generationId,'one-reply','never mutate the shared APK marker');
 const revised=await f.output('Revised reply');assert.equal(revised.translation,'Translated: Revised reply');
 assert.equal(f.count(),2,'a repeated UI read must reuse the revised translation');assert.equal(notices.length,2);
 await f.output('Revised again');assert.equal(f.count(),3);assert.equal(notices.length,3);
 await f.output('Revised again');assert.equal(f.count(),3);assert.equal(notices.length,3);
 await f.output('Revised again','output-retranslation');assert.equal(f.count(),4);assert.equal(notices.length,3,'explicit manual translation remains silent');
});
