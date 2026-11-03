import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POST_REVIEW_CHECKS, normalizePostReview, planPostReview, reviewOutputOnce, postReviewSettingsMarkup } from '../post-review.js';
import { segmentSource, assembleTranslation } from '../core.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';
const settings = { globalPrompt: 'Inside italics, preserve the original English and add Korean in brackets. Everything outside italics is Korean only.' };
const fixture = (source, draft) => { const segmented=segmentSource(source); return {segmented,translations:new Map(segmented.segments.map((s,i)=>[s.id,Array.isArray(draft)?draft[i]:draft]))}; };

test('defaults preserve only previously active English/bilingual checks; empty object means all off',()=>{
 assert.deepEqual(POST_REVIEW_CHECKS.filter(x=>normalizePostReview()[x.key]).map(x=>x.key),['english','bilingual']);
 assert.ok(Object.values(normalizePostReview({})).every(x=>x===false));
 assert.equal(normalizePostReview({meaning:true,evil:true}).evil,undefined);
});
test('every general checkbox reaches only its selected instruction in a single request',async()=>{
 for(const check of POST_REVIEW_CHECKS.filter(x=>x.key!=='bilingual')) {
  const data=fixture('He waited.','그는 기다렸다.');let calls=0;
  const config={aiPostReview:{[check.key]:true},developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true};
  if(check.key==='deepseekTranslationese'){config.developerMode=true;config.developerDeepseekKoreanEnabled=true;}
  if(check.key==='hongjin'){data.segmented.segments[0].type='dialogue_candidate';}
  const stats=await reviewOutputOnce({...data,settings:config,speakerScopes:{[data.segmented.segments[0].id]:'target_dialogue'},request:async(p,rows)=>{
   calls++;assert.deepEqual(rows[0].checks,[check.key]); return new Map(rows.map(r=>[r.id,r.CURRENT]));
  }});
  assert.equal(calls,1,check.key);assert.equal(stats.status,'completed');
 }
});
test('many checks + bilingual units share one call; bilingual-only cannot edit other rows',async()=>{
 const data=fixture('He waited.\n\n*Stay quiet.*',['그는 기다렸다.','*조용히 있어. [조용히 있어.]*']);let calls=0;
 const result=await reviewOutputOnce({...data,settings:{...settings,aiPostReview:{meaning:true,english:true,bilingual:true}},request:async(p,rows)=>{
  calls++;assert.equal(rows.length,2);return new Map(rows.map(r=>[r.id,r.type==='bilingual'?'*Stay quiet. [조용히 있어.]*':'그는 기다리고 있었다.']));
 }});
 assert.equal(calls,1);assert.equal(result.status,'completed');assert.match(assembleTranslation(data.segmented,data.translations),/Stay quiet/);
 const only=planPostReview(data.segmented,data.translations,{...settings,aiPostReview:{bilingual:true}});
 assert.equal(only.units.length,1);assert.equal(only.units[0].type,'bilingual');
});
test('bilingual source is frozen when only general checks selected, including mixed paragraphs',async()=>{
 const data=fixture('He waited. *Stay quiet.*','그는 기다렸다. *Stay quiet. [조용히 있어.]*');
 const result=await reviewOutputOnce({...data,settings:{...settings,aiPostReview:{translationese:true}},request:async(p,rows)=>{
  assert.equal(rows.length,2);assert.match(rows[0].CURRENT,/@@REVIEW_LOCK_/);assert.doesNotMatch(rows[0].CURRENT,/Stay quiet/);
  assert.ok(rows.every(r=>!r.checks.includes('bilingual')));
  return new Map(rows.map(r=>[r.id,r.CURRENT.replace('기다렸다','기다리고 있었다')]));
 }});
 assert.equal(result.status,'completed');assert.match([...data.translations.values()][0],/\*Stay quiet\. \[조용히 있어\.\]\*/);
});
test('unrequested bilingual expansion and HTML damage preserve only the rejected segment',async()=>{
 for(const bad of ['그는 기다렸다. [He waited.]','그는 기다렸다.</div>','@@VERBA_9999@@그는 기다렸다.','그는\n기다렸다.']){
  const data=fixture('He waited.\n\n*Stay quiet.*',['그는 기다렸다.','*조용히 있어.*']);const before=[...data.translations];
  const result=await reviewOutputOnce({...data,settings:{...settings,aiPostReview:{meaning:true,bilingual:true}},request:async(p,rows)=>new Map(rows.map(r=>[r.id,r.type==='bilingual'?'*Stay quiet. [조용히 있어.]*':bad]))});
  assert.equal(result.status,'partial');assert.equal([...data.translations][0][1],before[0][1]);assert.equal(result.changed,1);
  assert.equal([...data.translations][1][1],'*Stay quiet. [조용히 있어.]*');assert.equal(result.rejected,1);
 }
});
test('network, malformed IDs, and invalid bilingual unit keep first result; never retry',async()=>{
 for(const failure of ['network','id','invalid']){
  const data=fixture('*Stay quiet.*','*조용히 있어.*');const before=[...data.translations];let calls=0;
  const stats=await reviewOutputOnce({...data,settings:{...settings,aiPostReview:{bilingual:true}},request:async(p,rows)=>{
   calls++;if(failure==='network')throw Error('no');return new Map([[failure==='id'?'wrong':rows[0].id,'*조용히 있어. [조용히 있어.]*']]);
  }});
  assert.equal(calls,1);assert.equal(stats.status,'failed');assert.deepEqual([...data.translations],before);
 }
});
test('all off/free engine/taste disabled/oversize prompt do not call provider',async()=>{
 for(const config of [{aiPostReview:{}},{translationEngine:'google-free'},{aiPostReview:{mad:true,hongjin:true}},{aiPostReview:{meaning:true},globalPrompt:'x'.repeat(130000)}]){
  const data=fixture('Hello.','안녕.');await reviewOutputOnce({...data,settings:config,request:()=>assert.fail('unexpected call')});
 }
});
test('paired HTML text stays separate from allowed fenced status bilingual units',async()=>{
 const data=fixture('<div>Hello.</div>\n\n```text\n[Weather: Clear]\n```',['안녕.','[날씨: 맑음]']);
 const cfg={globalPrompt:'Inside fenced code blocks, preserve the original English and add Korean in brackets.',aiPostReview:{english:true,bilingual:true}};
 const plan=planPostReview(data.segmented,data.translations,cfg);
 assert.equal(plan.units.filter(r=>r.type==='bilingual').length,1);
 assert.equal(plan.units.find(r=>r.scope==='tagged_content').type,'general');
 const result=await reviewOutputOnce({...data,settings:cfg,request:async(p,rows)=>new Map(rows.map(r=>[r.id,r.type==='bilingual'?'[Weather: Clear 날씨: 맑음]':r.CURRENT]))});
 assert.equal(result.status,'completed');assert.match(assembleTranslation(data.segmented,data.translations),/^<div>안녕\.<\/div>/);
});
test('both English-first and Korean-first bilingual replacements are accepted',async()=>{
 for(const text of ['*Stay quiet. [조용히 있어.]*','*조용히 있어. [Stay quiet.]*']){
  const data=fixture('*Stay quiet.*','*조용히 있어.*');
  const result=await reviewOutputOnce({...data,settings:{...settings,aiPostReview:{bilingual:true}},request:async(p,rows)=>new Map([[rows[0].id,text]])});
  assert.equal(result.status,'completed');assert.equal([...data.translations.values()][0],text);
 }
});
test('settings section precedes Debug, binds persistence, and diagnostics whitelist check keys only',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.ok(source.indexOf("${postReviewSettingsMarkup(")<source.indexOf('<details id="verba-debug-settings"'));
 assert.match(source,/settings.aiPostReview = \{.*\[key\]: event.target.checked \};\n\s*saveSettings\(\)/);
 assert.equal((postReviewSettingsMarkup('verba',{}).match(/data-post-review=/g)||[]).length,POST_REVIEW_CHECKS.length);
 const data=fixture('SECRET SOURCE','비밀');const report=createOutputComparison(data.segmented,true);
 report.postReview({checked:1,changed:0,status:'failed',checks:['meaning','SECRET'],prompt:'SECRET'});
 const output=sanitizeOutputComparison(report.finish('비밀'),{summaryOnly:true});
 assert.deepEqual(output.postReview.checks,['meaning']);assert.doesNotMatch(JSON.stringify(output),/SECRET/);
});
