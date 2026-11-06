import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '../../server-client.js';
import { createJobs } from '../jobs.cjs';
import * as verba from '../engines/verba.mjs';
import * as deep from '../engines/verba-deep.mjs';
import { createOutputTiming, outputTimingText } from '../../timing.js';

for (const [variant,engine,makeClient] of [['verba',verba,createServerClient],['verba-deep',deep,createServerClient]]) {
    for (const second of [false,true]) test(`${variant}: real engine -> jobs -> client -> timing report, second=${second}`, async t => {
        const settings={serverTranslation:true,debugMode:true,profileId:'A',activeProfileSlot:'A',serverRetryLimit:1,developerDeepseekKoreanEnabled:true,developerSecondTranslationEnabled:second,aiPostReview:{}};
        let calls=0,admitted;
        const jobs=createJobs({engines:{[variant]:engine},versions:{[variant]:{version:'fixture'}},profileRequest:async (_connection,_profiles,_id,messages)=>{
            calls++;
            await new Promise(resolve=>setTimeout(resolve,10));
            const p=messages[0].content;
            if(p.startsWith('SECOND TRANSLATION')) assert.match(p,/보조 자료/);
            const rows=JSON.parse(p.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
            return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:'그는 기다렸다.'}))})};
        }});
        t.after(()=>jobs.stopAll());
        const storage=new Map();
        globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
        globalThis.location={origin:'http://localhost',href:'http://localhost/'};
        globalThis.window={addEventListener(){}};globalThis.document={hidden:false,addEventListener(){}};
        const cc={async sendRequest(){throw Error('capture must not send to provider');}};
        const context={chatId:'one',getRequestHeaders:()=>({}),ChatCompletionService:cc,
            ConnectionManagerRequestService:{sendRequest:async(_id,messages)=>cc.sendRequest({messages,model:'fixture'})}};
        globalThis.fetch=async(url,init={})=>{
            const path=new URL(url,location.href).pathname;
            if(path.endsWith('/capabilities'))return Response.json({protocol:1,engines:{[variant]:{version:'fixture'}}});
            if(path.endsWith('/jobs')){
                admitted=jobs.start('alice',JSON.parse(init.body),{});
                await admitted.done;
                return Response.json(jobs.status(admitted));
            }
            if(path.includes('/jobs/'))return Response.json(jobs.status(jobs.lookup('alice',path.split('/').at(-1))));
            throw Error('unexpected URL');
        };
        const clock=createOutputTiming();clock.setEnabled(true);const job=clock.begin();
        const client=makeClient({variant,version:'fixture',getSettings:()=>settings,getContext:()=>context,isActive:()=>true,
            getSnapshot:()=>({settings,nameLocks:[],character:{},context:{}}),
            onTiming:(record,options,reused)=>clock.attachServer(options.timing,record,reused)});
        const out=await client.output('He waited.',{timing:job,stage:'output-retranslation'},()=>assert.fail('local fallback'));
        clock.finish(job,'완료');
        assert.equal(out.translation,'그는 기다렸다.');assert.equal(calls,second?2:1);
        const server=clock.latest().server.record;
        assert.ok(server.durations.primary>0);assert.equal(server.counts.total,calls);
        assert.equal(server.durations.secondary>0,second);
        const text=outputTimingText(clock.latest());
        assert.match(text,/서버 실행 기록/);assert.ok(text.includes(`AI 요청: ${calls}회`));
        assert.equal(text.includes('2차 번역 응답 대기: 0.0초 · 실행 기록 없음'),!second);
        assert.doesNotMatch(JSON.stringify(admitted.events.filter(e=>e.kind==='output-timing')),/He waited|그는 기다렸다/);
    });
}
