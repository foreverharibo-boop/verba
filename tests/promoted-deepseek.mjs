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
test('upgrade preserves DeepSeek and Galbwae but keeps retired developer experiments off',()=>{
 const migrate=Function('settings','normalizeBaseTranslationCustom','DEVELOPER_ACCESS_FINGERPRINT','DEFAULT_SETTINGS',extract('// Developer access now exposes only Galbwae','settings.qualityAuditMeaning ='));
 for(const enabled of [false,true]) for(const access of ['', 'current']) {
  const s={developerMode:true,developerAccessFingerprint:access,developerDeepseekKoreanEnabled:enabled,developerMinimalPromptEnabled:true,developerCompressedPromptEnabled:true,developerExtremeCompressedPromptEnabled:true,qualityAuditEnabled:true,baseTranslationCustom:{enabled:true,prompt:'KEEP CUSTOM'},chuseokGalbwaeScope:'all',globalPrompt:'KEEP'};
  migrate(s,normalizeBaseTranslationCustom,'current',{developerMinimalPrompt:'default'});
  assert.equal(s.developerMode,access==='current');assert.equal(deepseekKoreanEnabled(s),enabled);assert.equal(minimalOutputEnabled(s),false);assert.equal(s.globalPrompt,'KEEP');assert.equal(s.chuseokGalbwaeScope,'all');
  for(const key of ['developerCompressedPromptEnabled','developerExtremeCompressedPromptEnabled','qualityAuditEnabled']) assert.equal(s[key],false);
  assert.equal(s.baseTranslationCustom.enabled,false);assert.equal(s.baseTranslationCustom.prompt,'KEEP CUSTOM');
 }
});
test('public control is directly below relationship settings, plain and independent of developer mode',()=>{
 const markup=Function('settings',extract('function deepseekSettingsMarkup(','function syncDeveloperQualityControls(')+';return deepseekSettingsMarkup();');
 for(const developerMode of [false,true]) {
  const html=markup({...settings,developerMode});assert.ok(html.includes(`id="${prefix}-deepseek-enabled" checked`));
  assert.match(html,/<summary>딥식 플래시 전용 <small>전용 프롬프트<\/small><\/summary>/);
  assert.doesNotMatch(html,/영어 번역 프롬프트|help|<pre|개발자/);
 }
 assert.match(index,/\$\{generalRelationshipSettingsMarkup\(\)\}\s*\$\{deepseekSettingsMarkup\(\)\}/);
 assert.ok(index.includes('function developerSettingsMarkup('));
 const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');assert.ok(css.includes(`.${prefix}-deepseek-settings {\n    border-style: solid !important;`));
});

test('developer panel includes the dedicated review; disabling access does not disable initial DeepSeek translation',()=>{
 const render=Function('settings',extract('function developerChuseokGalbwaeMarkup(', 'function syncDeveloperQualityControls(')+';return developerSettingsMarkup();');
 const locked=render({developerMode:false});assert.match(locked,/id="verba-developer-code"/);assert.doesNotMatch(locked,/id="verba-chuseok-galbwae-all"/);
 const unlocked=render({developerMode:true,chuseokGalbwaeScope:'all'});assert.match(unlocked,/<summary>개발자 모드<\/summary>/);assert.match(unlocked,/id="verba-chuseok-galbwae-all" checked/);assert.match(unlocked,/id="verba-chuseok-galbwae-dialogue-inner"/);
 assert.doesNotMatch(unlocked,/최소 프롬프트|압축 프롬프트|기본 번역 편집/);
 const s={...settings,developerMode:true,chuseokGalbwaeScope:'all'};
 const shutdown=extract("        if (target.closest('#verba-developer-mode-off')) {",'            saveSettings();').split('\n').slice(1).join('\n');Function('settings',shutdown)(s);
 assert.equal(s.developerMode,false);assert.equal(s.developerDeepseekKoreanEnabled,true);assert.equal(s.chuseokGalbwaeScope,'all');
 class Input{};let saved=0;const branches=extract("        if (target.id === 'verba-chuseok-galbwae-all'", "        if (target.id === 'verba-english-flavor-conversation'");
 const change=Function('target','settings','HTMLInputElement','setCheckedValue','saveSettings','document','renderCurrentAppliedRules',branches);
 for(const [id,checked,expected] of [['all',true,'all'],['dialogue-inner',true,'dialogueInner'],['dialogue-inner',false,'off']]){
  change(Object.assign(new Input(),{id:'verba-chuseok-galbwae-'+id,checked}),s,Input,()=>{},()=>saved++,{querySelector:()=>null},()=>{});assert.equal(s.chuseokGalbwaeScope,expected);
 }
 assert.equal(saved,3);
 const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');assert.match(css,/\.verba-deepseek-settings > summary::after\s*\{\s*content: none;\s*display: none;/);
});
