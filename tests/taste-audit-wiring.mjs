import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runTasteQualityAudit } from '../taste-audit.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const slice=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
const segmented={protectedText:'He waited.',segments:[{id:'n',type:'narration',text:'He waited.'}],nameTokens:[]};
for(const enabled of [false,true]) {
 let requests=0;
 const env={settings:{developerMadKoreanOutputEnabled:true},POST_TRANSLATION_AI_REPAIR_ENABLED:enabled,
 normalizedCharacterNameLocks:()=>[],segmentSource:()=>segmented,minimalOutputEnabled:()=>false,planRepeatedRoleTermLocks:async()=>[],
 requestScopedOutputTranslations:async()=>new Map([['n','기다렸다.']]),inferLocalTargetDialogueScopes:()=>({}),normalizeTaggedOutputTranslations:(_,x)=>x,
 findBannedWords:()=>[],findUntranslatedSegments:()=>[],repairRepeatedRoleTermConsistency:async()=>{},repairProtectedTokenIntegrity:async()=>{},
 repairKoreanParticleAlternatives:x=>x,repairIndivisibleIdentityNames:x=>x,runExperimentalQualityAudit:async()=>{},runTasteQualityAudit,
 requestSegments:async(p,rows,o)=>{requests++;assert.equal(o.stage,'taste-mad-audit');return new Map([['n','그는 기다렸다.']]);},
 assembleTranslation:(_,map)=>map.get('n'),buildSourceMap:()=>[],console:{warn:()=>{}}};
 const translate=Function(...Object.keys(env),slice('async function translateOutputText(','function inputIdentitySpellingContext(')+'\nreturn translateOutputText;')(...Object.values(env));
 const result=await translate('He waited.');assert.equal(requests,enabled?1:0);assert.equal(result.translation,enabled?'그는 기다렸다.':'기다렸다.');
}
const sync=Function('POST_TRANSLATION_AI_REPAIR_ENABLED',slice('function syncDeveloperQualityControls(','function refreshSettingsPanelForDeveloperMode(')+';return syncDeveloperQualityControls;')(false);
const check={disabled:false};const master={checked:true};const root={querySelector:key=>key==='#verba-quality-audit-enabled'?master:key==='#verba-quality-audit-controls'?{classList:{toggle(){}},querySelectorAll:()=>[check]}:null};sync(root);assert.equal(check.disabled,true);assert.equal(master.checked,true,'saved preference retained');
const markup=index.slice(index.indexOf('id="verba-quality-audit-enabled"'),index.indexOf('id="verba-quality-audit-controls"'));
assert.match(markup,/POST_TRANSLATION_AI_REPAIR_ENABLED/);assert.match(markup,/disabled/);assert.match(markup,/일반·미친 한출·김홍진 AI 후검수가 모두 꺼져/);
console.log('PASS: real output entry point makes zero audit calls when OFF and applies a mock audit when deliberately enabled; UI shows disabled without resetting saved preferences.');
