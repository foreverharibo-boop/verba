import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { reconcileCompletedResult,describeSourceChange,compatibleCompletedSource } from '../server-result-compat.js';
const code=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const body=code.slice(code.indexOf('async function translateMessage('),code.indexOf('function latestAssistantMessage('));
const noop=()=>{};
async function applyCase({before,after,oldSwipe=0,newSwipe=0,changeChat=false,translation='번역문',refreshBeforeResolve=false}) {
 let finish,requestOptions;const response=new Promise(r=>finish=r),applied=[],scheduled=[],diagnostics=[],errors=[];
 const message={mes:before,swipe_id:oldSwipe};let chat=[message];
 const env={reconcileCompletedResult,compatibleCompletedSource,executionTrace:{trace:noop},traceSourceForMessage:noop,sourceChangeTracer:{compare:noop},EXTENSION_KEY:'verba',isTranslationExtensionActive:()=>true,activateTranslationExtension:noop,
  settings:{autoOutput:true,translationEngine:'google-free'},liveContext:()=>({chat}),isNameReplacementMessage:()=>true,
  messageSource:m=>m?.mes||'',currentSwipeId:m=>m?.swipe_id??null,isPredominantlyKorean:()=>false,hasForeignText:()=>true,currentRecord:()=>null,
  pendingOutputs:new Map(),failedOutputSignatures:new Map(),automaticOutputLifecycle:{started:noop},performance,AbortController,
  activeProfileSlot:()=> 'A',minimalOutputEnabled:()=>false,outputSplitCount:()=>1,hashText:x=>x,showProgress:noop,clearProgress:noop,
  outputTiming:{begin:()=>({}),applying:noop,finish:noop},previousUserSource:()=>'',recentDialogueEndingRepeatHints:()=>[],outputSpeakerIdentity:()=>({}),
  translateOutputText:(_source,options)=>{requestOptions=options;return response;},translationWithLockedSegments:r=>r,normalizeBilingualMappedTranslation:(translation,sourceMap)=>({translation,sourceMap}),
  applyTranslation:(id,m,source,translated)=>{applied.push({id,source,translated});return{renderResult:{status:'applied'}};},
  clearTransientTranslationSelections:noop,notify:noop,refreshRetranslateButton:noop,renderOutputTiming:noop,recordOutputTranslation:noop,
  scheduleAutomaticTranslation:(...args)=>scheduled.push(args),verbaServer:{noteSourceChange:(...args)=>diagnostics.push(args)},
  outputAbortReason:(verbaCode,message,silent)=>Object.assign(Error(message),{name:'AbortError',verbaCode,verbaDeepCode:verbaCode,silent}),
  isAbort:e=>e.name==='AbortError',reportError:(...args)=>errors.push(args),errorText:e=>e.message,console:{info:noop,error:noop,warn:noop}};
 vm.createContext(env);vm.runInContext(body,env);
 const pending=env.translateMessage(0,{automatic:true});message.mes=after;message.swipe_id=newSwipe;if(changeChat)chat=[{...message}];
 if(refreshBeforeResolve)requestOptions.refreshSource();
 finish({translation,sourceMap:[]});const success=await pending;
 assert.equal(errors.length,0,JSON.stringify(errors));return{success,applied,scheduled,diagnostics};
}
test('real message application accepts ST first-swipe initialization and harmless edge cleanup',async()=>{
 for(const row of [{before:'Hello',after:'Hello',oldSwipe:null,newSwipe:0},{before:'Hello\r\nworld  ',after:'Hello\nworld',oldSwipe:null,newSwipe:0}]){
  const f=await applyCase(row);assert.equal(f.success,true);assert.equal(f.applied[0].source,row.after);assert.equal(f.scheduled.length,0);
 }
});
test('closed Archive state cleanup while awaiting result applies completed translation without a retry',async()=>{
 const f=await applyCase({before:'Hello\n<archive-now>1: here</archive-now>',after:'Hello',translation:'안녕\n<archive-now>1: 여기</archive-now>'});
 assert.equal(f.success,true);assert.equal(f.applied[0].translated,'안녕');assert.equal(f.scheduled.length,0);
});
test('actual rewrite, different swipe or chat must still reject stale application',async()=>{
 for(const row of [{before:'Hello old',after:'Hello new'},{before:'Hello',after:'Hello',newSwipe:1},{before:'Hello',after:'Hello',changeChat:true}]){
  const f=await applyCase(row);assert.equal(f.success,false);assert.equal(f.applied.length,0);assert.equal(f.scheduled.length,row.changeChat?0:1);
 }
});
test('tag cleanup rebases selection maps and never strips unknown or unclosed tags',()=>{
 const before='First<archive-now>state</archive-now>Second',after='FirstSecond';
 const translation='첫째<archive-now>상태</archive-now>둘째';const start=translation.indexOf('둘째');
 const result=reconcileCompletedResult(before,after,{translation,sourceMap:[{id:'first',source:'First',start:0,end:2},{id:'state',source:'state',start:2,end:start},{id:'second',source:'Second',start,end:start+2}]});
 assert.equal(result.translation,'첫째둘째');assert.deepEqual(result.sourceMap.map(r=>[r.start,r.end]),[[0,2],[2,4]]);
 for(const [original,final] of [['Hello <archive-now>actual prose','Hello'],['Hello <other>prose</other>','Hello'],['Hello <archive-now>state</archive-now>','Changed'],['Hello secret tail','Hello']])assert.equal(reconcileCompletedResult(original,final,{translation:'안녕'}),null);
 assert.equal(reconcileCompletedResult(before,after,{translation:'첫째<archive-now>unclosed'}),null);
});
test('source difference diagnostics classify truncation without retaining message text',()=>{
 const detail=describeSourceChange('private reply secret tail','private reply');
 assert.equal(detail.relation,'tail-removed');assert.equal(detail.beforeLength,25);assert.equal(detail.afterLength,13);
 assert(!JSON.stringify(detail).includes('private'));assert(!JSON.stringify(detail).includes('secret'));
});

test('refreshing the live message during server reuse updates the apply snapshot without a retry',async()=>{
 const f=await applyCase({before:'Hello\n<sfw_scene>state</sfw_scene>\n<Info_panel>info</Info_panel>',
  after:'Hello\n\n<Info_panel>info</Info_panel>',translation:'안녕\n\n<Info_panel>정보</Info_panel>',refreshBeforeResolve:true});
 assert.equal(f.success,true);
 assert.equal(f.applied[0].source,'Hello\n\n<Info_panel>info</Info_panel>');
 assert.equal(f.applied[0].translated,'안녕\n\n<Info_panel>정보</Info_panel>');
 assert.equal(f.scheduled.length,0);
});
test('live refresh never adopts a real rewrite, another chat or another swipe',async()=>{
 for(const row of [{before:'Hello old',after:'Hello new'},
  {before:'Hello<state>hidden</state>',after:'Hello',newSwipe:1},
  {before:'Hello<state>hidden</state>',after:'Hello',changeChat:true}]) {
  const f=await applyCase({...row,refreshBeforeResolve:true});
  assert.equal(f.success,false);
  assert.equal(f.applied.length,0);
 }
});
