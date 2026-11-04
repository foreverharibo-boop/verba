import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real client and HTTP/lifecycle paths with a deterministic clock.
const source=fs.readFileSync(new URL('../server-client.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const id='a'.repeat(32), secondId='b'.repeat(32);
const key='verba-server-jobs:test';
const storedRow=(jobId=id)=>({id:jobId,scope:'another-chat',kind:'generation',cancel:true,at:1});
function harness({rows=[storedRow()],storage=new Map(),responses=[],enabled=true,active=true,online=true}={}){
    if(!storage.has(key))storage.set(key,JSON.stringify(rows));
    let now=1000000,serial=0;const timers=new Map(),events=new Map(),calls=[],notices=[];
    const settings={serverTranslation:enabled};
    const navigator={onLine:online};
    const date=class extends Date{static now(){return now;}};
    const listen=(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);};
    const sandbox={Date:date,AbortController,DOMException,URL,Request,Response,console,
        installVertexModelCompatibility:()=>{},
        localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
        navigator,window:{addEventListener:listen},document:{hidden:false,addEventListener:listen},
        setTimeout:(fn,ms)=>{const handle=++serial;timers.set(handle,{fn,at:now+ms});return handle;},
        clearTimeout:handle=>timers.delete(handle),
        fetch:async(url,init)=>{
            calls.push({url,init,at:now});
            let result=responses.shift()??{status:200};
            if(typeof result==='function')result=await result();
            if(result.error)throw Object.assign(new Error('test failure'),result.error);
            return {ok:result.status>=200&&result.status<300,status:result.status,
                headers:{get:name=>name==='retry-after'?result.retryAfter??null:null},
                json:async()=>{if(result.badJson)throw new SyntaxError('bad JSON');return result.body??{};}};
        },
    };
    vm.createContext(sandbox);vm.runInContext(source,sandbox);
    const client=sandbox.createServerClient({variant:'test',version:'1',getSettings:()=>settings,
        getContext:()=>({chatId:'current',getRequestHeaders:()=>({})}),isActive:()=>active,
        getSnapshot:()=>({settings:{}}),onNotice:text=>notices.push(text)});
    const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
    const emit=async name=>{for(const fn of events.get(name)||[])fn();await settle();};
    const tick=async ms=>{
        const end=now+ms;
        for(let count=0;;count++){
            assert.ok(count<200,'timer loop');
            const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
            if(!entry)break;
            now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await settle();
        }
        now=end;await settle();
    };
    return {client,settings,navigator,calls,notices,storage,timers,settle,emit,tick,
        records:()=>JSON.parse(storage.get(key)),setActive:value=>{active=value;}};
}

test('permanent failures stop across resume, repeated cancel and reload without claiming success',async()=>{
    for(const status of [400,401,403,404,408,422,501]){
        const h=harness({responses:[{status}]});h.client.install();await h.settle();
        assert.equal(h.calls.length,1);assert.equal(h.records()[0].cancelState,'blocked');
        assert.equal(h.records()[0].cancel,true);assert.equal(h.records()[0].cancelHttpStatus,status);
        assert.equal(h.notices.length,1);assert.match(h.notices[0],/자동 재시도를 멈췄습니다/);
        await h.emit('pageshow');await h.emit('online');await h.emit('visibilitychange');
        await h.client.cancel(id);await h.tick(120000);assert.equal(h.calls.length,1);
        const reloaded=harness({storage:h.storage});reloaded.client.install();await reloaded.settle();
        assert.equal(reloaded.calls.length,0);assert.equal(reloaded.notices.length,0);
        const diagnostic=reloaded.client.diagnostics();
        assert.equal(diagnostic.cancellations[0].state,'blocked');
        assert.equal(diagnostic.cancellations[0].httpStatus,status);
        assert.equal(diagnostic.cancellations[0].jobId,'aaaaaaaa');
    }
});

test('429 retries honor Retry-After and lifecycle events cannot bypass the wait',async()=>{
    for(const retryAfter of ['30',new Date(1030000).toUTCString()]){
        const h=harness({responses:[{status:429,retryAfter},{status:429,retryAfter:'60'},{status:200}]});
        h.client.install();await h.settle();await h.tick(29999);await h.emit('online');await h.emit('pageshow');
        assert.equal(h.calls.length,1);await h.tick(1);assert.equal(h.calls.length,2);
        assert.equal(h.notices.length,1);await h.tick(59999);assert.equal(h.calls.length,2);
        await h.tick(1);assert.equal(h.calls.length,3);assert.equal(h.records()[0].cancelState,'sent');
        assert.equal(h.records()[0].cancel,false);assert.equal(h.timers.size,0);
        await h.client.cancel(id);assert.equal(h.calls.length,3);
    }
});

test('only transient HTTP/connection failures retry with backoff',async()=>{
    for(const response of [500,502,503,504].map(status=>({status})).concat([
        {error:{name:'TypeError'}},
        {error:{code:'VERBA_SERVER_CONNECTION_TIMEOUT'}},
        {error:{code:'VERBA_SERVER_CONNECTION_INTERRUPTED'}},
        {status:200,badJson:true},
    ])){
        const h=harness({responses:[response,{status:200}]});h.client.install();await h.settle();
        assert.equal(h.calls.length,1);await h.tick(2999);assert.equal(h.calls.length,1);
        await h.tick(1);assert.equal(h.calls.length,2);assert.equal(h.records()[0].cancelState,'sent');
    }
    const h=harness({responses:[{error:{name:'Error'}}]});h.client.install();await h.settle();
    assert.equal(h.records()[0].cancelState,'blocked');await h.tick(60000);assert.equal(h.calls.length,1);
});

test('reload retains cooldown and warning suppression for a pending cancellation',async()=>{
    const h=harness({responses:[{status:429,retryAfter:'30'}]});h.client.install();await h.settle();
    const reloaded=harness({storage:h.storage,responses:[{status:503},{status:200}]});
    reloaded.client.install();await reloaded.settle();assert.equal(reloaded.calls.length,0);
    await reloaded.tick(30000);assert.equal(reloaded.calls.length,1);assert.equal(reloaded.notices.length,0);
    await reloaded.tick(6000);assert.equal(reloaded.records()[0].cancelState,'sent');
});

test('OFF, inactive and offline do not automatically send saved cancellations',async()=>{
    for(const option of [{enabled:false},{active:false},{online:false}]){
        const h=harness({...option,responses:[{status:503},{status:200}]});h.client.install();await h.settle();
        await h.emit('pageshow');await h.emit('online');await h.tick(60000);assert.equal(h.calls.length,0);
        h.settings.serverTranslation=true;h.setActive(true);h.navigator.onLine=true;
        await h.emit('online');assert.equal(h.calls.length,1);
        h.settings.serverTranslation=false;await h.tick(3000);assert.equal(h.calls.length,1);
        h.settings.serverTranslation=true;await h.emit('pageshow');assert.equal(h.calls.length,2);
    }
});

test('in-flight cancellation is shared across abort handlers and resume events',async()=>{
    let release;const response=new Promise(resolve=>{release=resolve;});
    const h=harness({responses:[()=>response]});h.client.install();await h.settle();
    const a=h.client.cancel(id),b=h.client.cancel(id);assert.equal(a,b);
    await h.emit('pageshow');await h.emit('visibilitychange');await h.emit('online');assert.equal(h.calls.length,1);
    release({status:200});await a;assert.equal(h.records()[0].cancelState,'sent');assert.equal(h.notices.length,0);
});

test('timeout retries rather than claiming user cancellation; different jobs stay independent',async()=>{
    const h=harness({rows:[storedRow(),storedRow(secondId)],responses:[()=>new Promise(()=>{}),{status:404},{status:200}]});
    h.client.install();await h.settle();assert.equal(h.calls.length,2);
    await h.tick(20000);assert.equal(h.records()[0].cancelState,'pending');
    assert.equal(h.records()[1].cancelState,'blocked');
    await h.tick(3000);assert.equal(h.records()[0].cancelState,'sent');assert.equal(h.calls.length,3);
});
