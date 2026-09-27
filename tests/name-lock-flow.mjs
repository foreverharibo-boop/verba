import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const section=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
const evaluate=(source,env)=>Function(...Object.keys(env),source)(...Object.values(env));
const extra=(source,translation,sourceMap=[])=>({state:{source,sourceHash:source,translation,sourceMap}});
const chat=[{mes:'Dana waved to Nyen.',extra:extra('Dana waved to Nyen.','대나는 니옌에게 손을 흔들었다.'),swipe_id:0,swipes:['Dana waved to Nyen.',{mes:'Dana smiled.'}],swipe_info:[{extra:extra('Dana waved to Nyen.','대나는 니옌에게 손을 흔들었다.')},{extra:extra('Dana smiled.','데이너는 웃었다.')}]},{mes:'Nyon waited.',extra:extra('Nyon waited.','니욘은 기다렸다.')},{is_user:true,mes:'Dana',extra:extra('Dana','다나')}];
let sent='';let requestCount=0;
const env={liveContext:()=>({chat,name2:'Nyen'}),STATE_KEY:'state',storedTranslationView:(ex,source)=>ex?.state?.source===source?{record:ex.state,translation:ex.state.translation}:null,normalizedSourceMap:x=>Array.isArray(x)?structuredClone(x):[],hashText:x=>String(x),isPredominantlyKorean:x=>/[가-힣]/.test(String(x)),messageSource:m=>m.mes,settings:{},buildNameHistoryFormsPrompt:core.buildNameHistoryFormsPrompt,requestSegments:async(p)=>{sent=p;requestCount++;return new Map([['seg_0000','대나|||데이너|||NOT_IN_CANDIDATES']]);},replaceOutsideProtected:core.replaceOutsideProtected};
const history=evaluate(section('function sourceContainsExactName(','function replaceStoredNameInExtra(')+'\nreturn {collectHistoricalNameCandidates,detectHistoricalNameForms,countExactSourceName,safeLocalNameReplacement};',env);
const collected=history.collectHistoricalNameCandidates('Dana','데이나');
assert.equal(collected.contexts.length,2,'active and swipe evidence collected/deduplicated');
assert.ok(collected.candidates.includes('대나'));assert.ok(collected.candidates.includes('데이너'));
assert.ok(!collected.translations.includes('니욘은 기다렸다.'));
const forms=await history.detectHistoricalNameForms('Dana','데이나',[]);
assert.equal(requestCount,1);assert.deepEqual(forms,['데이나','대나','데이너']);
assert.match(sent,/ALIGNED EVIDENCE/);assert.match(sent,/Dana smiled/);assert.match(sent,/Different source spellings are different identities/);
for(const settings of [{},{developerMode:true,developerExtremeCompressedPromptEnabled:true}]) {
 const p=core.buildNameHistoryFormsPrompt({sourceName:'Dana',currentName:'데이나',candidates:collected.candidates,contexts:collected.contexts,settings});
 assert.match(p,/ALIGNED EVIDENCE/);assert.match(p,/Dana waved to Nyen/);assert.match(p,/데이너/);
}
assert.equal(history.countExactSourceName('Nyen Nyen2 xNyen Nyon NYEN','Nyen'),2);
assert.equal(history.safeLocalNameReplacement('Nyen waited. Nyon followed.','니옌은 기다렸다. 니옌은 따라왔다.','Nyen',['니옌']),false);

const flow=section('async function lockSelectionName(','async function retranslateSelection(');
async function run({local='Dana',profile='',ai=false,history=true,confirmed=['대나'],failAi=false,cancel=false}={}) {
 const message={mes:'Dana smiled. Dana waved.'};const snap={selected:'데이나',translation:'데이나가 웃었다. 데이나가 손을 흔들었다.',source:message.mes,start:0,end:3,messageId:0,swipeId:0,message};
 const state={requests:0,lookups:0,confirmations:0,saved:[],applied:0,history:null,warnings:[]};
 const e={settings:{profileId:profile,translationEngine:'ai'},currentCharacterReference:()=>({character:{}}),notify:(m)=>state.warnings.push(m),selectionStillCurrent:()=>true,hideSelectionButton:()=>{},showProgress:()=>1,clearProgress:()=>{},selectionNameMatchContext:s=>s,resolveSelectionSourceNameLocally:()=>local,requireAiEngineForFeature:()=>true,buildNameMatchPrompt:()=> 'NAME_MATCH',requestSegments:async()=>{state.requests++;return new Map([['seg_0000','Dana']]);},resolveExactSourceName:(_,v)=>v,normalizedCharacterNameLocks:()=>[{source:'Dana',target:'데이나'}],requestNameLockTarget:async(_,__,options)=>{assert.equal(options.canUseAiHistory,!!profile);return cancel?null:{targetName:'다나',replaceHistory:history,useAiHistory:ai};},detectHistoricalNameForms:async()=>{state.lookups++;if(failAi)throw new Error('mock lookup failed');return ['데이나','대나','데이너'];},requestDetectedNameFormsConfirmation:async(_,__,values)=>{state.confirmations++;assert.deepEqual(values,['대나','데이너']);return confirmed;},saveCharacterNameLock:async(...args)=>state.saved.push(args),renderNameLockManager:()=>{},liveContext:()=>({chat:[message]}),replaceNameInCurrentSnapshot:(_,sourceName,names)=>{state.currentNames=names;return {changed:true,translation:'다나가 웃었다. 다나가 손을 흔들었다.',sourceMap:[]};},applyTranslation:()=>state.applied++,replaceNameAcrossChatTranslations:(...args)=>{state.history=args;return {changedRecords:1,changedMessages:1};},isAbort:()=>false,reportError:(...args)=>{throw new Error('unexpected flow error '+args.join(' '));},console:{warn:()=>{},error:()=>{}}};
 await evaluate('let selectionBusy=false,selectionSnapshot=null;\n'+flow+'\nreturn lockSelectionName;',e)(snap);
 return state;
}
const local=await run();assert.equal(local.requests,0);assert.equal(local.lookups,0);assert.deepEqual(local.saved,[['Dana','다나']]);assert.equal(local.applied,1);assert.deepEqual(local.history[1],['데이나']);
const ai=await run({profile:'profile',ai:true});assert.equal(ai.lookups,1);assert.equal(ai.confirmations,1);assert.deepEqual(ai.history[1],['데이나','대나']);assert.ok(!ai.currentNames.includes('데이너'),'unchecked form is not applied');
const declined=await run({profile:'profile',ai:true,confirmed:[]});assert.deepEqual(declined.history[1],['데이나']);
const failed=await run({profile:'profile',ai:true,failAi:true});assert.deepEqual(failed.history[1],['데이나']);assert.ok(failed.warnings.some(x=>x.includes('AI 과거 표기 탐색에 실패')));
const noHistory=await run({history:false});assert.equal(noHistory.history,null);assert.equal(noHistory.lookups,0);
const missing=await run({local:'',profile:''});assert.equal(missing.saved.length,0);assert.equal(missing.requests,0);
const fallback=await run({local:'',profile:'profile'});assert.equal(fallback.requests,1);assert.equal(fallback.saved.length,1);
const cancelled=await run({cancel:true});assert.equal(cancelled.saved.length,0);assert.equal(cancelled.applied,0);

// Exercise the actual popup controls (default OFF, history dependency, confirm).
class Element {setAttribute(){}; addEventListener(type,fn){this.events??={};this.events[type]=fn;} remove(){this.removed=true;} focus(){} select(){}}
const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
node('#verba-name-lock-target').value='다나';node('#verba-name-lock-history').checked=true;node('#verba-name-lock-ai-history').checked=false;
const overlay=new Element();overlay.querySelector=node;
const popup=evaluate(section('function requestNameLockTarget(','function sourceContainsExactName(')+'\nreturn requestNameLockTarget;',{document:{querySelector:()=>null,createElement:()=>overlay,documentElement:{append(){}}},HTMLElement:Element,escapeHtml:String,requestAnimationFrame:f=>f(),notify:()=>{}});
const pending=popup('Dana','데이나',{canUseAiHistory:true});assert.equal(node('#verba-name-lock-ai-history').checked,false);assert.equal(node('#verba-name-lock-ai-history').disabled,false);
node('#verba-name-lock-ai-history').checked=true;node('#verba-name-lock-history').checked=false;node('#verba-name-lock-history').events.change();assert.equal(node('#verba-name-lock-ai-history').checked,false);assert.equal(node('#verba-name-lock-ai-history').disabled,true);
node('.verba-submit').events.click();assert.deepEqual(await pending,{targetName:'다나',replaceHistory:false,useAiHistory:false});
console.log('PASS: swipe evidence collection, exact identity, optional API flow, checked forms only, failure/cancel handling and popup controls.');
