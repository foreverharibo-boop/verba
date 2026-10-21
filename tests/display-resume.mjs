import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const source=fs.readFileSync(root+'/index.js','utf8');
const {createAutomaticOutputLifecycle}=await import(pathToFileURL(root+'/automatic-output.js'));
const extract=name=>{const start=source.indexOf(`function ${name}(`);const end=source.indexOf('\nfunction ',start+1);assert(start>=0&&end>start);return source.slice(start,end);};
const record={sourceHash:'source',translation:'저장된 번역',swipeId:0};
const message={mes:'Original reply',extra:{verba:record,display_text:record.translation}};
const chat=[{},message];let renders=0,saves=0,sourceView=false,editing=false,owner=true;
const lifecycle=createAutomaticOutputLifecycle({getChat:()=>chat,signature:m=>m?.mes||''});
lifecycle.reset();lifecycle.complete(1);lifecycle.started(1);
const env={EXTENSION_KEY:'verba',STATE_KEY:'verba',SOURCE_VIEW_KEY:'sourceView',settings:{autoOutput:true},
 automaticOutputLifecycle:lifecycle,isTranslationExtensionActive:()=>owner,liveContext:()=>({chat}),
 currentRecord:m=>m?.extra?.verba,sourceViewRequested:()=>sourceView,showOriginalDisplay(){},
 sameTranslationRecord:(a,b)=>a===b,syncOwnedTranslationToCurrentSwipe:()=>false,
 updateMessageBlock:()=>renders++,cacheRenderedTranslation(){},scheduleChatSave:()=>saves++,
 startCompletedAutomaticOutput:()=>{throw Error('completed translation must not be submitted again');},
 document:{querySelector:()=>({querySelector:()=>editing?{}:null})},
};
vm.createContext(env);
for(const name of ['restoreCurrentDisplay','resumeAutomaticOutputs','inferredMessageId'])vm.runInContext(extract(name),env);
env.resumeAutomaticOutputs();assert.equal(renders,1,'resume must redraw even with correct display_text and started lifecycle');assert.equal(saves,0);
editing=true;env.resumeAutomaticOutputs();assert.equal(renders,1,'do not overwrite an open editor');editing=false;
sourceView=true;env.resumeAutomaticOutputs();assert.equal(renders,1,'respect user source view');sourceView=false;
owner=false;env.resumeAutomaticOutputs();assert.equal(renders,1);owner=true;
message.mes='A new swipe';env.resumeAutomaticOutputs();assert.equal(renders,1,'never restore a different source version');
assert.equal(env.inferredMessageId(message),1,'omitted id must resolve message rather than Number(null)=0');
console.log('PASS display resume, editor/source/owner/version guards, message identity');
