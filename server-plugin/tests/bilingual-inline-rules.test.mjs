import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedPrompt } from '../../tests/fixtures/bilingual-inline-rules.js';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
for (const [variant, createEngine] of [['verba',verba],['verba-deep',deep]]) {
 for (const enabled of [false,true]) test(`${variant}: pasted inline list repairs same-quote dialogue and enrolls review (DeepSeek ${enabled})`,async()=>{
  const settings={developerMode:true,developerDeepseekKoreanEnabled:enabled,profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,
   allDialoguePromptEnabled:true,allDialoguePrompt:reportedPrompt,globalPromptEnabled:false,
   aiPostReview:{english:true,bilingual:true},debugMode:true};
  let requests=0,reviewed=0;
  const engine=createEngine({settings,profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
   requests++;const p=messages[0].content;
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
    const rows=JSON.parse(p.split('\nREVIEW_UNITS\n').at(-1));
    const pairs=rows.filter(r=>r.type==='bilingual');
    assert.equal(pairs.length,1);assert.ok(pairs[0].checks.includes('bilingual'));reviewed++;
    assert.ok(rows.filter(r=>r.scope==='narration').every(r=>!r.checks.includes('bilingual')));
    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.CURRENT}))})};
   }
   assert.ok(p.includes(reportedPrompt));
   const rows=JSON.parse(p.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
   return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:r.type==='dialogue_candidate'?'"Wait here." (여기서 기다려.)':'그가 기다렸다.'}))})};
  });
  const out=await engine.output('"Wait here."\n\nHe waited.');
  assert.equal(out.translation,'"Wait here. (여기서 기다려.)"\n\n그가 기다렸다.');
  assert.equal(requests,2);assert.equal(reviewed,1);
 });
}
