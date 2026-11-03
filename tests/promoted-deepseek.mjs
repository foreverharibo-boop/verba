import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { deepseekKoreanEnabled, deepseekKoreanPrompt, DEEPSEEK_KOREAN_PROMPT } from '../deepseek-korean.js';
import { normalizeBaseTranslationCustom } from '../base-editor.js';
import { minimalOutputEnabled } from '../minimal-output.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const prefix=index.includes('id="verba-deep-deepseek-settings"')?'verba-deep':'verba';
const extract=(a,b)=>{const start=index.indexOf(a),end=index.indexOf(b,start);assert.ok(start>=0&&end>start,a);return index.slice(start,end);};
const defaults=core.customTranslationDefaults ? core.customTranslationDefaults() : (await import('../custom-translator-defaults.js')).buildDefaultCustomTranslatorTemplates();
const settings={developerMode:false,developerDeepseekKoreanEnabled:true,customTranslatorEnabled:true,customTranslatorTemplates:{deepseek:'CUSTOM_DEEPSEEK_SENTINEL'},customTranslatorModified:{deepseek:true},globalPrompt:'LIVE_GLOBAL_SENTINEL'};
const source='Alex waited. "Stay here."';
const segmented=core.segmentSource(source,[]);
const selection=s=>({source,sourceContext:source,translation:'알렉스는 기다렸다.',selected:'기다렸다.',start:5,end:10,settings:s,speakerIdentity:{characterName:'Alex',userName:'Sam'},oneTimeInstruction:'LIVE_ONCE_SENTINEL'});
const requests=s=>[
 core.buildOutputPrompt(segmented,s,'LIVE_ONCE_SENTINEL'),
 core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings:s,scope:'narration'}),
 core.buildSelectionPrompt(selection(s)),
 core.buildSelectionPrompt({...selection(s),candidateCount:3}),
 core.buildMultiSelectionPrompt({...selection(s),selections:[{id:'multi_0000',selected:'기다렸다.',start:5,end:10}]})
];
test('dedicated editor starts with the exact prompt and preserves saved edits/reset',()=>{
 assert.equal(defaults.deepseek,DEEPSEEK_KOREAN_PROMPT);
 const normalize=Function('CUSTOM_TRANSLATOR_SIMPLE_MARKER','CUSTOM_TRANSLATOR_PROMPT_DEFINITIONS','DEFAULT_CUSTOM_TRANSLATOR_TEMPLATES',extract('function normalizeCustomTranslatorInstruction(','const DEFAULT_SETTINGS =')+';return normalizeCustomTranslatorSettings;')('[사용자 추가 지침]',Object.keys(defaults).map(key=>({key})),defaults);
 const initial=normalize({},{});assert.equal(initial.templates.deepseek,DEEPSEEK_KOREAN_PROMPT);assert.equal(initial.modified.deepseek,false);
 const exact='  MY CUSTOM DEEPSEEK\r\n Keep my spaces.\n';const saved=normalize({deepseek:exact},{deepseek:true});
 assert.equal(saved.templates.deepseek,exact);assert.deepEqual(normalize(saved.templates,saved.modified),saved);
 const reset=normalize(saved.templates,{...saved.modified,deepseek:false});assert.equal(reset.templates.deepseek,DEEPSEEK_KOREAN_PROMPT);
});
test('all output and selection routes replace only dedicated prose, with independent switches',()=>{
 for(const prompt of requests(settings)) {
  assert.equal(prompt.split('CUSTOM_DEEPSEEK_SENTINEL').length-1,1);
  assert.ok(!prompt.includes(DEEPSEEK_KOREAN_PROMPT));
  assert.match(prompt,/ACTIVE SETTINGS PRECEDENCE/);assert.match(prompt,/LIVE_GLOBAL_SENTINEL/);
 }
 for(const extra of [{customTranslatorEnabled:false},{customTranslatorModified:{deepseek:false}},{customTranslatorTemplates:{deepseek:'  '}}]) {
  const s={...settings,...extra};assert.equal(deepseekKoreanPrompt(s),DEEPSEEK_KOREAN_PROMPT);
  for(const prompt of requests(s)) assert.ok(prompt.includes(DEEPSEEK_KOREAN_PROMPT));
 }
 for(const prompt of requests({...settings,developerDeepseekKoreanEnabled:false}))assert.doesNotMatch(prompt,/CUSTOM_DEEPSEEK_SENTINEL|HIGHEST-PRIORITY TRANSLATION PRINCIPLE/);
 assert.doesNotMatch(core.buildInputPrompt('안녕.',settings,'unknown',{}),/CUSTOM_DEEPSEEK_SENTINEL|HIGHEST-PRIORITY TRANSLATION PRINCIPLE/);
});
test('upgrading retires developer experiments without changing the saved DeepSeek choice',()=>{
 const migrate=Function('settings','normalizeBaseTranslationCustom',extract('// Retired developer experiments','settings.developerCompressedPromptEnabled ='));
 for(const enabled of [false,true]) {
  const s={developerMode:true,developerDeepseekKoreanEnabled:enabled,developerMinimalPromptEnabled:true,developerCompressedPromptEnabled:true,chuseokGalbwaeScope:'all',globalPrompt:'KEEP'};
  migrate(s,normalizeBaseTranslationCustom);assert.equal(s.developerMode,false);assert.equal(deepseekKoreanEnabled(s),enabled);assert.equal(minimalOutputEnabled(s),false);assert.equal(s.globalPrompt,'KEEP');
 }
});
test('public control is directly below relationship settings, plain and independent of developer mode',()=>{
 const markup=Function('settings',extract('function deepseekSettingsMarkup(','function syncDeveloperQualityControls(')+';return deepseekSettingsMarkup();');
 for(const developerMode of [false,true]) {
  const html=markup({...settings,developerMode});assert.ok(html.includes(`id="${prefix}-deepseek-enabled" checked`));
  assert.match(html,/<summary>딥식플 전용 프롬프트<\/summary>/);
  assert.doesNotMatch(html,/영어 번역 프롬프트|help|<pre|개발자/);
 }
 assert.match(index,/\$\{generalRelationshipSettingsMarkup\(\)\}\s*\$\{deepseekSettingsMarkup\(\)\}/);
 assert.ok(!index.includes('function developerSettingsMarkup('));assert.ok(!index.includes('activateDeveloperMode'));
 const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');assert.ok(css.includes(`.${prefix}-deepseek-settings {\n    border-style: solid !important;`));
});
