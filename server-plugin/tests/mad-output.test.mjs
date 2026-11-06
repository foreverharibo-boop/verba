import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as verba} from '../engines/verba.mjs';
import {createEngine as deep} from '../engines/verba-deep.mjs';
const source='He waited.\n\n"Stay quiet."\n\n*Door locked.*\n\n**Come here.**\n\n[Wait here.]\n\n`Keep quiet.`\n\n```text\nLeave now.\n```\n\n<div class="card"><span>All clear.</span></div>\n<script>const label="Protected English";</script>';
const translate=r=>{
 const text=r.text??r.source;
 const entries=[['He waited.','그는 기다렸다.'],['Stay quiet.','조용히 있어.'],['Door locked.','문이 잠겼다.'],['Come here.','이리 와.'],['Wait here.','여기서 기다려.'],['Keep quiet.','조용히 해.'],['Leave now.','지금 떠나.'],['All clear.','이상 없음.']];
 let out=text;
 for(const [en,ko] of entries)out=out.replace(en,en+' ['+ko+']');
 return out;
};
for(const [name,create] of [['verba',verba],['deep',deep]]) for(const [mode,extra] of [['normal',{}],['compressed',{developerMode:true,developerCompressedPromptEnabled:true}],['extreme',{developerMode:true,developerExtremeCompressedPromptEnabled:true}],['split',{developerMode:true,developerOutputSplitCount:2}],['minimal',{developerMode:true,developerMinimalPromptEnabled:true}]])for(const reviewMode of ['off','unchanged','failure','reintroduce']) {
 test(`${name}/${mode}/${reviewMode}: MAD respects disabled bilingual directives and strips only paired source`,async()=>{
  let firstCalls=0,reviews=0;
  const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode:true,developerMadKoreanOutputEnabled:true,allDialoguePromptEnabled:false,allDialoguePrompt:'대사 한영병기',globalPromptEnabled:false,globalPrompt:'GLOBAL_BILINGUAL_SENTINEL',...(reviewMode==='off'?{aiPostReview:{}}:{}),...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
   const p=messages.map(x=>x.content).join('\n');
   assert.doesNotMatch(p,/대사 한영병기|GLOBAL_BILINGUAL_SENTINEL/);
   if(p.includes('\nREVIEW_UNITS\n')){
    reviews++;
    const rows=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
    assert.ok(rows.every(r=>r.type!=='bilingual'));
    if(reviewMode==='failure')throw Error('review intentionally unavailable');
    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:reviewMode==='reintroduce'?r.CURRENT+' (Stay quiet.)':r.CURRENT}))})};
   }
   firstCalls++;
   const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>p.includes(x));
   assert.ok(marker,'initial request marker');
   const rows=JSON.parse(p.slice(p.lastIndexOf(marker)+marker.length));
   return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:translate(r)}))})};
  });
  const result=await engine.output(source,{});
  assert.doesNotMatch(result.translation,/He waited|Stay quiet|Door locked|Come here|Wait here|Keep quiet|Leave now|All clear/);
  assert.match(result.translation,/<div class="card"><span>이상 없음\.<\/span><\/div>/);
  assert.match(result.translation,/<script>const label="Protected English";<\/script>/);
  assert.match(result.translation,/"조용히 있어\."/);
  assert.match(result.translation,/\*문이 잠겼다\.\*/);
  assert.match(result.translation,/\*\*이리 와\.\*\*/);
  assert.match(result.translation,/\[여기서 기다려\.\]/);
  assert.match(result.translation,/`조용히 해\.`/);
  assert.match(result.translation,/```text\n지금 떠나\.\n```/);
  assert.equal(reviews,reviewMode==='off'?0:1);
  assert.ok(firstCalls>=1&&firstCalls<=2);
  assert.ok(result.outputComparison.stages.some(s=>s.stage==='mad-korean-only'&&s.changedRows>0));
  assert.ok(result.outputComparison.stages.some(s=>s.stage==='mad-korean-only-final'));
 });
}
