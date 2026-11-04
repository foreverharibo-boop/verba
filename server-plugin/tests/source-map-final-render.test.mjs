import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
for(const [name,createEngine] of [['verba',verba],['deep',deep]]){
 for(const minimal of [false,true])test(`${name}: ${minimal?'minimal':'normal'} server result maps corrected first translation`,async()=>{
  const snapshot={settings:{profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,
   developerMode:minimal,developerMinimalPromptEnabled:minimal,developerMinimalPrompt:'Translate to Korean.',
   dialogueEndingRepetitionReduction:false},profiles:{A:{}},nameLocks:[{source:'Vincent',target:'빈센트'}],
   character:{name:'Vincent'},context:{name1:'Dana',name2:'Vincent'}};
  const engine=createEngine(snapshot,async(_id,messages)=>{
   const prompt=messages[0].content;
   const ids=[...new Set([...prompt.matchAll(/"id"\s*:\s*"(seg_\d+)"/g)].map(m=>m[1]))];
   const token=prompt.match(/@@VERBA_(?:DEEP_)?NAME_\d+@@/)?.[0];assert.ok(token);
   return {content:JSON.stringify({segments:ids.map(id=>({id,translation:token+'은 고개를 숙였다.'}))})};
  });
  const original='Vincent lowered his head.';
  const result=await engine.output(original,{speakerIdentity:{characterName:'빈센트',sourceCharacterName:'Vincent',userName:'Dana'}});
  assert.equal(result.translation,'빈센트는 고개를 숙였다.');
  assert.equal(result.sourceMap.length,1);assert.equal(result.sourceMap[0].source,original);
  const row=result.sourceMap[0];assert.equal(result.translation.slice(row.start,row.end),result.translation);
 });
}
