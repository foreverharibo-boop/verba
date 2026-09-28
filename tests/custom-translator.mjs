import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import {buildMinimalOutputPrompt, translateMinimalOutput} from '../minimal-output.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const slice=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
const api=Function('customTranslationDefaults',slice('const RELATION_TEMPERATURE_OPTIONS','const baseContext =')+`
return { defaults: DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES, visible: CUSTOM_TRANSLATOR_VISIBLE_KEYS,
 normalize: normalizeCustomTranslatorSettings, normalizeText: normalizeCustomTranslatorInstruction,
 normalizeGalbwae: normalizedChuseokGalbwaeScope, defs: CUSTOM_TRANSLATOR_PROMPT_DEFINITIONS };`)(core.customTranslationDefaults);
const {defaults,normalize}=api;
assert.deepEqual(api.visible,['output','input','selection','mad','hongjin']);
for(const key of api.visible) {
 assert.ok(defaults[key].length>80,key);
 assert.doesNotMatch(defaults[key],/JSON|NAME LOCK|TARGET CHARACTER|TARGET dialogue only|within each id|LEFT|RIGHT|@@VERBA|PAIR SPEECH LOCK/);
}
assert.match(defaults.output,/Translate into fluent, idiomatic Korean/);
assert.match(defaults.mad,/NARRATION: easy-to-read modern Korean fiction/);
assert.match(defaults.hongjin,/KIM HONG-JIN VOICE/);
assert.doesNotMatch(defaults.hongjin,/MAD KOREAN|Translate into fluent/);
assert.doesNotMatch(defaults.mad,/KIM HONG-JIN/);
const exact='  My custom rules.\r\n{기본_프롬프트} [사용자 추가 지침] literal\n ';
const saved=normalize({output:exact,flavor:exact,name:'saved internal custom'},{output:true,flavor:true,name:true});
assert.equal(saved.templates.output,exact);
for(const key of ['flavor','mad','hongjin']) {assert.equal(saved.templates[key],exact);assert.equal(saved.modified[key],true);}
assert.equal(saved.templates.name,'saved internal custom');
assert.deepEqual(normalize(saved.templates,saved.modified),saved,'migration idempotent');
assert.equal(normalize({output:'Old default'},{output:false}).templates.output,defaults.output);
assert.equal(normalize({output:'Old custom'},{}).templates.output,'Old custom');
assert.equal(normalize({flavor:'Old combined'},{}).templates.hongjin,'Old combined');
assert.equal(normalize({flavor:'Old default'},{flavor:false}).templates.mad,defaults.mad);
const reset=normalize({...saved.templates,mad:defaults.mad},{...saved.modified,mad:false});
assert.equal(reset.modified.mad,false);assert.equal(reset.templates.hongjin,exact);
const settings={developerMode:true,customTranslatorEnabled:true,customTranslatorTemplates:{...defaults,output:'CUSTOM_OUTPUT',input:'CUSTOM_INPUT',selection:'CUSTOM_SELECTION',mad:'CUSTOM_MAD',hongjin:'CUSTOM_HONGJIN'},customTranslatorModified:Object.fromEntries(api.visible.map(k=>[k,true])),globalPrompt:'GLOBAL_SENTINEL',allDialoguePrompt:'ALL_SENTINEL',dialoguePrompt:'TARGET_SENTINEL',otherDialoguePrompt:'OTHER_SENTINEL',bannedWords:'금지어',relationTemperature:'intimate',dialogueEndingPreferred:'~거든',developerHongjinProfanity:'high',developerHongjinOppaFrequency:'often',developerMadKoreanTargetToUserRegister:'banmal'};
const identity={characterName:'Nyen',userName:'Dana',characterGender:'male',nameLocks:[{source:'Nyen',target:'니엔'}],exactNamePairs:[{korean:'니엔',english:'Nyen'}]};
const source='Nyen smiled. "Hello, Dana."\n<Info_panel>Sunny</Info_panel>';
const segmented=core.segmentSource(source,identity.nameLocks);
const output=s=>core.buildOutputPrompt(segmented,s,'ONCE_SENTINEL',identity,null,{seg_0001:'target_dialogue'});
const prompt=output(settings);
for(const text of ['CUSTOM_OUTPUT','GLOBAL_SENTINEL','ALL_SENTINEL','TARGET_SENTINEL','OTHER_SENTINEL','ONCE_SENTINEL','NAME LOCK','니엔','Dana','male','intimate','금지어','SPEAKER ROUTING','JSON only','SEGMENTS']) assert.ok(prompt.includes(text),text);
assert.equal(prompt.split('CUSTOM_OUTPUT').length-1,1);
assert.doesNotMatch(prompt,/CUSTOM_INPUT|CUSTOM_SELECTION|CUSTOM_MAD|CUSTOM_HONGJIN|Translate into fluent, idiomatic Korean/);
const payload=JSON.parse(prompt.split('\nSEGMENTS\n')[1]);assert.equal(payload.length,segmented.segments.length);assert.equal(payload[0].text,segmented.segments[0].text);
for(const mode of [{},{developerMode:true,developerCompressedPromptEnabled:true},{developerMode:true,developerExtremeCompressedPromptEnabled:true}]) assert.match(output({...settings,...mode}),/CUSTOM_OUTPUT/);
const input=core.buildInputPrompt('니엔, 이리 와.',settings,'male',identity);
for(const text of ['CUSTOM_INPUT','Addressee gender=male','Nyen','니엔','SOURCE','JSON only','Korean USER input to English']) assert.ok(input.includes(text),text);
assert.doesNotMatch(input,/CUSTOM_OUTPUT|GLOBAL_SENTINEL|CUSTOM_HONGJIN/);
const translation='니엔은 웃었다. "안녕, 다나."';const start=translation.indexOf('안녕');
const options={source,translation,selected:'안녕',start,end:start+2,settings,oneTimeInstruction:'ONCE_SENTINEL',speakerIdentity:identity};
for(const count of [1,3]) {
 const p=core.buildSelectionPrompt({...options,candidateCount:count});
 for(const text of ['CUSTOM_SELECTION','NAME LOCK','GLOBAL_SENTINEL','ONCE_SENTINEL','ORIGINAL SOURCE','EXISTING KOREAN','LEFT','SELECTED','RIGHT','안녕']) assert.ok(p.includes(text),text);
 assert.equal(p.split('CUSTOM_SELECTION').length-1,1);
 assert.ok(p.includes(count===3?'candidate_3':'"segments"'));
 assert.doesNotMatch(p,/CUSTOM_OUTPUT/);
}
const multi=core.buildMultiSelectionPrompt({...options,selections:[{id:'multi_0000',selected:'안녕',start,end:start+2}]});
assert.match(multi,/CUSTOM_SELECTION/);assert.match(multi,/in_dialogue/);assert.match(multi,/source_context/);assert.match(multi,/multi_0000/);
for(const mad of [false,true]) for(const hongjin of [false,true]) {
 const s={...settings,developerMadKoreanOutputEnabled:mad,developerHongjinFlavorEnabled:hongjin};const p=output(s);
 assert.equal(p.includes('CUSTOM_MAD'),mad);assert.equal(p.includes('CUSTOM_HONGJIN'),hongjin);assert.equal(p.includes('CUSTOM_OUTPUT'),!mad);
 if(mad){assert.match(p,/PAIR SPEECH LOCK: TARGET→USER=반말/);assert.doesNotMatch(p,/GLOBAL_SENTINEL/);}
 if(hongjin){assert.match(p,/profanity=high/);assert.match(p,/오빠: frequent/);assert.equal(p.split('CUSTOM_HONGJIN').length-1,1);}
 for(const scope of ['narration','tagged_content','other_dialogue','target_dialogue']) {
  const scoped=core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings:s,scope,speakerIdentity:identity,nameTokens:segmented.nameTokens});
  assert.equal(scoped.includes('CUSTOM_HONGJIN'),hongjin&&scope==='target_dialogue',scope);
 }
}
for(const scope of ['all','dialogueInner']) {
 const s={...settings,chuseokGalbwaeScope:scope,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true};
 const p=output(s);assert.match(p,/EXCLUSIVE GALBWAE/);assert.doesNotMatch(p,/CUSTOM_OUTPUT|CUSTOM_MAD|CUSTOM_HONGJIN/);assert.match(p,/NAME LOCK/);
 assert.match(core.buildInputPrompt('안녕',s,'male',identity),/CUSTOM_INPUT/);
}
const minimal=buildMinimalOutputPrompt(segmented.segments,settings,segmented.nameTokens,'ONCE');
assert.match(minimal,/CUSTOM_OUTPUT/);assert.match(minimal,/Name tokens/);assert.match(minimal,/JSON only/);assert.match(minimal,/ONCE/);
let sentMinimal='';await translateMinimalOutput(segmented,{...settings,developerOutputSplitCount:1},{signal:new AbortController().signal},{requestSegments:async(p,rows)=>{sentMinimal=p;return new Map(rows.map(x=>[x.id,'번역']));},buildSourceMap:()=>[]});assert.match(sentMinimal,/CUSTOM_OUTPUT/);
const transport=Function('settings','normalizedChuseokGalbwaeScope',slice('function customTranslatorPromptKey(','function sendProfileRaceAttempt(')+'\nreturn applyCustomTranslatorPrompt;')(settings,api.normalizeGalbwae);
for(const stage of ['output-translation','input-translation','selection-candidates','connection-test']) assert.equal(transport(prompt,{stage}),prompt,'transport must retain full composition');
settings.customTranslatorTemplates.repair='LEGACY_REPAIR';settings.customTranslatorModified.repair=true;
const repair=transport('CURRENT_TRANSLATION\nDETECTED_PROBLEM\nRESPONSE_SCHEMA',{stage:'banned-word-repair'});for(const text of ['LEGACY_REPAIR','CURRENT_TRANSLATION','DETECTED_PROBLEM','RESPONSE_SCHEMA'])assert.ok(repair.includes(text));
settings.chuseokGalbwaeScope='all';assert.equal(transport('GALBWAE REPAIR',{stage:'untranslated-repair'}),'GALBWAE REPAIR');
const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const render=Function('settings','CUSTOM_TRANSLATOR_PROMPT_DEFINITIONS','CUSTOM_TRANSLATOR_VISIBLE_KEYS','escapeHtml',slice('function customTranslatorInstructionPlaceholder(','function syncCustomTranslatorControls(')+'\nreturn customTranslatorSettingsMarkup();');
const html=render(settings,api.defs,api.visible,escapeHtml);
assert.equal((html.match(/data-verba-custom-translator-key=/g)||[]).length,5);
for(const key of ['name','consistency','repair','quality','flavor','other'])assert.ok(!html.includes(`data-verba-custom-translator-key="${key}"`));
for(const label of ['채팅 번역','내가 보내는 글','선택한 부분 다시 번역','미친 한출의 맛','김홍진의 맛'])assert.ok(html.includes(label));
assert.match(html,/자동으로 조립/);assert.doesNotMatch(html,/프롬프트를 완전히 대체/);
console.log('PASS: five editors, original prose, exact migration/reload, separate scoped tastes, live rules/data, candidates, minimal pipeline and transport.');
