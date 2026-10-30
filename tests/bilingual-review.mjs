import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, assembleTranslation } from '../core.js';
import { bilingualReviewTargets, reviewBilingualOutput, validBilingualReplacement, buildBilingualReviewPrompt } from '../bilingual-review.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';
const settings={globalPrompt:'Inside italics, bold, inline backticks, fenced code blocks and square brackets, output both English and Korean text. Preserve the source English exactly once and put Korean in brackets after it.'};
const setup=(source,values,names=[])=>{
 const segmented=segmentSource(source,names,{translateTaggedContent:true});
 return {segmented,translations:new Map(segmented.segments.map((s,i)=>[s.id,values[i]]))};
};
test('AI repairs only the marked unit, leaving adjacent narration and unrequested dialogue byte-identical',async()=>{
 const data=setup('He waited. *Stay quiet.* Then he left.\n\n"Wait here."',['그는 기다렸다. *조용히 있어. [조용히 있어.]* 그리고 떠났다.','"여기서 기다려."']);
 let calls=0;
 const result=await reviewBilingualOutput({...data,settings,request:async(prompt,rows)=>{
  calls++;assert.equal(rows.length,1);assert.equal(rows[0].source,'Stay quiet.');
  assert.match(prompt,/ALL-DIALOGUE rules apply only to kind=dialogue/);
  return new Map([[rows[0].id,'*Stay quiet. [조용히 있어.]*']]);
 }});
 assert.equal(calls,1);assert.equal(result.changed,1);
 assert.deepEqual([...data.translations.values()],['그는 기다렸다. *Stay quiet. [조용히 있어.]* 그리고 떠났다.','"여기서 기다려."']);
});
test('several edits use stable original offsets',async()=>{
 const data=setup('*Wait.* Next, *Stay quiet.*',['*기다려.* 그다음, *조용히 있어.*']);
 await reviewBilingualOutput({...data,settings,request:async(_p,rows)=>new Map(rows.map((r,i)=>[r.id,i?'*Stay quiet. [조용히 있어.]*':'*Wait. [기다려.]*']))});
 assert.equal([...data.translations.values()][0],'*Wait. [기다려.]* 그다음, *Stay quiet. [조용히 있어.]*');
});
test('all supported flat wrappers and either language order pass',async()=>{
 for(const [source,current,forward,reverse] of [
  ['*Stay quiet.*','*조용히 있어.*','*Stay quiet. [조용히 있어.]*','*조용히 있어. [Stay quiet.]*'],
  ['**Stay quiet.**','**조용히 있어.**','**Stay quiet. [조용히 있어.]**','**조용히 있어. [Stay quiet.]**'],
  ['[Stay quiet.]','[조용히 있어.]','[Stay quiet. 조용히 있어.]','[조용히 있어. Stay quiet.]'],
  ['`Stay quiet.`','조용히 있어.','Stay quiet. [조용히 있어.]','조용히 있어. [Stay quiet.]'],
  ['```text\nStay quiet.\n```','조용히 있어.','Stay quiet. [조용히 있어.]','조용히 있어. [Stay quiet.]'],
  ['```\n[Thought: Stay quiet.]\n```','[생각: 조용히 있어.]','[Thought: Stay quiet. 생각: 조용히 있어.]','[생각: 조용히 있어. Thought: Stay quiet.]'],
 ]) {
  for(const replacement of [forward,reverse]) {
   const data=setup(source,[current]);const rows=bilingualReviewTargets(data.segmented,data.translations,settings).targets;
   assert.equal(rows.length,1,source);assert.equal(validBilingualReplacement(rows[0],replacement),true,replacement);
   const stats=await reviewBilingualOutput({...data,settings,request:async(_p,targets)=>new Map([[targets[0].id,replacement]])});
   assert.equal(stats.changed,1,source);
   const assembled=assembleTranslation(data.segmented,data.translations);
   if(source.startsWith('```')) assert.ok(assembled.startsWith(source.startsWith('```text')?'```text\n':'```\n'));
  }
 }
});
test('dialogue and whole narration require their own permission',()=>{
 const data=setup('He waited.\n\n"Wait here."',['그는 기다렸다.','"여기서 기다려."']);
 assert.equal(bilingualReviewTargets(data.segmented,data.translations,settings).targets.length,0);
 const all=bilingualReviewTargets(data.segmented,data.translations,{globalPrompt:'For all text, output both English and Korean text.'}).targets;
 assert.deepEqual(all.map(x=>x.kind),['narration','dialogue']);
 assert.equal(validBilingualReplacement(all[1],'"여기서 기다려. [Wait here.]"'),true);
});
test('paired tags never enter review even under a global all-text request',()=>{
 const data=setup('<Info_panel>[Thought: Stay quiet.]</Info_panel>',['[생각: 조용히 있어.]']);
 assert.equal(bilingualReviewTargets(data.segmented,data.translations,{globalPrompt:'For all text, output both English and Korean text.'}).targets.length,0);
});
test('actual code syntax and identifiers remain withheld during string review',async()=>{
 const source='```json\n{"message":"Stay quiet.","count":2,"enabled":true}\n```';
 const data=setup(source,['조용히 있어.']);
 const stats=await reviewBilingualOutput({...data,settings,request:async(_p,rows)=>{
  assert.equal(rows.length,1);assert.equal(rows[0].source,'Stay quiet.');
  return new Map([[rows[0].id,'Stay quiet. [조용히 있어.]']]);
 }});
 assert.equal(stats.changed,1);
 assert.deepEqual(JSON.parse(assembleTranslation(data.segmented,data.translations).split('\n')[1]),{message:'Stay quiet. [조용히 있어.]',count:2,enabled:true});
});
test('name tokens stay once in Korean while original English uses source spelling',async()=>{
 const data=setup('*Alex, wait.*',['*@@VERBA_NAME_0000@@, 기다려.*'],[{source:'Alex',target:'알렉스'}]);
 const token=data.segmented.nameTokens[0].token;
 data.translations.set(data.segmented.segments[0].id,`*${token}, 기다려.*`);
 const rows=bilingualReviewTargets(data.segmented,data.translations,settings).targets;
 assert.equal(rows.length,1);assert.equal(rows[0].source,'Alex, wait.');
 assert.equal(validBilingualReplacement(rows[0],`*Alex, wait. [${token}, 기다려.]*`),true);
 assert.equal(validBilingualReplacement(rows[0],'*Alex, wait. [알렉스, 기다려.]*'),false);
});
test('uncertain marker mapping, nested markers and links are left unchanged',async()=>{
 for(const [source,current] of [['*Wait.* and *Stay.*','*기다려.*'],['*Wait **here**.*','*여기서 **기다려**.*'],['***Wait.***','***기다려.***'],['[Wait.](https://example.com)','[기다려.](https://example.com)'],['*Wait.*','기다려.']]) {
  const data=setup(source,[current]);let calls=0;
  const stats=await reviewBilingualOutput({...data,settings,request:async()=>{calls++;throw Error('not allowed');}});
  assert.equal(calls,0,source);assert.equal(stats.changed,0);
 }
});
test('no request, heading-only, inactive slots, exclusive modes and free translation never call AI',async()=>{
 for(const s of [{},{globalPrompt:'BILINGUAL OUTPUT FORMAT'}, {globalPrompt:settings.globalPrompt,globalPromptEnabled:false},
 {dialoguePrompt:settings.globalPrompt},{allDialoguePrompt:settings.globalPrompt},
 {customTranslatorEnabled:true,customTranslatorTemplates:{input:settings.globalPrompt}},
 {...settings,developerMadKoreanOutputEnabled:true},{...settings,translationEngine:'google-free'}]) {
  const data=setup('*Wait.*',['*기다려.*']);let calls=0;
  await reviewBilingualOutput({...data,settings:s,request:async()=>{calls++;throw Error();}});
  assert.equal(calls,0,JSON.stringify(s));
 }
});
test('custom chat translation may authorize review but all-dialogue remains limited to dialogue',()=>{
 const data=setup('*Wait.*',['*기다려.*']);
 assert.equal(bilingualReviewTargets(data.segmented,data.translations,{customTranslatorEnabled:true,customTranslatorModified:{output:true},customTranslatorTemplates:{output:settings.globalPrompt}}).targets.length,1);
 assert.equal(bilingualReviewTargets(data.segmented,data.translations,{allDialoguePrompt:'For all text, output both English and Korean text.'}).targets.length,0);
});
test('invalid edits cannot escape the selected wrapper or invent/remove protected content',async()=>{
 for(const replacement of ['*기다려. [기다려.]*','*Wait. Wait. [기다려.]*','*Wait. [기다려.]* EXTRA *','*Wait. [기다려.]\n다른 문장*','*Wait. [기다려.] <script>*','*Wait. [@@VERBA_9999@@ 기다려.]*','*Wait. [기다려.*','*Wait.*']) {
  const data=setup('*Wait.*',['*기다려.*']);
  const stats=await reviewBilingualOutput({...data,settings,request:async(_p,rows)=>new Map([[rows[0].id,replacement]])});
  assert.equal(stats.rejected,1,replacement);assert.equal([...data.translations.values()][0],'*기다려.*');
 }
});
test('unchanged valid results remain byte-identical, and review failure never loses first translation',async()=>{
 for(const mode of ['unchanged','error','missing','extra']) {
  const data=setup('*Wait.*',['*Wait. [기다려.]*']);let calls=0;
  const before=new Map(data.translations);
  const stats=await reviewBilingualOutput({...data,settings,request:async(_p,rows)=>{calls++;if(mode==='error') throw Error('failure');if(mode==='missing')return new Map();return new Map([[rows[0].id,rows[0].current],...(mode==='extra'?[['wrong','unrequested']]:[])]);}});
  assert.equal(calls,1);assert.deepEqual(data.translations,before);assert.equal(stats.status,mode==='unchanged'?'completed':'failed');
 }
});
test('abort propagates without applying any review result',async()=>{
 const data=setup('*Wait.*',['*기다려.*']);const controller=new AbortController();
 await assert.rejects(reviewBilingualOutput({...data,settings,options:{signal:controller.signal},request:async()=>{controller.abort();return new Map();}}),{name:'AbortError'});
 assert.equal([...data.translations.values()][0],'*기다려.*');
});
test('bounded diagnostics record review stage and counts but never response or prompts',()=>{
 const data=setup('*Wait.*',['*기다려.*']);const comparison=createOutputComparison(data.segmented,true);
 comparison.initial(data.translations);comparison.bilingualReview({checked:1,changed:1,rejected:0,skipped:0,status:'completed',text:'SECRET'});
 data.translations.set(data.segmented.segments[0].id,'*Wait. [기다려.]*');comparison.capture('bilingual-review',data.translations);
 const safe=sanitizeOutputComparison(comparison.finish('RESULT'),{summaryOnly:true});
 assert.equal(safe.bilingualReview.changed,1);assert.equal(safe.stages.find(x=>x.stage==='bilingual-review').changedRows,1);
 assert.doesNotMatch(JSON.stringify(safe),/SECRET|Wait|기다려|RESULT/);
});

test('oversized review work is bounded and inactive large prompts do not block active rules',async()=>{
 const source=Array.from({length:90},()=>'*Wait.*').join(' ');
 const data=setup(source,[Array.from({length:90},()=>'*기다려.*').join(' ')]);
 const result=bilingualReviewTargets(data.segmented,data.translations,settings);
 assert.equal(result.targets.length,80);assert.equal(result.skipped,10);
 const small=setup('*Wait.*',['*기다려.*']);let calls=0;
 const oversized=await reviewBilingualOutput({...small,settings:{globalPrompt:settings.globalPrompt+' '.repeat(25000)},request:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(oversized.status,'limit');
 const active={globalPrompt:'x'.repeat(25000),globalPromptEnabled:false,customTranslatorEnabled:true,customTranslatorModified:{output:true},customTranslatorTemplates:{output:settings.globalPrompt}};
 await reviewBilingualOutput({...small,settings:active,request:async(_p,rows)=>{calls++;return new Map(rows.map(r=>[r.id,'*Wait. [기다려.]*']));}});
 assert.equal(calls,1);
});
