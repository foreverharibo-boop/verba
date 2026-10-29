import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, assembleTranslation, buildOutputPrompt, buildScopedOutputPrompt, buildInputPrompt, bilingualDialogueRequested, ensureBilingualDialogueFormat, findUntranslatedSegments, buildUntranslatedRepairPrompt } from '../core.js';
import { englishReviewTargets, reviewEnglishLeftovers } from '../english-review.js';
import { bilingualScopeRequested } from '../output-format.js';

const marked = 'Any span in the source marked with italics (*...*), backticks (`...`), or square brackets ([...]) is a protected zone. Copy the English inside the marker exactly as written, then add the Korean translation once inside a pair of square brackets directly after the English, and close the original marker after it. Required formats: *English text [한국어 번역]*, `English text [한국어 번역]`, and [English text 한국어 번역]. Everything outside marked spans is translated into Korean only, with no English kept.';
const custom = (prompt=marked) => ({customTranslatorEnabled:true,customTranslatorModified:{output:true},customTranslatorTemplates:{output:prompt}});
const seg = (source, enabled=true) => segmentSource(source, [], {translateTaggedContent:enabled});

test('custom chat translation authorizes marked scopes, not every dialogue/narration', () => {
 const s=custom();
 for(const kind of ['italic','code','bracket']) assert.equal(bilingualScopeRequested(s,kind),true,kind);
 for(const kind of ['bold','dialogue','narration']) assert.equal(bilingualScopeRequested(s,kind),false,kind);
 assert.equal(bilingualDialogueRequested(s),false);
 const row=seg('"Stay here."').segments[0];
 assert.equal(ensureBilingualDialogueFormat(row,'"여기 있어."',s),'"여기 있어."');
});
test('explicit custom dialogue request supports the existing dialogue formatter',()=>{
 const s=custom('For dialogue only, always output both the original English dialogue and its Korean translation.');
 assert.equal(bilingualDialogueRequested(s),true);
 assert.match(ensureBilingualDialogueFormat(seg('"Stay here."').segments[0],'"여기 있어."',s),/Stay here/);
 assert.equal(bilingualScopeRequested(s,'narration'),false);
});
test('disabled/default/unrelated custom slots cannot authorize bilingual output',()=>{
 for(const s of [{},{...custom(),customTranslatorEnabled:false},{...custom(),customTranslatorModified:{output:false}},
 {customTranslatorEnabled:true,customTranslatorTemplates:{input:marked,selection:marked,quality:marked}},
 {dialoguePrompt:marked,otherDialoguePrompt:marked},custom('Never use bilingual output. Translate into Korean only.')]) {
 for(const kind of ['code','italic','bracket','dialogue']) assert.equal(bilingualScopeRequested(s,kind),false);
 }
 assert.equal(bilingualScopeRequested({allDialoguePrompt:'Always output bilingual dialogue.'},'code'),false);
});
test('ordinary code and real tags are separate, including nested backticks and HTML code tags',()=>{
 assert.equal(seg('`Stay here.`').segments[0].type,'code_content');
 for(const source of ['<small>`Stay here.`</small>','<code>Stay here.</code>','```html\n<div>Stay here.</div>\n```']){
 assert.equal(seg(source).segments[0].type,'tagged_content');
 assert.equal(seg(source,false).segments.length,0);
 assert.equal(assembleTranslation(seg(source,false),new Map()),source);
 }
 assert.equal(seg('`Stay here.`',false).segments.length,1);
});
test('requested bilingual marked text survives English review without skipping Korean-half leftovers',()=>{
 for(const [source,translation] of [['*Stay here.*','*Stay here. [여기 있어.]*'],['[Stay here.]','[Stay here. 여기 있어.]'],['`Stay here.`','Stay here. [여기 있어.]'],['**Stay here.**','**Stay here. [여기 있어.]**']]){
 const settings=source.startsWith('**')?custom('Inside bold spans, always output both English and Korean text.'):custom();
 const data=seg(source), map=new Map([[data.segments[0].id,translation]]);
 assert.equal(englishReviewTargets(data,map,{},settings).length,0,source);
 assert.equal(findUntranslatedSegments(data.segments,map,settings).length,0,source);
 const mixed=translation.replace('여기 있어.', '여기 quietly 있어.');
 assert.deepEqual(englishReviewTargets(data,new Map([[data.segments[0].id,mixed]]),{},settings).map(x=>x.text),['quietly']);
 }
});
test('plain untranslated English is still caught even with a bilingual request',()=>{
 for(const source of ['*Stay right here and wait for me.*','`Stay right here and wait for me.`']) {
 const data=seg(source),map=new Map(data.segments.map(x=>[x.id,x.text]));
 assert.ok(englishReviewTargets(data,map,{},custom()).length);
 assert.ok(findUntranslatedSegments(data.segments,map,custom()).length);
 }
});
test('only confirmed source spans are exempt; unrequested/narrative/changed copies stay reviewable',()=>{
 for(const [source,text,settings] of [['*Stay here.*','*Stay here. [여기 있어.]*',{}],['Stay here.','Stay here. 원문 그대로 있어.',custom()],['*Stay here.*','*Stay there. [여기 있어.]*',custom()]]){
 const data=seg(source);
 assert.ok(englishReviewTargets(data,new Map([[data.segments[0].id,text]]),{},settings).length);
 }
});
test('tagged text never gains English-review exemption from custom/global prompts',()=>{
 const data=seg('<Info_panel>[Thought: Stay here.]</Info_panel>');
 const map=new Map([[data.segments[0].id,'[생각: Stay here. [여기 있어.]]']]);
 assert.ok(englishReviewTargets(data,map,{},custom()).length);
 const prompt=buildOutputPrompt(data,custom());
 assert.match(prompt,/ABSOLUTE TAG EXCEPTION/);
 assert.match(prompt,/field count\/order/);
});
test('assembly retains original wrappers, code syntax and line breaks',()=>{
 const source='*Stay here.*\r\n\r\n`Stay here.`\r\n[Stay here.]\r\n```json\r\n{"message":"Stay here.","id":"KEEP_CODE"}\r\n```';
 const data=seg(source);const map=new Map(data.segments.map(x=>[x.id,x.text.startsWith('*')?'*Stay here. [여기 있어.]*':x.text.startsWith('[')?'[Stay here. 여기 있어.]':'Stay here. [여기 있어.]']));
 const out=assembleTranslation(data,map);
 assert.match(out,/\*Stay here\. \[여기 있어\.\]\*/);
 assert.match(out,/`Stay here\. \[여기 있어\.\]`/);
 assert.equal(out.split('\r\n').length,source.split('\r\n').length);
 assert.equal(JSON.parse(out.match(/```json\r\n([^]*?)\r\n```/)[1]).id,'KEEP_CODE');
});
test('review edits only accidental English and keeps intentional source unchanged',async()=>{
 const data=seg('*Stay here.*');const map=new Map([[data.segments[0].id,'*Stay here. [여기 quietly 있어.]*']]);
 let calls=0;
 await reviewEnglishLeftovers({segmented:data,translations:map,settings:custom(),request:async(_prompt,targets)=>{
 calls++;assert.deepEqual(targets.map(x=>x.text),['quietly']);return new Map(targets.map(x=>[x.id,'조용히']));}});
 assert.equal(calls,1);assert.equal(map.get(data.segments[0].id),'*Stay here. [여기 조용히 있어.]*');
});
test('output, scoped output and repair carry custom authority; input is isolated',()=>{
 const s=custom(), data=seg('`Stay here.`');
 for(const prompt of [buildOutputPrompt(data,s),buildScopedOutputPrompt({segments:data.segments,sourceContext:'`Stay here.`',settings:s,scope:'narration'}),buildUntranslatedRepairPrompt(data.segments,new Map(),s)]) {
 assert.match(prompt,/CUSTOM OUTPUT/);assert.match(prompt,/ABSOLUTE TAG EXCEPTION/);
 assert.match(prompt,/code_content/);
 }
 assert.equal(buildInputPrompt('여기 있어.',s),buildInputPrompt('여기 있어.',{}));
});

test('inline instructions never authorize fences; explicit fence requests do',()=>{
 const settings=custom();
 assert.equal(bilingualScopeRequested(settings,'code'),true);
 assert.equal(bilingualScopeRequested(settings,'fenced'),false);
 const onlyFence=custom('Inside triple backticks, always output both English and Korean text.');
 assert.equal(bilingualScopeRequested(onlyFence,'fenced'),true);
 assert.equal(bilingualScopeRequested(onlyFence,'code'),false);
 assert.equal(bilingualScopeRequested(custom('For all text, always output both English and Korean text.'),'fenced'),true);
 for(const [source,kind] of [['`Stay quiet.`','inline'],['```\nStay quiet.\n```','fenced'],['~~~text\nStay quiet.\n~~~','fenced'],['```json\n{"message":"Stay quiet."}\n```','fenced']]){
  const d=seg(source), row=d.segments[0];assert.equal(row.codeKind,kind);
  const map=new Map([[row.id,'Stay quiet. [조용히 있어.]']]);
  assert.equal(englishReviewTargets(d,map,{},settings).some(x=>x.text.includes('Stay quiet')),kind==='fenced');
  if(kind==='fenced')assert.equal(englishReviewTargets(d,map,{},onlyFence).length,0);
  assert.match(buildOutputPrompt(d,settings),new RegExp('"code_kind"\\s*:\\s*"'+kind+'"'));
 }
});
