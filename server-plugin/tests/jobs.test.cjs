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
