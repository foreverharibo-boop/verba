import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { captureConnectionProfiles } from '../../server-client.js';
import { sendProfile } from '../provider.cjs';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';

for (const [name,create] of [['verba',verba],['deep',deep]]) {
 for (const tokens of [undefined,32000]) test(`${name}: configured budget reaches the first and second actual server payloads (${tokens ?? 'default'})`, async t => {
    const payloads=[];
    const server=http.createServer(async(req,res)=>{
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks));payloads.push(body);
        const prompt=body.messages[0].content;
        const rows=JSON.parse(prompt.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:'그녀는 기다렸다.'}))})}}]}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
    const service={sendRequest(){throw Error('profile capture must never call an AI');}};
    const context={ChatCompletionService:service,ConnectionManagerRequestService:{sendRequest:(_id,messages,maxTokens)=>service.sendRequest({messages,max_tokens:maxTokens,model:'fixture'})}};
    const profiles=await captureConnectionProfiles(context,['A'],tokens);
    const connection={address:'127.0.0.1',port:server.address().port,headers:{}};
    const snapshot={settings:{profileId:'A',maxTokens:tokens,autoProfileFallback:false,serverRetryLimit:1,developerMode:true,developerDeepseekKoreanEnabled:true,developerSecondTranslationEnabled:true,aiPostReview:{}},profiles,context:{},nameLocks:[],character:{}};
    const engine=create(snapshot,(...args)=>sendProfile(connection,profiles,...args));
    const out=await engine.output('She waited.');
    assert.equal(out.translation,'그녀는 기다렸다.');assert.equal(payloads.length,2);
    assert.ok(payloads[1].messages[0].content.startsWith('SECOND TRANSLATION'));
    assert.deepEqual(payloads.map(p=>p.max_tokens),[tokens??15000,tokens??15000]);
    assert.equal(profiles.A.payload.max_tokens,tokens??15000,'template remains unchanged');
 });
}
test('server transport applies per-request tokens to native completion fields without mutating templates',async t=>{
 let received;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received=JSON.parse(Buffer.concat(chunks));res.end(JSON.stringify({choices:[{message:{content:'true'}}]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const connection={address:'127.0.0.1',port:server.address().port,headers:{}};
 for(const key of ['max_tokens','max_completion_tokens','max_new_tokens','n_predict','num_predict','max_length']){
    const profiles={A:{marker:'VERBA_CAPTURE_TEST',path:'/api/backends/chat-completions/generate',payload:{messages:[{role:'user',content:'VERBA_CAPTURE_TEST'}],[key]:32000,temperature:0.75,model:'fixture'}}};
    await sendProfile(connection,profiles,'A',[{role:'user',content:'check'}],512);
    assert.equal(received[key],512);assert.equal(received.temperature,0.75);assert.equal(profiles.A.payload[key],32000);
 }
});
