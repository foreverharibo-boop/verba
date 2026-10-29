import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deepseekKoreanEnabled, DEEPSEEK_KOREAN_PROMPT } from '../deepseek-korean.js';
import { buildMinimalOutputPrompt, translateMinimalOutput } from '../minimal-output.js';
import { segmentSource, buildOutputPrompt, buildSelectionPrompt, buildMultiSelectionPrompt, buildInputPrompt, normalizeBilingualMappedTranslation } from '../core.js';
import { createEngine } from '../server-plugin/engines/verba.mjs';

const settings = {
    developerMode:true, developerDeepseekKoreanEnabled:true,
    profileId:'A', activeProfileSlot:'A', autoProfileFallback:false, serverRetryLimit:1,
    developerMinimalPromptEnabled:true, developerMinimalPrompt:'MINIMAL_SENTINEL',
    customTranslatorEnabled:true,
    customTranslatorTemplates:Object.fromEntries(['output','selection','mad','hongjin','quality','repair','other'].map(key=>[key,`CUSTOM_${key}_SENTINEL`])),
    customTranslatorModified:Object.fromEntries(['output','selection','mad','hongjin','quality','repair','other'].map(key=>[key,true])),
    baseTranslationCustom:{enabled:true,prompt:'BASE_SENTINEL'},
    globalPromptEnabled:true, globalPrompt:'GLOBAL_SENTINEL', dialoguePromptEnabled:true, dialoguePrompt:'DIALOGUE_SENTINEL',
    allDialoguePromptEnabled:true, allDialoguePrompt:'Translate dialogue in English and Korean. BILINGUAL_SENTINEL',
    developerMadKoreanOutputEnabled:true, developerHongjinFlavorEnabled:true,
    developerExtremeCompressedPromptEnabled:true, developerRelationshipExperimentEnabled:true,
    developerTargetToUserAddress:'ADDRESS_SENTINEL', chuseokGalbwaeScope:'all',
    qualityAuditEnabled:true, finalEnglishReviewEnabled:true, englishReviewEnabled:true,
    bannedWords:'미소', translateTaggedContent:true,
};
const snapshot = () => ({settings:structuredClone(settings),profiles:{A:{}},nameLocks:[{source:'Dana',target:'다나'}],character:{name:'Chris'},context:{name1:'Dana',name2:'Chris'}});
const source = 'Dana smiled.\n\n"Come here."\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>';
const segmented = segmentSource(source,[{source:'Dana',target:'다나'}]);
function checkPrompt(prompt) {
    assert.ok(prompt.startsWith(DEEPSEEK_KOREAN_PROMPT));
    assert.doesNotMatch(prompt,/SENTINEL|CHUSEOK GALBWAE|MAD KOREAN|HONG.JIN FLAVOR|PREVIOUS USER MESSAGE/);
}
function answer(prompt) {
    const rows=JSON.parse(prompt.split('\nTARGETS\n').at(-1));
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.type==='tagged_content'?'맑음':`${(row.text.match(/@@VERBA[^@]+@@/g)||[]).join(' ')} 미소 지었다.`.trim()}))})};
}

test('requires both developer access and the dedicated switch',()=>{
    for(const dev of [false,true]) for(const toggle of [false,true]) {
        assert.equal(deepseekKoreanEnabled({...settings,developerMode:dev,developerDeepseekKoreanEnabled:toggle}),dev&&toggle);
    }
});
test('experiment prompt requests native Korean prose, full-name particles and contextual family ownership',()=>{
    assert.match(DEEPSEEK_KOREAN_PROMPT,/처음부터 한국어로 집필된 글/);
    assert.match(DEEPSEEK_KOREAN_PROMPT,/혜담은 전체가 이름/);
    assert.match(DEEPSEEK_KOREAN_PROMPT,/혜담은이 노트북을 열었다/);
    assert.match(DEEPSEEK_KOREAN_PROMPT,/부엌에서는 남은 찌개를 데우는 냄새가 났다/);
    assert.match(DEEPSEEK_KOREAN_PROMPT,/민철네 부엌에서는 남은 찌개를 데우는 냄새가 났다/);
    assert.match(DEEPSEEK_KOREAN_PROMPT,/김씨네, 김가네, 김씨 가족, 김씨 자택 같은 표현을 자동으로 만들지 않는다/);
});
test('all output and selection prompt builders exclude saved and one-time prompts',()=>{
    const before=structuredClone(settings);
    checkPrompt(buildMinimalOutputPrompt(segmented.segments,settings,segmented.nameTokens,'ONETIME_SENTINEL'));
    checkPrompt(buildOutputPrompt(segmented,settings,'ONETIME_SENTINEL'));
    const options={source:'He waited.',translation:'그는 기다렸다.',selected:'기다렸다.',start:3,end:8,settings,oneTimeInstruction:'ONETIME_SENTINEL'};
    checkPrompt(buildSelectionPrompt(options));
    assert.match(buildSelectionPrompt({...options,candidateCount:3}),/"candidates"/);
    checkPrompt(buildMultiSelectionPrompt({...options,selections:[{id:'multi_0000',selected:'기다렸다.',start:3,end:8}]}));
    assert.deepEqual(settings,before);
});
test('browser pipeline uses only the experiment and skips review and tagged retry',async()=>{
    let calls=0;
    const result=await translateMinimalOutput(segmented,settings,{oneTimeInstruction:'ONETIME_SENTINEL'}, {
        requestSegments:async(prompt,rows)=>{calls++;checkPrompt(prompt);return new Map(rows.map(row=>[row.id,row.type==='tagged_content'?'The lantern flickers quietly.':`${(row.text.match(/@@VERBA[^@]+@@/g)||[]).join(' ')} 미소 지었다.`]));},
        buildSourceMap:()=>[],
        reviewEnglish:()=>{throw Error('Extra review must not run');},
    });
    assert.equal(calls,1);
    assert.match(result.translation,/다나/);
    assert.match(result.translation,/`KEEP_CODE`/);
    assert.match(result.translation,/<Info_panel>The lantern flickers quietly\.<\/Info_panel>/);
});
test('bundled server engine sends the isolated prompt, preserves structure and selected profile',async()=>{
    const original=snapshot();let calls=0;
    const engine=createEngine(original,async(id,messages)=>{calls++;assert.equal(id,'A');assert.equal(messages.length,1);checkPrompt(messages[0].content);return answer(messages[0].content);});
    const out=await engine.output(source,{oneTimeInstruction:'ONETIME_SENTINEL',previousUserSource:'PREVIOUS_SENTINEL',speakerIdentity:{sourceUserName:'Dana',userName:'다나'}});
    assert.equal(calls,1);assert.match(out.translation,/다나/);assert.match(out.translation,/KEEP_CODE/);assert.match(out.translation,/<Info_panel>맑음<\/Info_panel>/);assert.doesNotMatch(out.translation,/@@VERBA/);
    assert.deepEqual(original.settings,settings);
});
test('switching off restores existing prompt and input translation remains unchanged',()=>{
    const off={...settings,developerDeepseekKoreanEnabled:false,chuseokGalbwaeScope:'off',customTranslatorEnabled:false};
    assert.match(buildMinimalOutputPrompt(segmented.segments,off),/^MINIMAL_SENTINEL/);
    assert.equal(buildInputPrompt('안녕.',settings),buildInputPrompt('안녕.',{...settings,developerDeepseekKoreanEnabled:false}));
});
test('Korean-only output is not rewrapped by the saved bilingual setting',()=>{
    const map=[{id:'seg_0000',source:'"Come here."',start:0,end:6}];
    assert.deepEqual(normalizeBilingualMappedTranslation('"이리 와."',map,settings,'"Come here."'),{translation:'"이리 와."',sourceMap:map});
});
test('selection-only mode never falls back to the entire source',()=>{
    const options={source:'FULL_SOURCE_SENTINEL',sourceContext:'',translation:'선택문',selected:'선택문',start:0,end:3,settings,contextMode:'selection'};
    assert.doesNotMatch(buildSelectionPrompt(options),/FULL_SOURCE_SENTINEL/);
    assert.doesNotMatch(buildMultiSelectionPrompt({...options,selections:[{id:'multi_0000',selected:'선택문',start:0,end:3,sourceContext:''}]}),/FULL_SOURCE_SENTINEL/);
});
test('server manifest and UI advertise the new mode and compatible engine version',()=>{
    const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
    assert.match(index,/id="verba-developer-deepseek-korean-enabled"/);
    assert.match(index,/target.id === 'verba-developer-deepseek-korean-enabled'/);
    assert.match(index,/developerDeepseekKoreanEnabled: raw.developerDeepseekKoreanEnabled === true/);
    const manifest=JSON.parse(fs.readFileSync(new URL('../server-plugin/engines/manifest.json',import.meta.url)));
    assert.ok(index.includes(`const SERVER_ENGINE_VERSION = '${manifest.engines.verba.version}'`));
    assert.equal(manifest.engines['verba-deep'].version,'0.6.45');
});
