import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { outputSplitCount, splitOutputSegments, runOutputBatches, createSplitRequestQueue } from '../output-splitting.js';
import { minimalOutputEnabled, translateMinimalOutput } from '../minimal-output.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between=(a,b)=>{const start=index.indexOf(a);return index.slice(start,index.indexOf(b,start));};
const defs=between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =');
const defaults=Function(defs+'\nreturn DEFAULT_SETTINGS;')();
assert.equal(defaults.developerOutputSplitCount,1);
for(const dev of [false,true])for(const count of [1,2,3,4,'3',null])for(const minimal of [false,true]){
 assert.equal(outputSplitCount({developerMode:dev,developerOutputSplitCount:count,developerMinimalPromptEnabled:minimal}),[2,3].includes(Number(count))?Number(count):1);
}
// Complete, ordered coverage for small/large inputs, all sizes and paragraph boundaries.
for(let length=0;length<25;length++)for(const count of [1,2,3]){
 const segments=Array.from({length},(_,i)=>({id:`s${i}`,type:'narration',text:'a'.repeat(i===2?700:20+i*3)}));
 const parts=segments.flatMap(s=>[s,{type:'passthrough',text:'\n\n'}]);
 const groups=splitOutputSegments({segments,parts},count);
 assert.equal(groups.length,Math.min(count,length));assert.deepEqual(groups.flat(),segments);
 assert.ok(groups.every(group=>group.length));
}
const source='Hong-jin waited by the door. "Come here."\n\nDam-eun looked up from her book. "In a minute."\n\nHe sat down by the window. "Take your time."\n\n`CODE_UNCHANGED`\n\n<Info_panel>[Weather: Sunny]</Info_panel>';
const segmented=core.segmentSource(source,[{source:'Hong-jin',target:'홍진'}]);
const translateSegment=s=>'번역 '+(s.text.match(/@@VERBA[A-Z0-9_]*@@/g)||[]).join(' ')+' 끝';
let settings={...defaults,developerMode:true,developerOutputSplitCount:3,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true};
const identity={characterName:'Hong-jin',userName:'Dam-eun',characterGender:'male'};
let requests=[];
const requestSegments=async(prompt,segments,options)=>{
 requests.push({prompt,segments,options});return new Map(segments.map(s=>[s.id,translateSegment(s)]));
};
const env={settings,outputSplitCount,runOutputBatches,requestSegments,
 buildOutputPrompt:core.buildOutputPrompt,buildScopedOutputPrompt:core.buildScopedOutputPrompt,
 madKoreanExclusiveMode:()=>settings.developerMadKoreanOutputEnabled===true,
 isAbort:(error,signal)=>signal?.aborted||error.name==='AbortError',SCOPED_PARALLEL_REQUEST_LIMIT:2,console};
const routingCode=between('function nameTokensForSegments(', 'function normalizeTaggedOutputTranslations(');
const route=Function(...Object.keys(env),routingCode+'\nreturn requestScopedOutputTranslations;')(...Object.values(env));
for(const count of [1,2,3])for(const mode of ['ordinary','compressed','extreme']){
 Object.assign(settings,{developerOutputSplitCount:count,developerCompressedPromptEnabled:mode==='compressed',developerExtremeCompressedPromptEnabled:mode==='extreme'});
 requests=[];const map=await route(segmented,{}, {speakerIdentity:identity,oneTimeInstruction:'ONE_TIME'});
 assert.equal(requests.length,count);assert.equal(map.size,segmented.segments.length);
 assert.deepEqual(requests.flatMap(r=>r.segments),segmented.segments);
 for(const row of requests){
  // Compare the actual transmitted prompt with the original builder. No flavor,
  // register, profanity, one-time request or compression policy is rewritten.
  const tokens=segmented.nameTokens.filter(t=>row.segments.some(s=>s.text.includes(t.token)));
  assert.equal(row.prompt,core.buildOutputPrompt({...segmented,segments:row.segments,nameTokens:tokens},settings,'ONE_TIME',identity,null,{}));
  assert.equal(row.options.splitRequest===true,count>1);
 }
}
// Developer OFF retains the split choice and both now-general strong flavors.
settings.developerMode=false;settings.dialogueEndingRepetitionReduction=false;requests=[];await route(segmented,{},{});assert.equal(requests.length,3);
for(const row of requests)assert.ok(row.prompt.includes("KIM HONG-JIN VOICE")&&row.prompt.includes("MANDATORY REAUTHORING"));
settings.developerMode=true;
// Speaker-specific rules share one prompt per split instead of duplicating the
// same source in narration/TARGET/OTHER requests.
Object.assign(settings,{developerMadKoreanOutputEnabled:false,developerHongjinFlavorEnabled:false,
 developerCompressedPromptEnabled:false,developerExtremeCompressedPromptEnabled:false,
 dialoguePromptEnabled:true,dialoguePrompt:'TARGET_SENTINEL',otherDialoguePromptEnabled:true,otherDialoguePrompt:'OTHER_SENTINEL',developerOutputSplitCount:3});
const scopes=Object.fromEntries(segmented.segments.filter(s=>s.type==='dialogue_candidate').map((s,i)=>[s.id,i===0?'target_dialogue':'other_dialogue']));
requests=[];await route(segmented,scopes,{speakerIdentity:identity});
assert.equal(requests.length,3);
assert.deepEqual(requests.flatMap(row=>row.segments),segmented.segments);
for(const row of requests){
 assert.ok(row.prompt.includes('TARGET_SENTINEL'));
 assert.ok(row.prompt.includes('OTHER_SENTINEL'));
 assert.equal(row.options.splitRequest,true);
 for(const s of row.segments){
  if(s.type==='dialogue_candidate')assert.ok(row.prompt.includes(`"speaker_scope":"${scopes[s.id]}"`));
 }
}
// Real whole-output pipeline: planning runs once for the whole message and the
// dormant post-translation audit makes no call; only the main translation is divided.
Object.assign(settings,{developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true,developerMinimalPromptEnabled:false});
let planned=0,audited=0;
const fullEnv={...env, ...core, minimalOutputEnabled,translateMinimalOutput,
 POST_TRANSLATION_AI_REPAIR_ENABLED:false,
 normalizedCharacterNameLocks:()=>[{source:'Hong-jin',target:'홍진'}],
 planRepeatedRoleTermLocks:async s=>{planned++;assert.equal(s.segments.length,segmented.segments.length);return [];},
 inferLocalTargetDialogueScopes:core.inferLocalTargetDialogueScopes,requestScopedOutputTranslations:route,
 repairRepeatedRoleTermConsistency:async()=>{},repairProtectedTokenIntegrity:async()=>{},
 findBannedWords:()=>[],findUntranslatedSegments:()=>[],repairIndivisibleIdentityNames:t=>t,repairKoreanParticleAlternatives:t=>t,
 runExperimentalQualityAudit:async({segmented:s})=>{audited++;assert.equal(s.segments.length,segmented.segments.length);},
 buildSourceMap:(_s,_t,result)=>[{start:0,end:result.length}],console};
const full=Function(...Object.keys(fullEnv),between('function normalizeTaggedOutputTranslations(', 'async function repairSegmentsByOutputScope(')+between('async function translateOutputText(', 'function inputIdentitySpellingContext(')+'\nreturn translateOutputText;')(...Object.values(fullEnv));
requests=[];const fullResult=await full(source,{speakerIdentity:identity});
assert.equal(requests.length,3);assert.equal(planned,1);assert.equal(audited,0);
assert.match(fullResult.translation,/홍진/);assert.match(fullResult.translation,/`CODE_UNCHANGED`/);assert.match(fullResult.translation,/<Info_panel>/);
// Minimal uses ONLY its own prompt regardless of the independent split setting.
for(const count of [1,2,3]){
 settings.developerMinimalPromptEnabled=true;settings.developerOutputSplitCount=count;requests=[];
 await full(source,{});assert.equal(requests.length,count);
 for(const r of requests)assert.ok(!r.prompt.includes('HONGJIN'));
}
// Three real queue tasks start together. Fourth waits until a slot is freed.
const queue=createSplitRequestQueue(3);let starts=0;const release=[];
const queued=Array.from({length:4},()=>queue(()=>{starts++;return new Promise(resolve=>release.push(resolve));}));
await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,3);
release[1]();await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,4);
release[0]();release[2]();release[3]();await Promise.all(queued);
// Three-part merge stays in source order even when completions are reversed.
let resolvers=[];const work=runOutputBatches(segmented,3,{},(ss,opts)=>new Promise(resolve=>{
 assert.equal(opts.splitBatchCount,3);resolvers.push(()=>resolve(new Map(ss.map(s=>[s.id,s.text]))));
}));assert.equal(resolvers.length,3);resolvers.reverse().forEach(resolve=>resolve());
assert.deepEqual([...await work].map(([id])=>id),segmented.segments.map(s=>s.id));
// Cancelling or failing one job aborts all three branches, never merging partial data.
for(const fail of [false,true]){
 const ctrl=new AbortController();let stops=0;
 const pending=runOutputBatches(segmented,3,{signal:ctrl.signal},(_s,opts)=>{
  if(fail&&opts.splitBatchIndex===1)return Promise.reject(Error('FAILED'));
  return new Promise((_r,reject)=>opts.signal.addEventListener('abort',()=>{stops++;reject(new DOMException('cancel','AbortError'));},{once:true}));
 });
 if(!fail)ctrl.abort();await assert.rejects(pending,fail?/FAILED/:{name:'AbortError'});assert.equal(stops,fail?2:3);
}
// Independent UI control changes only split count, persists and remains gated.
class Select{}
let saved=0;
const handler=Function('target','settings','HTMLSelectElement','saveSettings','document','renderCurrentAppliedRules',between("        if (target.id === 'verba-developer-output-split-count'", "        if (target.id === 'verba-developer-minimal-prompt-enabled'"));
const before=structuredClone(settings);
for(const value of ['1','2','3']){
 handler(Object.assign(new Select(),{id:'verba-developer-output-split-count',value}),settings,Select,()=>saved++,{querySelector:()=>null},()=>{});
 assert.deepEqual(settings,{...before,developerOutputSplitCount:Number(value)});
}
assert.equal(saved,3);
const disable=between("        if (target.closest('#verba-developer-mode-off')) {",'            saveSettings();').split('\n').slice(1).join('\n');
Function('settings',disable)(settings);assert.equal(outputSplitCount(settings),3);assert.equal(settings.developerOutputSplitCount,3);
const markup=Function('settings','escapeHtml','baseTranslationEditorMarkup','lastQualityAuditSummary',defs+between('function developerFlavorSettingsMarkup(', 'function syncDeveloperQualityControls(')+'\nreturn generalSplitSettingsMarkup()+generalRelationshipSettingsMarkup();');
assert.ok(markup(settings,String,()=>'', '').includes('verba-developer-output-split-count'));
settings.developerMode=true;assert.match(markup(settings,String,()=>'', ''),/value="3" selected/);
console.log('PASS: independent 1/2/3 split gate, full coverage, unified speaker-scoped prompts, whole-output local attribution/planning/checks, minimal combinations, 3-request concurrency, order, cancellation/failure and UI.');
