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
 const client=createServerClient({variant:'verba',version:'0.6.50',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings}),getGenerationOptions:()=>({options:{}})});
 assert.equal(await client.output('Hello.',{},async()=>'local'),'local');assert.equal(calls,0);
 settings.serverTranslation=true;
 assert.equal(await client.output('Hello.',{},async()=>'local'),'local');assert.equal(calls,1);
});
test('server completes before a browser reads its response; exact output reuses one job',async()=>{
 let generations=0,translations=0;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{translations++;return{translation:'안녕.',sourceMap:[]};}})}},request:async(_c,_p,p,o)=>{
  generations++;const body=Buffer.from(JSON.stringify({choices:[{message:{content:'Hello.'}}]}));o.onHeaders(200,'application/json');o.onChunk(body);return{status:200,type:'application/json',body};
 }});
 let nativeCalls=0;
 environment(async(url,init={})=>{
  const path=new URL(url,'http://localhost').pathname;
  if(path.endsWith('/capabilities'))return Response.json({protocol:1,engines:{verba:{version:'0.6.50'}}});
  if(path==='/api/plugins/verba-server/jobs')return Response.json(jobs.status(jobs.start('a',JSON.parse(init.body),{})));
  if(path.startsWith('/api/plugins/verba-server/jobs/')){const id=path.split('/').at(-1);return Response.json(jobs.status(jobs.lookup('a',id),new URL(url,'http://localhost').searchParams.get('cursor')));}
  nativeCalls++;return Response.json({});
 });
 const handlers={};const settings={serverTranslation:true,autoOutput:true,profileId:'A'};
 const c={...profileContext(),chatId:'one',characterId:0,name2:'Chris',getRequestHeaders:()=>({}),eventTypes:{GENERATION_STARTED:'start',GENERATE_AFTER_DATA:'data',CHAT_COMPLETION_SETTINGS_READY:'settings',GENERATION_ENDED:'end'},eventSource:{on:(n,fn)=>handlers[n]=fn}};
 const client=createServerClient({variant:'verba',version:'0.6.50',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings:{...settings},nameLocks:[],context:{},character:{}}),getGenerationOptions:()=>({options:{}})});
 client.install();handlers.start('normal',{},false);
 const messages=[{role:'user',content:'Hi'}];handlers.data({prompt:messages});const payload={messages,type:'normal',stream:false};handlers.settings(payload);
 const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(payload)});
 assert.equal(generations,1);assert.equal(translations,1);assert.equal(nativeCalls,0);
 assert.equal((await response.json()).choices[0].message.content,'Hello.');
 const result=await client.output('Hello.',{stage:'output-translation'},()=>{throw Error('unexpected local');});
 assert.equal(result.translation,'안녕.');assert.equal(translations,1);
 // Explicit retranslation never reuses the auto-generation result.
 await client.output('Hello.',{stage:'output-retranslation'},()=>{});assert.equal(translations,2);
});

test('Relay keeps original request ownership while observer translates without a second generation',async t=>{
 let delegated=0,translations=0;let finalPayload;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async()=>{translations++;return{translation:'안녕.',sourceMap:[]};}})}},request:()=>{throw Error('must not generate twice');}});
 const storage=environment(async(url,init={})=>{
  const parsed=new URL(url,'http://localhost');const path=parsed.pathname;
  if(path.endsWith('/capabilities'))return Response.json({protocol:1,relayObserver:true,engines:{verba:{version:'0.6.50'}}});
  if(path==='/api/plugins/verba-server/jobs')return Response.json(jobs.status(jobs.start('alice',JSON.parse(init.body),{})));
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
 const client=createServerClient({variant:'verba',version:'0.6.50',getSettings:()=>settings,getContext:()=>c,isActive:()=>true,getSnapshot:()=>({settings:{...settings}}),getGenerationOptions:()=>({options:{}})});
 client.install();handlers.start('normal',{},false);const messages=[{role:'user',content:'Hi'}];handlers.data({prompt:messages});
 finalPayload={messages,type:'normal',stream:false};handlers.settings(finalPayload);
 const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(finalPayload)});
 assert.equal((await response.json()).choices[0].message.content,'Hello.');
 assert.equal((await client.output('Hello.',{},()=>{throw Error('unexpected local');})).translation,'안녕.');
 assert.equal(delegated,1);assert.equal(translations,1);
});
