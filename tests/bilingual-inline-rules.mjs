import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedPrompt } from './fixtures/bilingual-inline-rules.js';
import { classifyBilingualIntent } from '../bilingual-intent.js';
import { promptRequestsScope, bilingualScopeRequested } from '../output-format.js';
import { bilingualSettingsDiagnostic } from '../bilingual-diagnostics.js';
import { segmentSource, ensureBilingualDialogueFormat } from '../core.js';
import { planPostReview } from '../post-review.js';
const kinds = ['dialogue','narration','italic','bold','bracket','code','fenced'];
const scopes = p => kinds.filter(k => promptRequestsScope(p,k));
const settings = {developerMode:true,developerDeepseekKoreanEnabled:true,allDialoguePrompt:reportedPrompt,allDialoguePromptEnabled:true,aiPostReview:{english:true,bilingual:true}};

test('reported inline list grants only dialogue, as the identical multiline rules do',()=>{
 assert.equal(classifyBilingualIntent(reportedPrompt),'on');
 assert.deepEqual(scopes(reportedPrompt),['dialogue']);
 assert.deepEqual(scopes(reportedPrompt.replace('. - Keep','.\n- Keep')),['dialogue']);
});
test('sentence boundaries recognize same-line bullet and numbered rule starts',()=>{
 for(const marker of ['-','*','+','•','2.','2)']) {
  const positive = `- For dialogue, output both English and Korean text. ${marker} Keep narration in Korean only.`;
  assert.deepEqual(scopes(positive),['dialogue'],marker);
  assert.deepEqual(scopes(`- For narration, output both English and Korean text. ${marker} Keep dialogue in Korean only.`),['narration'],marker);
 }
});
test('explicit denial of dialogue still overrides its permission',()=>{
 assert.deepEqual(scopes(reportedPrompt+'\n- Do not use bilingual dialogue.'),[]);
 assert.deepEqual(scopes('For dialogue, output both English and Korean text. - Do not use bilingual dialogue.'),[]);
});
test('bullet boundaries alone cannot grant bilingual permission',()=>{
 for(const p of ['- Preserve the original meaning. - Keep narration in Korean only.',
 '- Do not create bilingual dialogue. - Do not create bilingual narration.',
 '- Bilingual output is optional. - Keep narration in Korean only.']) assert.deepEqual(scopes(p),[]);
});
test('disabled slot and exclusive Korean modes still block dialogue',()=>{
 for(const extra of [{allDialoguePromptEnabled:false},{developerMadKoreanOutputEnabled:true},{chuseokGalbwaeEnabled:true,chuseokGalbwaeScope:'all'}]) {
  const s={...settings,...extra};for(const kind of kinds)assert.equal(bilingualScopeRequested(s,kind),false);
 }
});
test('diagnostics reflect the reported prompt as dialogue-only',()=>{
 const result=bilingualSettingsDiagnostic(settings);
 assert.deepEqual(Object.entries(result.effectiveScopes).filter(([,v])=>v).map(([k])=>k),['dialogue']);
 assert.equal(result.slots.allDialogue.requested.dialogue,true);
});
test('outside-parenthesis model output is placed inside one quote pair exactly once',()=>{
 const segment=segmentSource('"Wait here."').segments[0];
 for(const value of ['"Wait here." (여기서 기다려.)','"여기서 기다려."','"Wait here. (여기서 기다려.)"']) {
  const actual=ensureBilingualDialogueFormat(segment,value,settings);
  assert.equal(actual,'"Wait here. (여기서 기다려.)"');
  assert.equal(ensureBilingualDialogueFormat(segment,actual,settings),actual);
 }
});
test('reported prompt reaches bilingual post-review without enrolling narration',()=>{
 const data=segmentSource('"Wait here."\n\nHe waited.');
 const values=new Map(data.segments.map(s=>[s.id,s.type==='dialogue_candidate'?'"Wait here. (여기서 기다려.)"':'그가 기다렸다.']));
 const plan=planPostReview(data,values,settings);
 const pairs=plan.units.filter(u=>u.type==='bilingual');
 assert.equal(pairs.length,1);assert.ok(pairs[0].checks.includes('bilingual'));
 assert.ok(plan.units.filter(u=>u.scope==='narration').every(u=>!u.checks.includes('bilingual')));
});
