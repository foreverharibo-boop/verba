import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEEPSEEK_KOREAN_PROMPT, DEEPSEEK_KOREAN_REVIEW_GUIDANCE } from '../deepseek-korean.js';
import { normalizePostReview, buildPostReviewPrompt, planPostReview, reviewOutputOnce, postReviewSettingsMarkup } from '../post-review.js';
import { segmentSource, assembleTranslation } from '../core.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';
import { reportedPrompt } from './fixtures/bilingual-inline-rules.js';
const cfg = {developerMode:true,developerDeepseekKoreanEnabled:true,aiPostReview:{deepseekTranslationese:true},debugMode:true};
const fixture = (source,drafts) => {const segmented=segmentSource(source);return {segmented,translations:new Map(segmented.segments.map((s,i)=>[s.id,drafts[i]]))};};

test('original highest-priority paragraph stays byte-identical and reconstruction permission follows it',()=>{
 const paragraph="HIGHEST-PRIORITY TRANSLATION PRINCIPLE: Thoroughly eliminate translationese from the Korean translation while accurately preserving the source's meaning and scene. Do not allow awkward expressions caused by mechanically copying English word order, sentence structures, or word combinations. First understand the action, state, and speech intent conveyed by each sentence, then reconstruct it in natural Korean as if the fiction had originally been written in Korean. However, never delete source information or imagery, weaken or intensify the language, or add new meaning for the sake of fluency. This principle governs Korean expression; preserve the specified bilingual format and output structure.";
 assert.equal(DEEPSEEK_KOREAN_PROMPT.split('\n\n')[0],paragraph);
 assert.ok(DEEPSEEK_KOREAN_PROMPT.indexOf('FREEDOM TO RECONSTRUCT') < DEEPSEEK_KOREAN_PROMPT.indexOf('NATURAL KOREAN TRANSLATION OF'));
 assert.match(DEEPSEEK_KOREAN_PROMPT,/no obligation to preserve the source sentence structure/);
});
test('ordinary checklist omits the dedicated opt-in without deleting its saved preference',()=>{
 assert.equal(normalizePostReview().deepseekTranslationese,false);
 assert.equal(normalizePostReview({}).deepseekTranslationese,false);
 assert.equal(normalizePostReview({deepseekTranslationese:true}).deepseekTranslationese,true);
 const ui=postReviewSettingsMarkup('verba',{...cfg,developerDeepseekKoreanEnabled:false});
 assert.doesNotMatch(ui,/data-post-review="deepseekTranslationese"/);
 assert.equal(normalizePostReview(cfg.aiPostReview).deepseekTranslationese,true);
 assert.doesNotMatch(ui,/딥식플 전용 직역투/);
 assert.match(ui,/API 요청이 1회 추가/);
});
test('DeepSeek toggle and review selection are required; ordinary checks still work when inactive',async()=>{
 for(const extra of [{developerMode:false},{developerDeepseekKoreanEnabled:false},{aiPostReview:{}}]){
  const data=fixture('He lay on his back.',['그는 척추를 대고 누웠다.']);
  const stats=await reviewOutputOnce({...data,settings:{...cfg,...extra},request:()=>assert.fail('inactive review called')});
  assert.equal(stats.checked,0);assert.ok(!stats.checks.includes('deepseekTranslationese'));
 }
 const data=fixture('He waited.',['그는 기다렸다.']);
 await reviewOutputOnce({...data,settings:{...cfg,developerDeepseekKoreanEnabled:false,aiPostReview:{translationese:true,deepseekTranslationese:true}},request:async(p,rows)=>{
  assert.ok(!p.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));assert.deepEqual(rows[0].checks,['translationese']);return new Map(rows.map(r=>[r.id,r.CURRENT]));
 }});
});
test('dedicated pass recasts Korean in narration and bilingual dialogue in one call without source or format changes',async()=>{
 const data=fixture('He lay on his back.\n\n"Enjoy the seat."',['그는 척추를 대고 누웠다.','"Enjoy the seat. (좌석을 즐겨.)"']);let calls=0;
 const settings={...cfg,allDialoguePrompt:reportedPrompt,aiPostReview:{meaning:true,deepseekTranslationese:true}};
 const stats=await reviewOutputOnce({...data,settings,reference:'STYLE_SENTINEL',request:async(p,rows)=>{
  calls++;assert.ok(p.includes(DEEPSEEK_KOREAN_REVIEW_GUIDANCE));assert.match(p,/STYLE_SENTINEL/);
  assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.type==='bilingual').length,1);
  assert.ok(rows.every(r=>r.checks.includes('deepseekTranslationese')&&!r.checks.includes('bilingual')));
  return new Map(rows.map(r=>[r.id,r.CURRENT.replace('척추를 대고','등을 대고').replace('좌석을 즐겨.','거기 앉아서 편히 쉬어.')]));
 }});
 assert.equal(calls,1);assert.equal(stats.status,'completed');assert.equal(stats.changed,2);
 assert.equal(assembleTranslation(data.segmented,data.translations),'그는 등을 대고 누웠다.\n\n"Enjoy the seat. (거기 앉아서 편히 쉬어.)"');
 const comparison=createOutputComparison(data.segmented,true);comparison.postReview(stats);
 assert.ok(sanitizeOutputComparison(comparison.finish(''),{summaryOnly:true}).postReview.checks.includes('deepseekTranslationese'));
});
test('mixed paragraph keeps locked English while recasting its Korean and surrounding narration',async()=>{
 const data=fixture('He waited. *Stay quiet.*',['그는 기다리는 것을 했다. *Stay quiet. [조용함을 유지해.]*']);
 const settings={...cfg,globalPrompt:'Inside italics, preserve the original English and add Korean in brackets. Everything outside italics is Korean only.'};
 const stats=await reviewOutputOnce({...data,settings,request:async(p,rows)=>{
  assert.equal(rows.length,2);assert.match(rows[0].CURRENT,/@@REVIEW_LOCK_/);
  return new Map(rows.map(r=>[r.id,r.CURRENT.replace('기다리는 것을 했다','기다렸다').replace('조용함을 유지해','조용히 있어')]));
 }});
 assert.equal(stats.status,'completed');assert.equal(assembleTranslation(data.segmented,data.translations),'그는 기다렸다. *Stay quiet. [조용히 있어.]*');
});
test('English and wrapper damage stay local; missing IDs and network errors keep the complete draft',async()=>{
 for(const failure of ['english','wrapper','missing','network']){
  const data=fixture('He waited.\n\n"Stay quiet."',['그는 기다리는 것을 했다.','"Stay quiet. (조용함을 유지해.)"']);const before=[...data.translations];let calls=0;
  const stats=await reviewOutputOnce({...data,settings:{...cfg,allDialoguePrompt:reportedPrompt},request:async(p,rows)=>{
   calls++;if(failure==='network')throw Error('offline');if(failure==='missing')return new Map();
   return new Map(rows.map(r=>[r.id,r.type==='bilingual'?failure==='english'?r.CURRENT.replace('Stay quiet.','Be quiet.'):r.CURRENT.replace('"',''):r.CURRENT.replace('기다리는 것을 했다','기다렸다')]));
  }});
  assert.equal(calls,1);
  if(failure==='english'||failure==='wrapper'){
   assert.equal(stats.status,'partial');assert.equal(stats.changed,1);
   assert.equal([...data.translations][0][1],'그는 기다렸다.');assert.equal([...data.translations][1][1],before[1][1]);
  }else{assert.equal(stats.status,'failed');assert.equal(stats.changed,0);assert.deepEqual([...data.translations],before);}
 }
});
test('free engine excludes the dedicated check and protected tokens survive valid rewrites',async()=>{
 const data=fixture('He waited.',['@@VERBA_NAME_0000@@ 기다리는 것을 했다.']);
 await reviewOutputOnce({...data,settings:{...cfg,translationEngine:'google-free'},request:()=>assert.fail('free engine review')});
 const stats=await reviewOutputOnce({...data,settings:cfg,request:async(p,rows)=>new Map(rows.map(r=>[r.id,r.CURRENT.replace('기다리는 것을 했다','기다렸다')]))});
 assert.equal(stats.status,'completed');assert.equal([...data.translations.values()][0],'@@VERBA_NAME_0000@@ 기다렸다.');
});
test('browser review setup includes active style reference for the selected dedicated check',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.match(index,/selected\.deepseekTranslationese && deepseekKoreanEnabled\(config\)/);
 assert.ok(planPostReview(fixture('He waited.',['기다렸다.']).segmented,new Map([['seg_0000','기다렸다.']]),cfg).selected.includes('deepseekTranslationese'));
});

 test('naturalness priority is appended only to an active dedicated review; ordinary fallback stays intact',()=>{
  const data=fixture('He waited.',['그는 기다렸다.']);
  for(const [extra,active] of [[{},true],[{developerMode:false},false],[{developerDeepseekKoreanEnabled:false},false],[{aiPostReview:{translationese:true}},false]]){
   const settings={...cfg,aiPostReview:{translationese:true,deepseekTranslationese:true},...extra};
   const plan=planPostReview(data.segmented,data.translations,settings);
   const prompt=buildPostReviewPrompt(plan,data.segmented,settings);
   assert.equal(prompt.includes('accurate meaning alone is not a reason to retain awkward wording'),active);
   assert.equal(prompt.includes('Even when the meaning is accurate, correct unnatural Korean.'),active);
   assert.equal(prompt.includes('If unsure, copy CURRENT exactly.'),!active);
   assert.ok(plan.units.every(unit=>unit.checks.includes('deepseekTranslationese')===active));
  }
 });


test('dedicated review control lives only in the unlocked developer panel and keeps its saved state',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=index.indexOf('function developerChuseokGalbwaeMarkup(');
 const end=index.indexOf('function syncDeveloperQualityControls(',start);
 const render=Function('settings',index.slice(start,end)+';return developerSettingsMarkup();');
 const settings={...cfg,aiPostReview:{meaning:true,deepseekTranslationese:true}};
 const before=structuredClone(settings);
 assert.match(render(settings),/data-post-review="deepseekTranslationese" checked/);
 assert.doesNotMatch(render({...settings,developerMode:false}),/data-post-review="deepseekTranslationese"/);
 assert.doesNotMatch(render({...settings,aiPostReview:{}}),/data-post-review="deepseekTranslationese" checked/);
 for(const developerMode of [false,true]) {
  const html=postReviewSettingsMarkup('test',{...settings,developerMode});
  assert.doesNotMatch(html,/data-post-review="deepseekTranslationese"/);
  assert.match(html,/data-post-review="meaning" checked/);
 }
 assert.deepEqual(settings,before);
});

test('delegated review changes handle newly rendered developer controls without losing other choices',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=index.indexOf('// Developer controls are replaced when the mode changes;');
 const end=index.indexOf('    const debugModeInput',start);
 assert.ok(start>=0&&end>start);
 let change,saved=0;
 const panel={addEventListener(type,fn){assert.equal(type,'change');change=fn;}};
 class Input { constructor(key,checked){this.dataset={postReview:key};this.checked=checked;} matches(selector){return selector==='[data-post-review]';} }
 const settings={developerMode:false,aiPostReview:{meaning:true,deepseekTranslationese:true}};
 Function('panel','settings','HTMLInputElement','POST_REVIEW_CHECKS','normalizePostReview','saveSettings',index.slice(start,end))(panel,settings,Input,[{key:'meaning'},{key:'deepseekTranslationese'}],normalizePostReview,()=>saved++);
 change({target:new Input('deepseekTranslationese',false)});
 assert.equal(saved,0);assert.equal(settings.aiPostReview.deepseekTranslationese,true);
 settings.developerMode=true;
 change({target:new Input('deepseekTranslationese',false)});
 assert.equal(saved,1);assert.equal(settings.aiPostReview.deepseekTranslationese,false);assert.equal(settings.aiPostReview.meaning,true);
 settings.developerMode=false;
 change({target:new Input('meaning',false)});
 assert.equal(saved,2);assert.equal(settings.aiPostReview.meaning,false);
 settings.developerMode=true;
 change({target:new Input('deepseekTranslationese',true)});
 assert.equal(saved,3);assert.equal(settings.aiPostReview.deepseekTranslationese,true);
});
