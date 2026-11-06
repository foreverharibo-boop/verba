import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
import { sendProfile } from '../provider.cjs';
import { createJobs } from '../jobs.cjs';
import { cleanSecondTranslationDiagnostic } from '../../second-translation-diagnostics.js';
import { createServerClient } from '../../server-client.js';

const source='He stood at the old library window and waited for the rain to stop. People with umbrellas walked slowly along the lane across the street. A letter lay unanswered on his desk. He unfolded it and read the last sentence again as the evening shadows grew longer.';
const draft='그는 오래된 도서관의 창문 앞에 서서 비가 그치기를 기다렸다. 건너편 골목에는 우산을 든 사람들이 천천히 지나가고 있었으며 책상 위에 놓인 편지에는 아직 답장을 쓰지 못한 채였다. 그는 종이를 다시 펼쳐 마지막 문장을 읽었다. 저녁이 가까워지자 실내의 그림자가 조금씩 길어졌다.';
const edited='비가 그치기를 기다리며 그는 오래된 도서관 창가에 서 있었다. 길 건너 골목으로 우산을 쓴 사람들이 천천히 지나갔다. 책상에 놓인 편지에는 아직 답하지 못했다. 그는 편지를 펼쳐 마지막 문장을 다시 읽었다. 어느새 저녁이 가까워져 실내에 드리운 그림자가 조금씩 길어지고 있었다.';
const snapshot=debugMode=>({settings:{developerDeepseekKoreanEnabled:true,developerSecondTranslationEnabled:true,profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode,aiPostReview:{}},profiles:{A:{}},nameLocks:[],character:{},context:{}});
const rows=p=>JSON.parse(p.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
for(const [name,create] of [['verba',verba],['deep',deep]]){
    for(const debug of [false,true])test(`${name}: complete three-step run, raw trace opt-in, final assembly uses extra edit (${debug})`,async()=>{
        const events=[],calls=[];
        const engine=create(snapshot(debug),async(id,messages,max,options)=>{
            const p=messages[0].content;calls.push(p);
            const second=p.startsWith('SECOND TRANSLATION');
            assert.equal(typeof options.onDiagnostic==='function',debug&&second);
            options.onDiagnostic?.({boundary:'server-http-request',payload:{model:'test-model',system:'PROFILE_SYSTEM',messages,api_key:'private-fixture-key'}});
            const text=JSON.stringify({segments:rows(p).map(row=>({id:row.id,translation:p.startsWith('SECOND TRANSLATION REEDIT')?edited:draft}))});
            options.onDiagnostic?.({boundary:'server-http-response',status:200,body:{choices:[{message:{content:text}}]}});
            return {content:text};
        },event=>events.push(event));
        const out=await engine.output(source,{diagnosticMessageId:7,diagnosticSwipeId:1});
        assert.equal(calls.length,3);assert.equal(out.translation,edited);
        const captures=events.filter(e=>e.kind==='second-translation-trace');
        if(!debug){assert.equal(captures.length,0);assert.equal(out.secondTranslationTrace,undefined);return;}
        assert.ok(captures.length>4);
        const trace=out.secondTranslationTrace;
        assert.deepEqual(trace,captures.at(-1).record);
        assert.equal(trace.binding.messageId,7);assert.equal(trace.binding.swipeId,1);
        assert.deepEqual(trace.outcome.summary,{reeditPasses:1,targetCount:1,acceptedCount:1,retainedCount:0});
        const wire=trace.events.filter(e=>e.kind==='transport');
        assert.equal(wire.filter(e=>e.data.boundary==='connection-manager-input').length,2);
        assert.equal(wire.filter(e=>e.data.boundary==='assistant-text-before-segment-parser').length,2);
        assert.ok(JSON.stringify(trace).includes('PROFILE_SYSTEM'));assert.ok(!JSON.stringify(trace).includes('private-fixture-key'));
        assert.equal(trace.events.find(e=>e.kind==='second-result').data.segments[0].translation,draft);
        assert.equal(trace.events.find(e=>e.kind==='final-result').data.segments[0].translation,edited);
        const timing=events.findLast(e=>e.kind==='output-timing').record;
        assert.ok(timing.rows.some(r=>r.label==='미수정 서술 추가 편집'));
    });
    test(`${name}: cancellation during optional editing retains trace but never publishes a result`,async()=>{
        const controller=new AbortController(),events=[];let calls=0;
        const engine=create(snapshot(true),async(id,messages)=>{
            const p=messages[0].content;calls++;
            if(p.startsWith('SECOND TRANSLATION REEDIT'))controller.abort();
            return {content:JSON.stringify({segments:rows(p).map(r=>({id:r.id,translation:draft}))})};
        },e=>events.push(e));
        await assert.rejects(engine.output(source,{signal:controller.signal}),{name:'AbortError'});
        assert.equal(calls,3);assert.equal(events.findLast(e=>e.kind==='second-translation-trace').record.outcome.kind,'cancelled');
    });
}

test('provider trace captures profile-substituted text and unparsed response without profile secrets',async t=>{
    let actual;
    const server=http.createServer(async(req,res)=>{
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        actual=JSON.parse(Buffer.concat(chunks).toString());
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({choices:[{message:{content:'RAW_NOT_SEGMENT_JSON'}}],api_key:'response-secret'}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
    const connection={address:'127.0.0.1',port:server.address().port,headers:{authorization:'Bearer request-secret'}};
    const profiles={A:{path:'/api/backends/chat-completions/generate',marker:'VERBA_CAPTURE_TEST',payload:{model:'fixture',messages:[{role:'system',content:'PROFILE_CONTEXT'},{role:'user',content:'PREFIX VERBA_CAPTURE_TEST SUFFIX'}],api_key:'payload-secret',reverse_proxy:'https://private.example',stream:true}}};
    const events=[];
    const response=await sendProfile(connection,profiles,'A',[{role:'user',content:'ACTUAL_PROMPT'}],100,{onDiagnostic:e=>events.push(cleanSecondTranslationDiagnostic(e))});
    assert.equal(response.content,'RAW_NOT_SEGMENT_JSON');assert.equal(actual.stream,false);
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].payload.messages)),actual.messages);
    assert.equal(events[0].payload.model,'fixture');assert.ok(JSON.stringify(events).includes('RAW_NOT_SEGMENT_JSON'));
    for(const secret of ['request-secret','response-secret','payload-secret','private.example'])assert.ok(!JSON.stringify(events).includes(secret));
    // Diagnostic callback errors cannot fail a successful provider request.
    assert.equal((await sendProfile(connection,profiles,'A',[{role:'user',content:'next'}],100,{onDiagnostic(){throw Error('log failure');}})).content,'RAW_NOT_SEGMENT_JSON');
});

test('job events coalesce full trace snapshots and retain latest revision for reconnect',async()=>{
    const record={version:1,capturedAt:'2026-11-06',revision:0,events:[]};
    const jobs=createJobs({engines:{verba:{createEngine:(_snapshot,_transport,report)=>({output:async()=>{
        for(let i=1;i<=5;i++)report({kind:'second-translation-trace',record:{...record,revision:i}});
        return {translation:'done',secondTranslationTrace:{...record,revision:5}};
    }})}},request:async()=>{},profileRequest:async()=>{}});
    const job=jobs.start('owner',{id:'f'.repeat(32),kind:'output',snapshot:{variant:'verba',settings:{}},source:'source'},{});
    await job.done;
    const traceEvents=job.events.filter(e=>e.kind==='second-translation-trace');
    assert.equal(traceEvents.length,1);assert.equal(traceEvents[0].record.revision,5);
    assert.ok(traceEvents[0].seq>=4);
});

test('manual log refresh recovers the text trace read-only after page reload, only when debugging',async()=>{
    const id='a'.repeat(32),context={chatId:'chat',characterId:2,name2:'N',getRequestHeaders:()=>({})};
    const scope=JSON.stringify(['chat',2,'','N']);
    globalThis.localStorage={getItem:()=>JSON.stringify([{id,scope,kind:'used'}]),setItem(){}};
    globalThis.location={origin:'http://localhost',href:'http://localhost/'};
    const trace={version:1,capturedAt:'2026-11-06',revision:2,events:[]};let calls=0;
    globalThis.fetch=async(url,init)=>{
        calls++;assert.ok(!init.method||init.method==='GET');
        return Response.json(url.endsWith('/capabilities')?{version:'0.1.70'}:{id,state:'completed',result:{secondTranslationTrace:trace},events:[{kind:'second-translation-trace',record:trace},{kind:'notice',message:'must not replay'}]});
    };
    const settings={serverTranslation:true,debugMode:false},progress=[];
    const client=createServerClient({variant:'verba',version:'fixture',getSettings:()=>settings,getContext:()=>context,isActive:()=>true,getSnapshot(){throw Error('no writes');},onProgress:e=>progress.push(e)});
    await client.refreshDiagnostics();assert.equal(progress.length,0);
    settings.debugMode=true;await client.refreshDiagnostics();assert.equal(progress.length,1);
    assert.deepEqual(progress[0].result.secondTranslationTrace,trace);assert.equal(progress[0].events.length,1);assert.equal(calls,4);
});
