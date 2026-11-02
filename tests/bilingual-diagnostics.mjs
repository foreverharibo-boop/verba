import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, ensureBilingualDialogueFormat } from '../core.js';
import { bilingualSettingsDiagnostic, sanitizeBilingualSettings, outputBinding } from '../bilingual-diagnostics.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';
import { planPostReview } from '../post-review.js';
const settings={allDialoguePrompt:'대사 한영병기',allDialoguePromptEnabled:true};

test('received instructions, enabled state and exclusive-mode denial are distinct',()=>{
 const active=bilingualSettingsDiagnostic(settings);
 assert.equal(active.slots.allDialogue.requested.dialogue,true);
 assert.equal(active.effectiveScopes.dialogue,true);
 const off=bilingualSettingsDiagnostic({...settings,allDialoguePromptEnabled:false});
 assert.equal(off.slots.allDialogue.requested.dialogue,true);
 assert.equal(off.effectiveScopes.dialogue,false);
 const mad=bilingualSettingsDiagnostic({...settings,developerMadKoreanOutputEnabled:true});
 assert.equal(mad.slots.allDialogue.enabled,true);
 assert.equal(mad.effectiveScopes.dialogue,false);
 assert.equal(mad.blocker,'mad-exclusive');
 assert.doesNotMatch(JSON.stringify(active),/대사 한영병기/);
});
test('assembly and exact requested-English loss, not merely Latin counts, are tracked',()=>{
 const data=segmentSource('He waited.\n\n"Stay quiet."');
 const d=data.segments.find(s=>s.type==='dialogue_candidate');
 const values=new Map(data.segments.map(s=>[s.id,s===d?'"조용히 있어."':'그는 기다렸다.']));
 const trace=createOutputComparison(data,true,settings,outputBinding('private source',{diagnosticMessageId:446,diagnosticSwipeId:0}));
 trace.initial(values);
 const before=values.get(d.id), after=ensureBilingualDialogueFormat(d,before,settings);
 values.set(d.id,after);trace.assemblyResult(d,before,after);trace.capture('dialogue-format',values);
 values.set(d.id,'"조용히 있어."');trace.capture('output-post-review',values);
 const report=trace.finish('그는 기다렸다.');
 assert.equal(report.segmentTypes.dialogue_candidate,1);
 assert.equal(report.dialogueAssembly.changed,1);
 assert.equal(report.stages.find(s=>s.stage==='output-post-review').bilingual.lostExpectedSourceTargets,1);
 assert.equal(report.binding.messageId,446);
 const summary=sanitizeOutputComparison(report,{summaryOnly:true});
 assert.equal(summary.stages[2].bilingual.rows.some(r=>r.lostExpectedSource),true);
 assert.doesNotMatch(JSON.stringify(summary),/private source|Stay quiet|조용히|대사 한영병기/);
});
test('tag exemption and excluded scope are reported without altering review planning',()=>{
 const data=segmentSource('<div>"Stay quiet."</div>\n\n"Wait here."');
 const values=new Map(data.segments.map(s=>[s.id,'"기다려."']));
 const trace=createOutputComparison(data,true,settings);trace.initial(values);
 const report=trace.finish('');
 assert.ok(report.stages[0].bilingual.reasons['tag-excluded']>0);
 assert.equal(planPostReview(data,values,settings).units.filter(u=>u.type==='bilingual').length,1);
});
test('sanitizers reject arbitrary provider/source content and preserve bounds',()=>{
 const safe=sanitizeBilingualSettings({slots:{allDialogue:{enabled:true,text:'SECRET',length:Infinity,requested:{dialogue:true,SECRET:true}}},blocker:'SECRET',modes:{SECRET:true}});
 const report=sanitizeOutputComparison({version:1,bilingualSettings:safe,binding:{jobKey:'SECRET',sourceHash:'SECRET /private'},segmentTypes:{narration:1,SECRET:99},dialogueAssembly:{visited:1,text:'SECRET'},stages:[{stage:'initial-parsed',bilingual:{reasons:{SECRET:4},rows:[{type:'SECRET',reason:'SECRET',text:'SECRET'}]}}]});
 assert.doesNotMatch(JSON.stringify(report),/SECRET|private/);
 assert.equal(report.binding.jobKey,null);
});
