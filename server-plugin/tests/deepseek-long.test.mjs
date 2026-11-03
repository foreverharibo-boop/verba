import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../engines/verba-deep.mjs';
import { DEEPSEEK_KOREAN_PROMPT } from '../../deepseek-korean.js';
const settings={
 developerMode:true,developerDeepseekKoreanEnabled:true,developerMinimalPromptEnabled:true,developerMinimalPrompt:'MINIMAL_SENTINEL',
 profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,
 globalPromptEnabled:true,globalPrompt:'GLOBAL_SENTINEL',allDialoguePromptEnabled:true,allDialoguePrompt:'ALL_SENTINEL',
 dialoguePromptEnabled:true,dialoguePrompt:'TARGET_SENTINEL',otherDialoguePromptEnabled:true,otherDialoguePrompt:'OTHER_SENTINEL',
 englishFlavorEnabled:true,koreanFlavorEnabled:true,relationTemperatureEnabled:true,relationTemperature:'intimate',
 customTranslatorEnabled:true,customTranslatorTemplates:{output:'CUSTOM_OUTPUT_SENTINEL'},customTranslatorModified:{output:true},
 translateTaggedContent:true,aiPostReview:{},
};
const identity={characterName:'Chris',sourceCharacterName:'Chris',userName:'다나',sourceUserName:'Dana'};
const snapshot=s=>({settings:structuredClone(s),profiles:{A:{}},nameLocks:[{source:'Dana',target:'다나'}],character:{name:'Chris'},context:{name1:'Dana',name2:'Chris'}});
function answer(prompt){
 const rows=JSON.parse(prompt.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
 return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.type==='tagged_content'?'맑음':`${(row.text.match(/@@VERBA[^@]+@@/g)||[]).join(' ')} 기다렸다.`.trim()}))})};
}
test('long engine adds the exact released Verba baseline and retains settings/context with one request',async()=>{
 let calls=0;const original=snapshot(settings);
 const engine=createEngine(original,async(id,messages)=>{
  calls++;assert.equal(id,'A');assert.equal(messages.length,1);const p=messages[0].content;
  assert.ok(p.startsWith(DEEPSEEK_KOREAN_PROMPT));
  for(const m of ['GLOBAL_SENTINEL','ALL_SENTINEL','TARGET_SENTINEL','OTHER_SENTINEL','CUSTOM_OUTPUT_SENTINEL','ONETIME_SENTINEL','PREVIOUS_SENTINEL'])assert.ok(p.includes(m),m);
  assert.ok(!p.includes('MINIMAL_SENTINEL'));return answer(p);
 });
 const out=await engine.output('Dana waited.\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>',{oneTimeInstruction:'ONETIME_SENTINEL',previousUserSource:'PREVIOUS_SENTINEL',speakerIdentity:identity});
 assert.equal(calls,1);assert.match(out.translation,/다나/);assert.match(out.translation,/KEEP_CODE/);assert.match(out.translation,/<Info_panel>맑음<\/Info_panel>/);assert.deepEqual(original,snapshot(settings));
});
test('disabled DeepSeek toggle retains the ordinary engine',async()=>{
 for(const extra of [{developerDeepseekKoreanEnabled:false}]){
  let calls=0;const engine=createEngine(snapshot({...settings,...extra,developerMinimalPromptEnabled:false}),async(_id,messages)=>{
   calls++;assert.ok(!messages[0].content.includes(DEEPSEEK_KOREAN_PROMPT));return answer(messages[0].content);
  });
  const result=await engine.output('Dana waited.',{speakerIdentity:identity});assert.equal(calls,1);assert.match(result.translation,/다나/);
 }
});
test('input translation remains independent of the output experiment',async()=>{
 const prompts=[];
 for(const enabled of [false,true]){
  const engine=createEngine(snapshot({...settings,developerDeepseekKoreanEnabled:enabled}),async(_id,messages)=>{prompts.push(messages[0].content);return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'Hello.'}]})};});
  assert.equal(await engine.input('안녕.'),'Hello.');
 }
 assert.equal(prompts[0],prompts[1]);assert.ok(!prompts[0].includes(DEEPSEEK_KOREAN_PROMPT));
});
test('long engine keeps ordinary MAD Korean-only enforcement',async()=>{
 const engine=createEngine(snapshot({...settings,developerMadKoreanOutputEnabled:true,allDialoguePrompt:'대사 한영병기'}),async(_id,messages)=>{
  assert.ok(messages[0].content.startsWith(DEEPSEEK_KOREAN_PROMPT));assert.match(messages[0].content,/MAD KOREAN/);
  return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"Wait here. [여기서 기다려.]"'}]})};
 });
 const out=await engine.output('"Wait here."',{speakerIdentity:identity});assert.equal(out.translation,'"여기서 기다려."');
});
test('long engine keeps configured bilingual review and custom output format',async()=>{
 const s={...settings,aiPostReview:{bilingual:true},customTranslatorTemplates:{output:'For dialogue, preserve English and include Korean in square brackets: "English [한국어]".'}};
 let calls=0;const engine=createEngine(snapshot(s),async(_id,messages)=>{
  calls++;const p=messages[0].content;
  if(p.startsWith('UNIFIED OUTPUT POST REVIEW')){
   assert.match(p,/For dialogue, preserve English/);const rows=JSON.parse(p.split('\nREVIEW_UNITS\n').at(-1));assert.ok(rows.some(row=>row.checks.includes('bilingual')));
   return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:'"Wait here. [여기서 기다려.]"'}))})};
  }
  assert.ok(p.startsWith(DEEPSEEK_KOREAN_PROMPT));return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"여기서 기다려."'}]})};
 });
 const out=await engine.output('"Wait here."',{speakerIdentity:identity});assert.equal(calls,2);assert.match(out.translation,/Wait here/);assert.match(out.translation,/여기서 기다려/);
});
test('both bundled engine hashes match the manifest',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../engines/manifest.json',import.meta.url)));
 for(const variant of ['verba','verba-deep'])assert.equal(manifest.engines[variant].hash,createHash('sha256').update(fs.readFileSync(new URL(`../engines/${variant}.mjs`,import.meta.url))).digest('hex'));
});
