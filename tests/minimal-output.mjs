import assert from 'node:assert/strict';
import fs from 'node:fs';
import { minimalOutputEnabled, buildMinimalOutputPrompt, translateMinimalOutput } from '../minimal-output.js';
import { splitOutputSegments } from '../output-splitting.js';
const splitMinimalOutputSegments = segmented => splitOutputSegments(segmented, 2);
import { segmentSource, restoreProtected, assembleTranslation, buildOutputPrompt } from '../core.js';
import { collectSegmentResponse } from '../response-parser.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
const buildSourceMap=Function('restoreProtected', between('function escapeRegularExpression(', 'function repairIndivisibleIdentityNames(') + between('function hasKoreanFinalConsonant(', 'function outputScopeForSegment(') + between('function restoredSegmentText(', 'const CONSISTENCY_ROLE_TERMS')+'\nreturn buildSourceMap;')(restoreProtected);
const settings={developerMode:true,developerOutputSplitCount:2,developerMinimalPromptEnabled:true,developerMinimalPrompt:'자연스럽게 한국어로 번역하라.',
 developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true,developerExtremeCompressedPromptEnabled:true,
 qualityAuditEnabled:true,developerRelationshipExperimentEnabled:true,globalPrompt:'GLOBAL_SENTINEL',dialoguePrompt:'VOICE_SENTINEL',bannedWords:'번역'};
for (const dev of [false,true]) for (const toggle of [false,true]) assert.equal(minimalOutputEnabled({...settings,developerMode:dev,developerMinimalPromptEnabled:toggle}),dev&&toggle);
const segmented=segmentSource('Hong-jin waited. "Come here."\n\n`KEEP_CODE`\n\n<Info_panel>[Weather: Sunny]</Info_panel>',[{source:'Hong-jin',target:'홍진'}]);
const p=buildMinimalOutputPrompt(segmented.segments,settings,segmented.nameTokens,'짧게 써줘.');
assert.match(p,/짧게 써줘/);assert.match(p,/홍진/);
assert.ok(!p.includes('KEEP_CODE'));
for(const forbidden of ['GLOBAL_SENTINEL','VOICE_SENTINEL','MAD KOREAN','HONGJIN FLAVOR','BANNED','FINE TUNING','SPEAKER ATTRIBUTION','TAGGED-CONTENT']) assert.ok(!p.includes(forbidden),forbidden);
assert.ok(buildMinimalOutputPrompt([], {...settings,developerMinimalPrompt:'  '}).startsWith('자연스럽게 한국어로 번역하라.'));
assert.ok(buildMinimalOutputPrompt([], {...settings,developerMinimalPrompt:'</textarea> TEST'}).startsWith('</textarea> TEST'));
let calls=[];
function translated(segment){
 const tokens=segment.text.match(/@@VERBA[A-Z0-9_]*@@/g)||[];
 return segment.type==='tagged_content'?'[날씨: 맑음]':`번역 ${tokens.join(' ')} 끝`;
}
const requestSegments=async(prompt,segments,opts)=>{
 calls.push({prompt,segments,opts});
 const raw=JSON.stringify({segments:segments.map(s=>({id:s.id,translation:translated(s)}))});
 const parsed=collectSegmentResponse(raw,segments);assert.equal(parsed.parseError,null);return parsed.partial;
};
const before=structuredClone(settings);
const result=await translateMinimalOutput(segmented,settings,{}, {requestSegments,buildSourceMap});
assert.equal(calls.length,2);assert.ok(calls.every(c=>c.opts.parallelRequest));assert.match(result.translation,/홍진/);assert.match(result.translation,/`KEEP_CODE`/);assert.match(result.translation,/<Info_panel>/);
assert.ok(result.sourceMap.length>0);assert.ok(result.sourceMap.some(r=>r.source.includes('Hong-jin')));
for(const row of result.sourceMap) assert.ok(result.translation.slice(row.start,row.end));
assert.deepEqual(settings,before);
for(const count of [1,2,3]){
 calls=[];
 const merged=await translateMinimalOutput(segmented,{...settings,developerOutputSplitCount:count},{},{requestSegments,buildSourceMap});
 assert.equal(calls.length,count);
 assert.equal(merged.translation,result.translation);assert.deepEqual(merged.sourceMap,result.sourceMap);
}

// Actual entry point must branch before any optional planning, classification,
// banned-word repair or quality audit, even when all those options are enabled.
const route=Function('settings','normalizedCharacterNameLocks','segmentSource','minimalOutputEnabled','translateMinimalOutput','requestSegments','buildSourceMap','planRepeatedRoleTermLocks',between('async function translateOutputText(', 'function inputIdentitySpellingContext(')+'\nreturn translateOutputText;');
const run=route(settings,()=>[],segmentSource,minimalOutputEnabled,translateMinimalOutput,requestSegments,buildSourceMap,()=>{throw Error('NORMAL_PATH');});
calls=[];await run('He waited.');assert.equal(calls.length,1);
settings.developerMode=false;await assert.rejects(run('He waited.'),/NORMAL_PATH/);settings.developerMode=true;
settings.developerMinimalPromptEnabled=false;await assert.rejects(run('He waited.'),/NORMAL_PATH/);settings.developerMinimalPromptEnabled=true;
// Protect-token repair stays minimal and only retries the affected target.
let attempts=0;const damaged=segmentSource('Hong-jin waited.\n\nShe nodded.',[{source:'Hong-jin',target:'홍진'}]);
await translateMinimalOutput(damaged,settings,{}, {buildSourceMap,requestSegments:async(prompt,segments,opts)=>{
 attempts++;assert.ok(!prompt.includes('HONGJIN FLAVOR'));
 if(opts.stage!=='protected-token-repair')return new Map(segments.map(s=>[s.id,'기다렸다.']));
 assert.equal(opts.stage,'protected-token-repair');assert.equal(segments.length,1);
 return new Map(segments.map(s=>[s.id,translated(s)]));
}});assert.equal(attempts,3);
attempts=0;await assert.rejects(translateMinimalOutput(damaged,settings,{}, {buildSourceMap,requestSegments:async(_p,ss)=>{attempts++;return new Map(ss.map(s=>[s.id,'누락']));}}),/보호 요소/);assert.equal(attempts,7);
const controller=new AbortController();controller.abort();calls=[];
await assert.rejects(translateMinimalOutput(segmented,settings,{signal:controller.signal},{requestSegments,buildSourceMap}),{name:'AbortError'});assert.equal(calls.length,0);
// Existing local newline cleanup and offsets still agree after assembly.
const prose=segmentSource('She spilled coffee.');
const cleaned=await translateMinimalOutput(prose,settings,{}, {requestSegments:async(_p,ss)=>new Map(ss.map(s=>[s.id,'커피를 엎질\n\n렀다.'])),buildSourceMap});
assert.equal(cleaned.translation,'커피를 엎질렀다.');assert.equal(cleaned.sourceMap[0].end,cleaned.translation.length);
// Two contiguous, non-overlapping groups, intact paragraph/target boundaries.
assert.deepEqual(splitMinimalOutputSegments({segments:[],parts:[]}),[]);
assert.equal(splitMinimalOutputSegments(prose).length,1);
const split=splitMinimalOutputSegments(segmented);
assert.deepEqual(split.flat(),segmented.segments);
const balanced=segmentSource('First paragraph has some narration. "First dialogue."\n\nSecond paragraph also has narration. "Second dialogue."');
const halves=splitMinimalOutputSegments(balanced);
assert.equal(halves[0].at(-1).type,'dialogue_candidate');
assert.equal(halves[1][0].type,'narration');
// With a single paragraph, still split at a target boundary (never inside a word).
assert.equal(splitMinimalOutputSegments(segmentSource('He waited. "Here."')).length,2);
// Completion order must not change assembly or source offsets.
let releases=[], received=[];
const inFlight=translateMinimalOutput(balanced,settings,{oneTimeInstruction:'KEEP_ONETIME'}, {
 buildSourceMap, requestSegments:(prompt,ss,opts)=>{
  assert.equal(opts.parallelRequest,true);assert.equal(opts.splitBatchCount,2);
  assert.match(prompt,/KEEP_ONETIME/);received.push(ss);
  return new Promise(resolve=>releases.push(()=>resolve(new Map(ss.map(x=>[x.id,`번역_${x.id}`])))));
 }});
assert.equal(releases.length,2,'both requests start before either completes');
releases[1]();await Promise.resolve();releases[0]();
const merged=await inFlight;
const expectedMap=new Map(balanced.segments.map(x=>[x.id,`번역_${x.id}`]));
assert.equal(merged.translation,assembleTranslation(balanced,expectedMap));
assert.deepEqual(merged.sourceMap,buildSourceMap(balanced,expectedMap,merged.translation));
assert.deepEqual(merged.sourceMap.map(row=>merged.translation.slice(row.start,row.end)),[...expectedMap.values()]);
// Abort both in-flight halves and do not build/apply any partial source map.
const cancel=new AbortController();let aborted=0,started=0;
const cancellation=translateMinimalOutput(balanced,settings,{signal:cancel.signal},{
 buildSourceMap:()=>{throw Error('partial result must not be applied');},
 requestSegments:(_p,_ss,opts)=>new Promise((_resolve,reject)=>{
  started++;opts.signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('cancel','AbortError'));},{once:true});
 })});
assert.equal(started,2);cancel.abort();await assert.rejects(cancellation,{name:'AbortError'});assert.equal(aborted,2);
// A terminal failure cancels the sibling instead of leaving an orphan request.
let siblingAborted=false;
await assert.rejects(translateMinimalOutput(balanced,settings,{}, {
 buildSourceMap:()=>{throw Error('partial result must not be applied');},
 requestSegments:(_p,_ss,opts)=>opts.splitBatchIndex===1?Promise.reject(Error('FINAL_FAILURE')):
 new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>{siblingAborted=true;reject(new DOMException('cancel','AbortError'));},{once:true}))
}),/FINAL_FAILURE/);assert.equal(siblingAborted,true);
calls=[];const codeOnly=segmentSource('```js\nconst n = 1;\n```');
await translateMinimalOutput(codeOnly,settings,{}, {requestSegments,buildSourceMap});assert.equal(calls.length,0);
const off={...settings,developerMode:false};
assert.equal(buildOutputPrompt(prose,off),buildOutputPrompt(prose,{...off,developerMinimalPromptEnabled:false}));
console.log('PASS: minimal-only prompt and actual entry path, lock/enable gates, optional call exclusion, name/code/tag preservation, source mapping, local cleanup, repair bounds and cancellation.');

// Real developer markup and delegated toggle, including escaped user text.
const defs=between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =');
const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const markup=Function('settings','escapeHtml','baseTranslationEditorMarkup','lastQualityAuditSummary',defs+'\n'+between('function developerFlavorSettingsMarkup(', 'function syncDeveloperQualityControls(')+'\nreturn developerSettingsMarkup();');
settings.developerMinimalPrompt='</textarea><script>TEST</script>';
assert.match(markup(settings,escapeHtml,()=>'', '', ''), /&lt;\/textarea&gt;/);
assert.ok(!markup({...settings,developerMode:false},escapeHtml,()=>'', '', '').includes('id="verba-developer-minimal-prompt"'));
class Input {}
let saves=0;
const change=Function('target','settings','HTMLInputElement','saveSettings','document','renderCurrentAppliedRules',between("        if (target.id === 'verba-developer-minimal-prompt-enabled'", "        if (target.id === 'verba-developer-compressed-prompt-enabled'"));
const preserved=structuredClone(settings);
for(const checked of [false,true]) {
 change(Object.assign(new Input(),{id:'verba-developer-minimal-prompt-enabled',checked}),settings,Input,()=>saves++,{querySelector:()=>null},()=>{});
 assert.deepEqual(settings,{...preserved,developerMinimalPromptEnabled:checked});
}
assert.equal(saves,2);
const disable=between("        if (target.closest('#verba-developer-mode-off')) {",'            saveSettings();').split('\n').slice(1).join('\n');
Function('settings',disable)(settings);
assert.equal(settings.developerMode,false);assert.equal(settings.developerMinimalPromptEnabled,false);
assert.equal(settings.developerMinimalPrompt,preserved.developerMinimalPrompt);
assert.equal(settings.developerMadKoreanOutputEnabled,true);assert.equal(settings.developerHongjinFlavorEnabled,true);
console.log('PASS: developer-only escaped UI, toggle restores saved settings, developer shutdown disables experiment but retains text/flavors.');
