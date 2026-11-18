import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
import { createJobs } from '../jobs.cjs';
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const snapshot = race => ({ settings: { profileId:'a', fallbackProfileId:'b', autoProfileFallback:race,
    profileRaceEnabled:race, profileRaceStaggerSeconds:5, timeoutSeconds:1, profileRaceTimeoutMinutes:0.001,
    serverRetryLimit:1 }, profiles:{a:{},b:{}},context:{},nameLocks:[],character:{} });
for (const [name, create] of [['verba',verba],['deep',deep]]) {
    for (const race of [false,true]) test(`${name} server ${race ? 'race' : 'single'} ignores all legacy deadlines`, async t => {
        t.mock.timers.enable({apis:['setTimeout','Date']});
        const calls=[];
        const engine=create(snapshot(race), (id,_messages,_tokens,options)=>new Promise(resolve=>calls.push({id,signal:options.signal,resolve})));
        let settled=false;const pending=engine.request('fixture').finally(()=>{settled=true;});
        await flush();assert.equal(calls.length,1);
        t.mock.timers.tick(5000);await flush();assert.equal(calls.length,race?2:1);
        t.mock.timers.tick(3*60*60*1000);await flush();
        assert.equal(settled,false);assert.ok(calls.every(c=>!c.signal.aborted));
        calls.at(-1).resolve({content:'완료'});assert.equal((await pending).content,'완료');
        if(race)assert.equal(calls[0].signal.aborted,true,'race loser is cancelled after a winner');
    });
    test(`${name} server manual cancel settles a provider that ignores abort`, async()=>{
        const engine=create(snapshot(false),()=>new Promise(()=>{}));
        const controller=new AbortController();const pending=engine.request('fixture',{signal:controller.signal});
        await flush();controller.abort();await assert.rejects(pending,{name:'AbortError'});
    });
}
test('server generation survives the old 20-minute deadline and then translates',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    let release,signal,translated=0;
    const jobs=createJobs({engines:{verba:{createEngine:()=>({shouldTranslate:()=>true,output:async()=>{translated++;return {translation:'안녕'};}})}},request:(_c,_p,_body,options)=>{
        signal=options.signal;return new Promise(resolve=>{release=resolve;});
    }});t.after(()=>jobs.stopAll());
    const job=jobs.start('a',{id:'a'.repeat(32),kind:'generation',snapshot:{variant:'verba',settings:{},profiles:{}},generation:{path:'/api/backends/chat-completions/generate',payload:{}}},{});
    await flush();t.mock.timers.tick(3600000);await flush();assert.equal(signal.aborted,false);assert.equal(job.state,'generating');
    release({status:200,type:'application/json',body:Buffer.from(JSON.stringify({choices:[{message:{content:'Hello'}}]}))});
    await job.done;assert.equal(job.state,'completed');assert.equal(translated,1);
});
