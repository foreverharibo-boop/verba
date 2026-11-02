import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as verba} from '../engines/verba.mjs';
import {createEngine as deep} from '../engines/verba-deep.mjs';
const source='He waited.\n\n"Wait here," Ajax said. "I will return soon."';
for(const [name,create] of [['verba',verba],['deep',deep]]) {
 for(const [mode,extra] of [['normal',{}],['minimal',{developerMode:true,developerMinimalPromptEnabled:true}],['mad',{developerMadKoreanOutputEnabled:true}],['tag',{}]]) {
  test(`${name}/${mode}: diagnostics explain effective scope and path, with no output/request changes`,async()=>{
   const run=async debugMode=>{
    const sent=[];
    const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:0,debugMode,allDialoguePrompt:'대사 한영병기',allDialoguePromptEnabled:true,...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(id,messages)=>{
     const text=messages.map(m=>m.content).join('\n');sent.push(text);
     const review=text.includes('\nREVIEW_UNITS\n');
     const marker=['\nREVIEW_UNITS\n','\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));assert.ok(marker);
     const rows=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
     return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:review?r.CURRENT:r.type==='dialogue_candidate'?'"기다려."':'그는 기다렸다.'}))})};
    });
    const result=await engine.output(mode==='tag'?`<div>${source}</div>`:source,{diagnosticMessageId:446,diagnosticSwipeId:0});
    return {result,sent};
   };
   const on=await run(true),off=await run(false);
   assert.deepEqual(on.sent,off.sent);
   assert.equal(on.result.translation,off.result.translation);
   assert.equal(off.result.outputComparison,undefined);
   const report=on.result.outputComparison;
   assert.equal(report.binding.route,'server-engine');
   assert.equal(report.binding.messageId,446);
   assert.equal(report.bilingualSettings.slots.allDialogue.requested.dialogue,true);
   if(mode==='mad'){
    assert.equal(report.bilingualSettings.blocker,'mad-exclusive');
    assert.equal(report.bilingualSettings.effectiveScopes.dialogue,false);
    assert.equal(report.dialogueAssembly.scopeNotRequested,2);
    assert.equal(report.postReview.units.bilingual,0);
   } else if(mode==='tag') {
    assert.equal(report.segmentTypes.dialogue_candidate,0);
    assert.ok(report.stages[0].bilingual.reasons['tag-excluded']>0);
   } else if(mode==='minimal') {
    assert.equal(report.assemblyPath,'minimal');
    assert.equal(report.dialogueAssembly,undefined);
    assert.equal(report.postReview.units.bilingual,2);
   } else {
    assert.equal(report.dialogueAssembly.visited,2);
    assert.equal(report.dialogueAssembly.unchangedSourcePresent,2);
    assert.equal(report.stages.find(s=>s.stage==='local-normalization').bilingual.exactSourceTargets,2);
    assert.equal(report.postReview.units.bilingual,2);
    assert.equal(report.postReview.bilingualSettings.effectiveScopes.dialogue,true);
   }
   assert.doesNotMatch(JSON.stringify(report),/Wait here|Ajax|기다려|대사 한영병기/);
  });
 }
}
