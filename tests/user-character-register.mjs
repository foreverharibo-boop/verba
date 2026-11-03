import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { userToCharacterRegisterRule, effectiveMadUserRegister } from '../user-character-register.js';
import { createCharacterTranslationReference } from '../character-translation-reference.js';
const identity={characterName:'Morgan',userName:'Alex'};
const source='Alex said to Morgan, "Wait for me."';
const segmented=core.segmentSource(source);
const base={developerRelationshipExperimentEnabled:true,developerUserToTargetRegister:'jondaetmal'};
const marker=/USER-TO-CHARACTER SPEECH REGISTER/;

test('late character availability unlocks textarea on settings interaction without resetting active typing',async()=>{
 let active=null;const events={};const inputEvents={};let value='',writes=0,label='',statusWrites=0;
 const input={disabled:false,get value(){return value},set value(v){value=v;writes++},addEventListener:(k,f)=>inputEvents[k]=f};
 const status={get textContent(){return label},set textContent(v){label=v;statusWrites++}};
 const character={avatar:'one.png',name:'One',data:{extensions:{ref:'saved'}}};
 const context={characters:[character],writeExtensionField:async()=>{}};
 const ref={context,character,characterId:0};
 const store=createCharacterTranslationReference({fieldKey:'ref',currentReference:()=>active,notify:()=>assert.fail('save failed'),delay:10000});
 store.bind({querySelector:s=>s==='[data-translation-reference]'?input:status,addEventListener:(k,f)=>events[k]=f});
 assert.equal(input.disabled,true);
 active=ref;events.pointerdown();assert.equal(input.disabled,false);assert.equal(input.value,'saved');
 input.value='한글 입력 중';inputEvents.input();events.focusin();
 const counts=[writes,statusWrites];store.refresh();events.toggle();
 assert.deepEqual([writes,statusWrites],counts);assert.equal(input.value,'한글 입력 중');
 await store.flush(ref);assert.equal(character.data.extensions.ref,'한글 입력 중');
 active=null;store.refresh();active=ref;events.toggle();assert.equal(input.disabled,false);assert.equal(input.value,'한글 입력 중');
});

test('new register is opt-in, scoped to USER dialogue, and leaves input alone',()=>{
 for(const setting of [{},{...base,developerRelationshipExperimentEnabled:false},{...base,developerUserToTargetRegister:'unset'}])
  assert.doesNotMatch(core.buildOutputPrompt(segmented,setting,'',identity),marker);
 for(const enabled of [false,true])for(const register of ['banmal','jondaetmal']){
  const settings={...base,developerDeepseekKoreanEnabled:enabled,developerUserToTargetRegister:register};
  const prompt=core.buildOutputPrompt(segmented,settings,'',identity);
  assert.match(prompt,marker);assert.ok(prompt.includes(`USER→TARGET=${register.toUpperCase()}`));
  assert.match(prompt,/USER confirmed as speaker and TARGET CHARACTER confirmed as listener/);
  assert.match(prompt,/NPC dialogue, USER→other people/);
  assert.doesNotMatch(core.buildInputPrompt('기다려',settings,'unknown',identity),marker);
  for(const scope of ['mixed','dialogue_mixed','other_dialogue','narration','target_dialogue','tagged_content','inner_info']){
   const p=core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings,speakerIdentity:identity,scope});
   assert.equal(marker.test(p),['mixed','dialogue_mixed','other_dialogue'].includes(scope),scope);
  }
 }
});

test('selection prompts respect dialogue boundaries and edited custom prompts retain live setting',()=>{
 for(const translation of ['그는 기다렸다.','"기다려."']){
  const options={source,translation,selected:translation,start:0,end:translation.length,settings:base,speakerIdentity:identity,selections:[{id:'multi_0000',start:0,end:translation.length,selected:translation}]};
  assert.equal(marker.test(core.buildSelectionPrompt(options)),translation.startsWith('"'));
  assert.equal(marker.test(core.buildMultiSelectionPrompt(options)),translation.startsWith('"'));
 }
 const prompt=core.buildOutputPrompt(segmented,{...base,customTranslatorEnabled:true,customTranslatorTemplates:{output:'MY_CUSTOM_RULE'},customTranslatorModified:{output:true}},'',identity);
 assert.match(prompt,/MY_CUSTOM_RULE/);assert.match(prompt,marker);
});

test('MAD explicit USER setting overrides legacy pair lock; Galbwae exclusivity is retained',()=>{
 assert.equal(effectiveMadUserRegister({developerMadKoreanUserToTargetRegister:'banmal'}),'banmal');
 const settings={...base,developerMadKoreanOutputEnabled:true,developerMadKoreanUserToTargetRegister:'banmal'};
 assert.equal(effectiveMadUserRegister(settings),'jondaetmal');
 const prompt=core.buildOutputPrompt(segmented,settings,'',identity);
 assert.match(prompt,/USER→TARGET=JONDAETMAL/);assert.doesNotMatch(prompt,/USER→TARGET=BANMAL/);
 assert.equal(userToCharacterRegisterRule({...base,developerMode:true,chuseokGalbwaeScope:'all'},identity),'');
 assert.doesNotMatch(core.buildOutputPrompt(segmented,{...base,developerMode:true,chuseokGalbwaeScope:'all'},'',identity),marker);
});

test('new control is normalized, snapshotted, restored and persisted from its own select',()=>{
 const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
 for(const expected of ["developerUserToTargetRegister: 'unset'",'raw.developerUserToTargetRegister','developerUserToTargetRegister: source.developerUserToTargetRegister','settings.developerUserToTargetRegister = next.developerUserToTargetRegister','USER → 캐릭터'])assert.ok(index.includes(expected),expected);
 assert.match(index,/target\.id === '[^']+-developer-user-target-register'[\s\S]*?settings\.developerUserToTargetRegister[\s\S]*?saveSettings\(\)/);
});

test('USER to OTHER is independent, opt-in, output-only and scoped',()=>{
 const otherMarker=/USER-TO-OTHER SPEECH REGISTER/;
 for(const target of ['unset','banmal','jondaetmal'])for(const other of ['unset','banmal','jondaetmal']){
  const settings={...base,developerUserToTargetRegister:target,developerUserToOtherRegister:other};
  const prompt=core.buildOutputPrompt(segmented,settings,'',identity);
  assert.equal(marker.test(prompt),target!=='unset');
  assert.equal(otherMarker.test(prompt),other!=='unset');
  if(other!=='unset') {
   assert.ok(prompt.includes(`USER→OTHER=${other.toUpperCase()}`));
   assert.match(prompt,/OTHER means an NPC\/addressee, not an NPC speaking/);
   assert.match(prompt,/Never treat an unknown listener as OTHER by default/);
  }
  assert.doesNotMatch(core.buildInputPrompt('기다려',settings,'unknown',identity),otherMarker);
  assert.doesNotMatch(core.buildOutputPrompt(segmented,{...settings,developerRelationshipExperimentEnabled:false},'',identity),otherMarker);
  for(const scope of ['mixed','dialogue_mixed','other_dialogue','target_dialogue','narration','tagged_content']){
   const p=core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings,speakerIdentity:identity,scope});
   assert.equal(otherMarker.test(p),other!=='unset'&&['mixed','dialogue_mixed','other_dialogue'].includes(scope));
  }
 }
});

test('OTHER register reaches selection and custom prompts but does not override MAD pair register or Galbwae',()=>{
 const settings={...base,developerUserToTargetRegister:'unset',developerUserToOtherRegister:'jondaetmal',developerMadKoreanUserToTargetRegister:'banmal'};
 assert.equal(effectiveMadUserRegister(settings),'banmal');
 const options={source,translation:'"기다려."',selected:'기다려',start:1,end:4,settings,speakerIdentity:identity,selections:[{id:'multi_0000',start:1,end:4,selected:'기다려'}]};
 for(const prompt of [core.buildSelectionPrompt(options),core.buildMultiSelectionPrompt(options),core.buildOutputPrompt(segmented,{...settings,customTranslatorEnabled:true,customTranslatorTemplates:{output:'MY_CUSTOM_RULE'},customTranslatorModified:{output:true}},'',identity)]) assert.match(prompt,/USER→OTHER=JONDAETMAL/);
 assert.equal(userToCharacterRegisterRule({...settings,developerMode:true,chuseokGalbwaeScope:'all'},identity),'');
 const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
 for(const expected of ["developerUserToOtherRegister: 'unset'",'raw.developerUserToOtherRegister','developerUserToOtherRegister: source.developerUserToOtherRegister','settings.developerUserToOtherRegister = next.developerUserToOtherRegister','USER → 타인(NPC)'])assert.ok(index.includes(expected),expected);
});
