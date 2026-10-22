const test=require('node:test');
const assert=require('node:assert/strict');
const {createJobs}=require('../jobs.cjs');
const {extractReply,fillTemplate,requestLocal,ownConnection}=require('../provider.cjs');
const http=require('node:http');
const snapshot={variant:'verba',settings:{},profiles:{}};
const id='a'.repeat(32);
test('generation completes AND translation starts with no browser polling',async()=>{
 let generationCalls=0,translationCalls=0;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{translationCalls++;return{translation:'안녕',sourceMap:[]};}})}},
 request:async(_c,_p,_b,o)=>{generationCalls++;const body=Buffer.from('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');o.onHeaders(200,'text/event-stream');o.onChunk(body);return{status:200,type:'text/event-stream',body};}});
 const envelope={id,kind:'generation',snapshot,generation:{path:'/api/backends/chat-completions/generate',payload:{stream:true}}};
 const job=jobs.start('alice',envelope,{});
 assert.equal(jobs.start('alice',envelope,{}),job);
 await job.done;
 assert.equal(generationCalls,1);assert.equal(translationCalls,1);assert.equal(job.state,'completed');
 assert.equal(jobs.status(job).result.translation,'안녕');assert.equal(job.source,'Hello');
 assert.throws(()=>jobs.lookup('bob',id),e=>e.status===404);
 assert.throws(()=>jobs.start('alice',{...envelope,options:{changed:true}},{}),e=>e.status===409);
});
test('cancel reaches original request and never starts translation',async()=>{
 let started=false;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:()=>{started=true;}})}},request:(_c,_p,_b,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancel'))))});
 const job=jobs.start('a',{id,kind:'generation',snapshot,generation:{path:'/api/backends/chat-completions/generate',payload:{}}},{});
 jobs.cancel('a',id);await job.done;assert.equal(job.state,'cancelled');assert.equal(started,false);
});
test('provider parsers isolate visible text and ignore thought deltas',()=>{
 assert.equal(extractReply(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'secret thinking'},{text:'hello'}]}}]}),'application/json'),'hello');
 assert.equal(extractReply('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n','text/event-stream'),'hi');
 assert.throws(()=>extractReply('{"choices":[{"message":{"tool_calls":[{}]}}]}','application/json'),e=>e.status===409);
 assert.deepEqual(fillTemplate({messages:[{content:'before MARK after'}],project:'saved'},'hello','MARK'),{messages:[{content:'before hello after'}],project:'saved'});
});
test('HTTP self-request survives disconnected observer and preserves authentication',async()=>{
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/begin') {
   const conn=ownConnection(req);
   res.end('accepted');
   const result=await requestLocal(conn,'/api/backends/chat-completions/generate',{test:true});
   finished(result);
  }else{
   assert.equal(req.headers.cookie,'session=example');
   let body='';for await(const part of req)body+=part;
   assert.deepEqual(JSON.parse(body),{test:true});res.setHeader('content-type','application/json');res.end('{"choices":[{"message":{"content":"Hello"}}]}');
  }
 });
 let finished;const done=new Promise(resolve=>finished=resolve);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  await fetch(`http://127.0.0.1:${server.address().port}/begin`,{headers:{cookie:'session=example'}});
  assert.equal(extractReply((await done).body,'application/json'),'Hello');
  await assert.rejects(requestLocal({},'https://attacker.invalid',{}),e=>e.status===400);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Relay completion observer starts translation without a second generation',async()=>{
 let generations=0,translations=0;
 const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{translations++;return{translation:'안녕',sourceMap:[]};}})}},request:()=>{generations++;}});
 const envelope={id,kind:'observed-generation',snapshot,generation:{prefix:''}};
 const job=jobs.start('alice',envelope,{});
 assert.equal(jobs.observed('bob',id,{state:'completed'}),false);
 const response={state:'completed',status:200,type:'application/json',body:Buffer.from('{"choices":[{"message":{"content":"Hello."}}]}')};
 assert.equal(jobs.observed('alice',id,response),true);
 assert.equal(jobs.observed('alice',id,response),false);
 await job.done;assert.equal(generations,0);assert.equal(translations,1);assert.equal(job.result.translation,'안녕');
});
test('Korean automatic reply is skipped; job identity and user limits remain bounded',async()=>{
 let calls=0;
 const jobs=createJobs({maxJobs:1,engines:{verba:{createEngine:()=>({shouldTranslate:()=>false,output:()=>{calls++;}})}},request:()=>{}});
 const j=jobs.start('a',{id,kind:'observed-generation',snapshot},{});
 jobs.observed('a',id,{state:'completed',status:200,type:'application/json',body:Buffer.from('{"choices":[{"message":{"content":"안녕."}}]}')});
 await j.done;assert.equal(calls,0);assert.equal(j.result.skipped,true);
 const newer=jobs.start('a',{id:'b'.repeat(32),kind:'observed-generation',snapshot},{});
 assert.throws(()=>jobs.lookup('a',id),e=>e.status===404);jobs.cancel('a',newer.id);await newer.done;
});

test('lifecycle timestamps prove translation completes before any browser status lookup',async()=>{
 for(const kind of ['generation','observed-generation']) {
  let clock=1000;const events=[];
  const response={state:'completed',status:200,type:'application/json',body:Buffer.from('{"choices":[{"message":{"content":"PRIVATE SOURCE"}}]}')};
  const jobs=createJobs({now:()=>clock,onLifecycle:event=>events.push(event),
   engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async()=>{clock=3000;return{translation:'PRIVATE RESULT'};}})}},
   request:async()=>{clock=2000;return response;}});
  const job=jobs.start('PRIVATE OWNER',{id,kind,snapshot,generation:{path:'/api/backends/chat-completions/generate',payload:{}}},{});
  if(kind==='observed-generation'){clock=2000;jobs.observed('PRIVATE OWNER',id,response);}
  await job.done;
  assert.deepEqual(events.map(e=>e.stage),['accepted','translation_started','completed']);
  assert.deepEqual(events.map(e=>e.at),[1000,2000,3000]);
  assert.equal(events.at(-1).elapsedMs,2000);assert.doesNotMatch(JSON.stringify(events),/PRIVATE/);
  clock=9000;assert.equal(jobs.status(job).state,'completed');assert.equal(events.at(-1).at,3000);
 }
});
test('a broken diagnostic sink cannot fail a successful translation',async()=>{
 const jobs=createJobs({onLifecycle:()=>{throw Error('broken log');},engines:{verba:{createEngine:()=>({output:async()=>({translation:'ok'})})}}});
 const job=jobs.start('a',{id,kind:'output',snapshot,source:'hello'},{});await job.done;assert.equal(job.state,'completed');
});


test('both server generation routes translate after excluding a verified Ttotto report', async () => {
    const report='<scene_state>{"_v":2,"scene":{"location":"room"},"heat":8}</scene_state>';
    const original='A narrative paragraph.\n\n'+report+'\n\n<Info_panel>Preserve</Info_panel>';
    const expected='A narrative paragraph.\n\n\n\n<Info_panel>Preserve</Info_panel>';
    for(const kind of ['generation','observed-generation']) {
        let translated = '', generationRequests = 0, notices = 0;
        const response={state:'completed',status:200,type:'application/json',
            body:Buffer.from(JSON.stringify({choices:[{message:{content:original}}]}))};
        const jobs=createJobs({
            engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async source=>{
                translated=source;return{translation:'한국어 결과',sourceMap:[]};
            }})}},
            request:async()=>{generationRequests++;return response;},
            prepareNotification:()=>async()=>{notices++;return{reason:'dispatched'};},
        });
        const jobId=kind==='generation'?'c'.repeat(32):'d'.repeat(32);
        const job=jobs.start('alice',{id:jobId,kind,snapshot,
            generation:{path:'/api/backends/chat-completions/generate',payload:{}},
            notification:{translationEnabled:true}}, {});
        if(kind==='observed-generation')assert.equal(jobs.observed('alice',jobId,response),true);
        await job.done;await job.notificationDone;
        assert.equal(translated,expected);
        assert.equal(job.source,expected);
        assert.equal(job.result.translation,'한국어 결과');
        assert.equal(job.state,'completed');
        assert.equal(notices,1);
        assert.equal(generationRequests,kind==='generation'?1:0);
        assert.ok(job.events.some(event=>event.code==='scene-report-excluded'));
        assert.equal(extractReply(response.body,'application/json'),original,
            'original generation reply must remain intact for Ttotto scene collection');
    }
});
