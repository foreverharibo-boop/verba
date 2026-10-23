import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerClient} from '../../server-client.js';
test('diagnostics read notification disposition and server version without generating or exposing content',async()=>{
 const id='a'.repeat(32),context={chatId:'chat',characterId:2,name2:'PRIVATE_NAME',getRequestHeaders:()=>({})};
 const scope=JSON.stringify(['chat',2,'','PRIVATE_NAME']);
 const records=[{id,scope,kind:'used',notificationRequested:true}];
 globalThis.localStorage={getItem:()=>JSON.stringify(records),setItem(){}};
 globalThis.location={origin:'http://localhost',href:'http://localhost/'};
 let calls=0,reason='foreground';
 globalThis.fetch=async(url,init)=>{
  calls++;assert(!init.method||init.method==='GET');
  if(url.endsWith('/capabilities'))return Response.json({version:'0.1.3'});
  return Response.json({id,kind:'observed-generation',state:'completed',generationDone:true,source:'PRIVATE_SOURCE',error:'PRIVATE_PROVIDER_ERROR',result:{translation:'PRIVATE_TRANSLATION'},events:[{kind:'notification',code:reason,body:'PRIVATE_EXTRA'}]});
 };
 const settings={serverTranslation:true};
 const client=createServerClient({variant:'verba',version:'fixture',getSettings:()=>settings,getContext:()=>context,isActive:()=>true,getSnapshot(){throw Error('must not snapshot');}});
 await client.refreshDiagnostics();
 const result=client.diagnostics();assert.equal(result.serverVersion,'0.1.3');assert.equal(result.jobs[0].notificationRequested,true);
 assert.deepEqual(result.jobs[0].notificationResults,['foreground']);assert.equal(result.jobs[0].hasTranslation,true);
 assert(!JSON.stringify(result).includes('PRIVATE'));assert.equal(calls,2);
 reason='dispatched';await client.refreshDiagnostics();assert.deepEqual(client.diagnostics().jobs[0].notificationResults,['dispatched']);
 settings.serverTranslation=false;await client.refreshDiagnostics();assert.equal(calls,4);
});
