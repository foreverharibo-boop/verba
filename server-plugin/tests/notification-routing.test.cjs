const test=require('node:test');
const assert=require('node:assert/strict');
const {selectNotification,prepareSelected,routeGeneration}=require('../notification-routing.cjs');
const {createJobs}=require('../jobs.cjs');
test('all three notifiers coexist; account route snapshots only the selected target',async t=>{
 const names=['silly-relay.notification-routing.v1','silly-pop.translation-notifier','silly-pop.ios.translation-notifier.v1','silly-pop.and.translation-notifier.v1'];
 const previous=names.map(n=>globalThis[Symbol.for(n)]);t.after(()=>names.forEach((n,i)=>{if(previous[i])globalThis[Symbol.for(n)]=previous[i];else delete globalThis[Symbol.for(n)];}));
 let target='ios';const notices=[];
 globalThis[Symbol.for(names[0])]={apiVersion:1,get:owner=>owner==='alice'?target:'none'};
 for(const [index,kind] of ['apk','ios','and'].entries())globalThis[Symbol.for(names[index+1])]={apiVersion:1,prepare:(owner,marker)=>{assert.equal(marker.kind,kind);return()=>{notices.push(kind);return{reason:'dispatched'};};}};
 const notification={routing:true,candidates:Object.fromEntries(['apk','ios','and'].map(kind=>[kind,{kind,translationEnabled:true}]))};
 let finish;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({output:()=>new Promise(resolve=>finish=resolve)})}},prepareNotification:(owner,marker,selected)=>prepareSelected(owner,selected)});
 const job=jobs.start('alice',{id:'a'.repeat(32),kind:'output',source:'hello',snapshot:{variant:'verba',settings:{}},notification,options:{automatic:true,stage:'output-translation'}},{});
 target='and';finish({translation:'안녕'});await job.done;await job.notificationDone;
 assert.deepEqual(notices,['ios']);assert.equal(job.notificationTarget,'ios');
 for(const kind of ['apk','and','none','legacy']){target=kind;const selected=selectNotification('alice',notification);const notify=prepareSelected('alice',selected);if(notify)await notify();}
 assert.deepEqual(notices,['ios','apk','and','apk']);
 assert.equal(prepareSelected('bob',selectNotification('bob',notification)),null);
 target='ios';assert.equal(prepareSelected('alice',selectNotification('alice',{routing:true,candidates:{apk:{}}})),null,'never fall back to wrong target');
 const input={model:'custom-model',messages:[{role:'user',content:'preserved'}],silly_pop:{},silly_pop_ios:{},silly_pop_and:{}};
 const connection={headers:{cookie:'auth','x-silly-pop':'apk'}};
 const result=routeGeneration(connection,input,'ios',true);
 assert.equal(result.payload.model,'custom-model');assert.deepEqual(result.payload.messages,input.messages);
 assert.equal(result.payload.silly_pop_ios.translationPending,true);assert.equal(result.connection.headers['x-silly-pop'],undefined);
 assert.ok(input.silly_pop);assert.equal(connection.headers['x-silly-pop'],'apk','never mutate source settings');
});

test('selected iOS/AND defer notices but preserve normal arrival on skips and translation failure',async t=>{
 const symbol=Symbol.for('silly-relay.notification-routing.v1'),previous=globalThis[symbol];
 t.after(()=>{if(previous)globalThis[symbol]=previous;else delete globalThis[symbol];});
 for(const target of ['ios','and'])for(const outcome of ['skip','fail','success','http-fail']){
  globalThis[symbol]={apiVersion:1,get:()=>target};let arrivals=0,translations=0;
  const notice=()=>{translations++;return{reason:'dispatched'};};notice.replyReady=()=>{arrivals++;return{reason:'dispatched'};};
  const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>outcome!=='skip',output:async()=>{if(outcome==='fail')throw Error('fixture');return{translation:'번역'};}})}},
   prepareNotification:()=>notice,request:async()=>({status:outcome==='http-fail'?500:200,type:'application/json',body:Buffer.from(JSON.stringify({choices:[{message:{content:'Hello'}}]}))})});
  const job=jobs.start('alice',{id:'a'.repeat(32),kind:'generation',snapshot:{variant:'verba',settings:{}},generation:{path:'/generate',payload:{}},notification:{routing:true,candidates:{[target]:{translationEnabled:true}}}},{});
  await job.done;await job.notificationDone;
  assert.equal(arrivals,['skip','fail'].includes(outcome)?1:0,target+':'+outcome);
  assert.equal(translations,outcome==='success'?1:0);
 }
});
