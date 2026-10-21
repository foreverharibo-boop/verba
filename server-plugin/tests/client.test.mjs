import test from 'node:test';
import assert from 'node:assert/strict';
import {captureConnectionProfiles,createServerClient} from '../../server-client.js';
import {createJobs} from '../jobs.cjs';
function environment(fetch){
 globalThis.fetch=fetch;
 const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 globalThis.location={origin:'http://localhost',href:'http://localhost/'};
 globalThis.window={addEventListener(){}};globalThis.document={hidden:false,addEventListener(){}};
 return data;
}
function profileContext(){
 let paid=0;
 const cc={async sendRequest(payload){paid++;return{content:'real'};}};
 const cm={async sendRequest(id,messages,maxTokens,custom={}){
  assert.notEqual(custom.includePreset,false);
  return cc.sendRequest({messages,stream:false,model:'saved-model',vertexai_project_id:'saved-project',temperature:0.83,max_tokens:maxTokens,secret_id:'saved-secret'});
 }};
 return {ChatCompletionService:cc,ConnectionManagerRequestService:cm,paid:()=>paid};
}
test('native profile/preset capture sends no generation and preserves saved fields',async()=>{
 const c=profileContext();const original=c.ChatCompletionService.sendRequest;
 const profiles=await captureConnectionProfiles(c,['A']);
 assert.equal(c.paid(),0);assert.equal(c.ChatCompletionService.sendRequest,original);
 assert.equal(profiles.A.payload.vertexai_project_id,'saved-project');assert.equal(profiles.A.payload.temperature,0.83);
 assert.equal(profiles.A.payload.secret_id,'saved-secret');
 await c.ChatCompletionService.sendRequest({messages:[]});assert.equal(c.paid(),1);
});
test('unrelated concurrent requests are not captured',async()=>{
 const c=profileContext();const old=c.ConnectionManagerRequestService.sendRequest;
 c.ConnectionManagerRequestService.sendRequest=async(...args)=>{await c.ChatCompletionService.sendRequest({messages:[{content:'unrelated'}]});return old(...args);};
 await captureConnectionProfiles(c,['A']);assert.equal(c.paid(),1);
});
test('disabled mode has zero plugin requests; missing plugin keeps local output',async()=>{
 let calls=0;environment(async()=>{calls++;return new Response('{}',{status:404});});
 const settings={serverTranslation:false};const c={getRequestHeaders:()=>({}),chatId:'one'};
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings}),getGenerationOptions:()=>({options:{}})});
 assert.equal(await client.output('Hello.',{},async()=>'local'),'local');assert.equal(calls,0);
 settings.serverTranslation=true;
 assert.equal(await client.output('Hello.',{},async()=>'local'),'local');assert.equal(calls,1);
});
test('both installed but disabled clients leave native model settings and wire body unchanged',async()=>{
 const calls=[];environment(async(input,init)=>{calls.push({input,init});return Response.json({ok:true});});
 const handlers=new Map();
 const eventTypes=Object.fromEntries(['GENERATION_STARTED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY','GENERATION_ENDED'].map(name=>[name,name]));
 const nativeSettings=Object.freeze({vertexai_model:'gemini-4-argon'});
 const c={chatCompletionSettings:nativeSettings,eventTypes,eventSource:{on:(name,fn)=>{
  if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);
 }}};
 for(const variant of ['verba','verba-deep'])createServerClient({variant,version:'fixture',getSettings:()=>({serverTranslation:false}),getContext:()=>c,isActive:()=>true,
  getSnapshot:()=>{throw Error('disabled client captured a profile');},getGenerationOptions:()=>{throw Error('disabled client intercepted generation');}}).install();
 const emit=(name,...args)=>handlers.get(name)?.forEach(fn=>fn(...args));
 for(let i=0;i<3;i++){
  const messages=Object.freeze([Object.freeze({role:'user',content:'fixture'})]);
  const payload=Object.freeze({messages,model:'gemini-4-argon',type:'normal',stream:false});
  emit('GENERATION_STARTED','normal',{},false);emit('GENERATE_AFTER_DATA',{prompt:messages});emit('CHAT_COMPLETION_SETTINGS_READY',payload);
  const init=Object.freeze({method:'POST',body:JSON.stringify(payload)});
  await fetch('/api/backends/chat-completions/generate',init);
  assert.equal(calls.at(-1).init,init);assert.equal(JSON.parse(calls.at(-1).init.body).model,'gemini-4-argon');
  emit('GENERATION_ENDED');
 }
 assert.equal(calls.length,3);assert.equal(nativeSettings.vertexai_model,'gemini-4-argon');
});
test('interrupted first result lookup reconnects to the completed job without another AI request',async t=>{
 const notification={protocol:1,translationEnabled:true,clientId:'tab',generationId:'reply',characterName:'Chris'};
 globalThis.sillyPopNotifications={captureTranslation:type=>{assert.equal(type,'normal');return notification;}};
 t.after(()=>delete globalThis.sillyPopNotifications);
 let generations=0,translations=0;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{translations++;return{translation:'안녕.',sourceMap:[]};}})}},request:async(_c,_p,p,o)=>{
  generations++;const body=Buffer.from(JSON.stringify({choices:[{message:{content:'Hello.'}}]}));o.onHeaders(200,'application/json');o.onChunk(body);return{status:200,type:'application/json',body};
 }});
 let nativeCalls=0,abortNextStatus=false,cancellations=0;
 environment(async(url,init={})=>{
  const path=new URL(url,'http://localhost').pathname;
  if(path.endsWith('/capabilities'))return Response.json({protocol:1,engines:{verba:{version:'0.6.51'}}});
  if(path==='/api/plugins/verba-server/jobs'){const input=JSON.parse(init.body);assert.deepEqual(input.notification,input.kind==='generation'?notification:undefined);return Response.json(jobs.status(jobs.start('a',input,{})));}
  if(path.endsWith('/cancel')){cancellations++;return Response.json({});}
  if(path.startsWith('/api/plugins/verba-server/jobs/')){
   if(abortNextStatus){abortNextStatus=false;throw new DOMException('signal is aborted without reason','AbortError');}
   const id=path.split('/').at(-1);return Response.json(jobs.status(jobs.lookup('a',id),new URL(url,'http://localhost').searchParams.get('cursor')));
  }
  nativeCalls++;return Response.json({});
 });
 const handlers={};const settings={serverTranslation:true,autoOutput:true,profileId:'A'};
 const c={...profileContext(),chatId:'one',characterId:0,name2:'Chris',getRequestHeaders:()=>({}),eventTypes:{GENERATION_STARTED:'start',GENERATE_AFTER_DATA:'data',CHAT_COMPLETION_SETTINGS_READY:'settings',GENERATION_ENDED:'end'},eventSource:{on:(n,fn)=>handlers[n]=fn}};
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings:{...settings},nameLocks:[],context:{},character:{}}),getGenerationOptions:()=>({options:{}})});
 client.install();handlers.start('normal',{},false);
 const messages=[{role:'user',content:'Hi'}];handlers.data({prompt:messages});const payload={messages,type:'normal',stream:false};handlers.settings(payload);
 const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(payload)});
 assert.equal(generations,1);assert.equal(translations,1);assert.equal(nativeCalls,0);
 assert.equal((await response.json()).choices[0].message.content,'Hello.');
 abortNextStatus=true;
 const result=await client.output('Hello.',{stage:'output-translation'},()=>{throw Error('unexpected local');});
 assert.equal(result.translation,'안녕.');assert.equal(translations,1);
 assert.equal(cancellations,0);
 // Explicit retranslation never reuses the auto-generation result.
 await client.output('Hello.',{stage:'output-retranslation'},()=>{});assert.equal(translations,2);
});

test('the actual 20-second transport timer is a connection timeout, not user cancellation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 environment((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>({}),getContext:()=>({getRequestHeaders:()=>({})}),isActive:()=>true,getSnapshot:()=>({settings:{}}),getGenerationOptions:()=>({options:{}})});
 const pending=client.check();
 const checked=assert.rejects(pending,error=>error.name!=='AbortError'&&error.code==='VERBA_SERVER_CONNECTION_TIMEOUT'&&error.cause?.name!=='AbortError');
 t.mock.timers.tick(20000);await checked;
});

test('an interrupted JSON body is not swallowed as an empty successful response',async()=>{
 environment(async()=>({ok:true,json:async()=>{throw new DOMException('signal is aborted without reason','AbortError');}}));
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>({}),getContext:()=>({getRequestHeaders:()=>({})}),isActive:()=>true,getSnapshot:()=>({settings:{}}),getGenerationOptions:()=>({options:{}})});
 await assert.rejects(client.check(),{code:'VERBA_SERVER_CONNECTION_INTERRUPTED'});
});

test('explicit user cancellation still cancels the accepted server job',async()=>{
 const controller=new AbortController();let accepted=0,cancelled=0;
 environment(async(url)=>{
  if(url.endsWith('/cancel')){cancelled++;return Response.json({state:'cancelled'});}
  if(url.endsWith('/jobs')){accepted++;controller.abort();return Response.json({state:'queued'});}
  throw Error('unexpected polling');
 });
 const settings={translationEngine:'google-free'};
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>settings,getContext:()=>({getRequestHeaders:()=>({})}),isActive:()=>true,getSnapshot:()=>({settings}),getGenerationOptions:()=>({options:{}})});
 await assert.rejects(client.run('output','Hello.',{signal:controller.signal}),{name:'AbortError'});
 assert.equal(accepted,1);assert.equal(cancelled,1);
});

test('Relay keeps original request ownership while observer translates without a second generation',async t=>{
 let delegated=0,translations=0;let finalPayload;
 const notification={protocol:1,translationEnabled:true,clientId:'tab',generationId:'reply'};
 globalThis.sillyPopNotifications={captureTranslation:()=>notification};
 t.after(()=>delete globalThis.sillyPopNotifications);
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async()=>{translations++;return{translation:'안녕.',sourceMap:[]};}})}},request:()=>{throw Error('must not generate twice');}});
 const storage=environment(async(url,init={})=>{
  const parsed=new URL(url,'http://localhost');const path=parsed.pathname;
  if(path.endsWith('/capabilities'))return Response.json({protocol:1,relayObserver:true,engines:{verba:{version:'0.6.51'}}});
  if(path==='/api/plugins/verba-server/jobs'){const input=JSON.parse(init.body);assert.deepEqual(input.notification,notification);return Response.json(jobs.status(jobs.start('alice',input,{})));}
  if(path.startsWith('/api/plugins/verba-server/jobs/'))return Response.json(jobs.status(jobs.lookup('alice',path.split('/').at(-1))));
  delegated++;
  const payload=JSON.parse(init.body);
  assert.deepEqual(payload,finalPayload,'the same final object remains identifiable by Relay');
  assert.match(payload.__verba_server_ticket,/^[a-f0-9]{32}$/);
  const body=Buffer.from(JSON.stringify({choices:[{message:{content:'Hello.'}}]}));
  jobs.observed('alice',payload.__verba_server_ticket,{state:'completed',status:200,type:'application/json',body});
  await jobs.lookup('alice',payload.__verba_server_ticket).done;
  return new Response(body,{headers:{'content-type':'application/json'}});
 });
 storage.set('silly-relay-enabled-v1','true');globalThis.sillyRelayReplies={apiVersion:1};
 t.after(()=>{delete globalThis.sillyRelayReplies;jobs.stopAll();});
 const handlers={};const settings={serverTranslation:true,autoOutput:true,profileId:'A'};
 const c={...profileContext(),chatId:'one',getRequestHeaders:()=>({}),eventTypes:{GENERATION_STARTED:'start',GENERATE_AFTER_DATA:'data',CHAT_COMPLETION_SETTINGS_READY:'settings'},eventSource:{on:(name,fn)=>handlers[name]=fn}};
 const client=createServerClient({variant:'verba',version:'0.6.51',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings:{...settings}}),getGenerationOptions:()=>({options:{}})});
 client.install();handlers.start('normal',{},false);const messages=[{role:'user',content:'Hi'}];handlers.data({prompt:messages});
 finalPayload={messages,type:'normal',stream:false};handlers.settings(finalPayload);
 const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(finalPayload)});
 assert.equal((await response.json()).choices[0].message.content,'Hello.');
 assert.equal((await client.output('Hello.',{},()=>{throw Error('unexpected local');})).translation,'안녕.');
 assert.equal(delegated,1);assert.equal(translations,1);
});
