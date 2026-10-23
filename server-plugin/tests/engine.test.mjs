import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as verba} from '../engines/verba.mjs';
import {createEngine as deep} from '../engines/verba-deep.mjs';
const snapshot = settings => ({settings:{profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,
    developerMinimalPromptEnabled:true,developerMode:true,developerMinimalPrompt:'Translate to Korean.',...settings},
    profiles:{A:{}},nameLocks:[{source:'Dana',target:'다나'}],character:{name:'Chris'},context:{name1:'Dana',name2:'Chris'}});
for(const [name,createEngine] of [['verba',verba],['deep',deep]]) {
    test(name+' runs actual original minimal output and input engines without DOM',async()=>{
        let calls=0;
        const engine=createEngine(snapshot(),async(id,messages)=>{
            calls++;assert.equal(id,'A');assert.ok(messages[0].content);
            return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'다나는 미소를 지었다.'}]})};
        });
        const output=await engine.output('Dana smiled.',{speakerIdentity:{userName:'다나',sourceUserName:'Dana',characterName:'Chris'}});
        assert.ok(output.translation.includes('다나'));assert.ok(!output.translation.includes('@@'));assert.ok(calls>=1);
        const input=createEngine(snapshot(),async()=>({content:JSON.stringify({segments:[{id:'seg_0000',translation:'Hello.'}]})}));
        assert.equal(await input.input('안녕.'),'Hello.');
    });
    test(name+' retains malformed JSON recovery and completed segments',async()=>{
        let calls=0;
        const engine=createEngine(snapshot(),async()=>({content:JSON.stringify({segments:++calls===1?[{id:'a',translation:'하나'}]:[{id:'b',translation:'둘'}]})}));
        const result=await engine.segments('Translate.',[{id:'a',type:'narration',text:'One.'},{id:'b',type:'narration',text:'Two.'}],{stage:'output-translation'});
        assert.deepEqual([...result],[['a','하나'],['b','둘']]);assert.equal(calls,2);
    });
    test(name+' preserves permanent error stop and explicit cancellation',async()=>{
        let calls=0;const engine=createEngine(snapshot(),async()=>{calls++;throw Error('HTTP 401 unauthorized');});
        await assert.rejects(engine.request('hello'),/401/);assert.equal(calls,1);
        const ctl=new AbortController();ctl.abort();await assert.rejects(engine.output('Hello.',{signal:ctl.signal}),/취소|abort/i);
    });
}
for(const [name,createEngine] of [['verba',verba],['deep',deep]]) {
 test(name+' full pipeline retains name tokens, bilingual English source and protected code',async()=>{
  const prompts=[];
  const settings={developerMinimalPromptEnabled:false,developerMode:false,allDialoguePromptEnabled:true,allDialoguePrompt:'[BILINGUAL DIALOGUE FORMAT] For dialogue only, always output both the original English dialogue and its Korean translation. The English dialogue must appear first, immediately followed by its Korean translation inside parentheses.',dialogueEndingRepetitionReduction:false};
  const engine=createEngine(snapshot(settings),async(_id,messages)=>{
   const prompt=messages[0].content;prompts.push(prompt);
   const ids=[...new Set([...prompt.matchAll(/"id"\s*:\s*"(seg_\d+)"/g)].map(m=>m[1]))];
   const nameToken=prompt.match(/@@VERBA_(?:DEEP_)?NAME_\d+@@/)?.[0]||'다나';
   return{content:JSON.stringify({segments:ids.map(id=>({id,translation:`${nameToken}은(는) 미소를 지었다.`}))})};
  });
  const result=await engine.output('Dana smiled.\n\n"Hi, Dana."\n\n`CODE_UNCHANGED`',{speakerIdentity:{sourceUserName:'Dana',userName:'다나',characterName:'Chris'}});
  assert.match(result.translation,/CODE_UNCHANGED/);assert.match(result.translation,/Hi, Dana/);assert.ok(!result.translation.includes('@@'));
  assert.ok(prompts.length);assert.ok(result.sourceMap.length);
 });
}
