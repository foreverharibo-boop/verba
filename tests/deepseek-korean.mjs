import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deepseekKoreanEnabled, DEEPSEEK_KOREAN_PROMPT, buildDeepseekUserRules } from '../deepseek-korean.js';
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
    otherDialoguePromptEnabled:true, otherDialoguePrompt:'OTHER_SENTINEL',
    allDialoguePromptEnabled:true, allDialoguePrompt:'Translate dialogue in English and Korean. BILINGUAL_SENTINEL',
    developerMadKoreanOutputEnabled:true, developerHongjinFlavorEnabled:true,
    developerExtremeCompressedPromptEnabled:true, developerRelationshipExperimentEnabled:true,
    developerTargetToUserAddress:'ADDRESS_SENTINEL', chuseokGalbwaeScope:'all',
    qualityAuditEnabled:true, finalEnglishReviewEnabled:true, englishReviewEnabled:true,
    bannedWords:'미소', translateTaggedContent:true,
};
const snapshot = () => ({settings:{...structuredClone(settings),aiPostReview:{}},profiles:{A:{}},nameLocks:[{source:'Dana',target:'다나'}],character:{name:'Chris'},context:{name1:'Dana',name2:'Chris'}});
const source = 'Dana smiled.\n\n"Come here."\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>';
const segmented = segmentSource(source,[{source:'Dana',target:'다나'}]);
function checkPrompt(prompt) {
    assert.ok(prompt.startsWith(DEEPSEEK_KOREAN_PROMPT));
    for (const value of ['GLOBAL_SENTINEL','DIALOGUE_SENTINEL','OTHER_SENTINEL','BILINGUAL_SENTINEL']) assert.ok(prompt.includes(value),value);
    assert.doesNotMatch(prompt,/MINIMAL_SENTINEL|CUSTOM_\w+_SENTINEL|BASE_SENTINEL|ADDRESS_SENTINEL|ONETIME_SENTINEL|CHUSEOK GALBWAE|MAD KOREAN|HONG.JIN FLAVOR|PREVIOUS USER MESSAGE/);
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
test('all output and selection builders include four scoped slots but exclude other experiment overrides',()=>{
    const before=structuredClone(settings);
    checkPrompt(buildMinimalOutputPrompt(segmented.segments,settings,segmented.nameTokens,'ONETIME_SENTINEL'));
    checkPrompt(buildOutputPrompt(segmented,settings,'ONETIME_SENTINEL'));
    const options={source:'He waited.',translation:'그는 기다렸다.',selected:'기다렸다.',start:3,end:8,settings,oneTimeInstruction:'ONETIME_SENTINEL'};
    checkPrompt(buildSelectionPrompt(options));
    assert.match(buildSelectionPrompt({...options,candidateCount:3}),/"candidates"/);
    checkPrompt(buildMultiSelectionPrompt({...options,selections:[{id:'multi_0000',selected:'기다렸다.',start:3,end:8}]}));
    assert.deepEqual(settings,before);
});
test('browser pipeline includes the four slots with no extra translation or tagged retry',async()=>{
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
test('bundled server engine composes four slots and preserves structure and selected profile',async()=>{
    const original=snapshot();let calls=0;
    const engine=createEngine(original,async(id,messages)=>{calls++;assert.equal(id,'A');assert.equal(messages.length,1);checkPrompt(messages[0].content);assert.match(messages[0].content,/\"character\":\"Chris\"/);return answer(messages[0].content);});
    const out=await engine.output(source,{oneTimeInstruction:'ONETIME_SENTINEL',previousUserSource:'PREVIOUS_SENTINEL',speakerIdentity:{sourceUserName:'Dana',userName:'다나',characterName:'Chris'}});
    assert.equal(calls,1);assert.match(out.translation,/다나/);assert.match(out.translation,/KEEP_CODE/);assert.match(out.translation,/<Info_panel>맑음<\/Info_panel>/);assert.doesNotMatch(out.translation,/@@VERBA/);
    assert.deepEqual(original.settings,{...settings,aiPostReview:{}});
});
test('switching off restores existing prompt and input translation remains unchanged',()=>{
    const off={...settings,developerDeepseekKoreanEnabled:false,chuseokGalbwaeScope:'off',customTranslatorEnabled:false};
    assert.match(buildMinimalOutputPrompt(segmented.segments,off),/^MINIMAL_SENTINEL/);
    assert.equal(buildInputPrompt('안녕.',settings),buildInputPrompt('안녕.',{...settings,developerDeepseekKoreanEnabled:false}));
});
test('experiment preserves model formatting without an extra forced bilingual wrapper',()=>{
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
    assert.match(manifest.engines['verba-deep'].version,/^0\.6\.\d+$/);
    const deepBundle=fs.readFileSync(new URL('../server-plugin/engines/verba-deep.mjs',import.meta.url));
    assert.equal(manifest.engines['verba-deep'].hash,createHash('sha256').update(deepBundle).digest('hex'));
});


test('each prompt slot respects OFF and empty values in every builder',()=>{
    const calls = s => [buildOutputPrompt(segmented,s),buildMinimalOutputPrompt(segmented.segments,s),buildSelectionPrompt({source:'He waits.',translation:'기다린다.',selected:'기다린다.',start:0,end:5,settings:s}),buildMultiSelectionPrompt({source:'He waits.',translation:'기다린다.',selections:[{selected:'기다린다.',start:0,end:5}],settings:s})];
    for(const key of ['globalPrompt','allDialoguePrompt','dialoguePrompt','otherDialoguePrompt']) {
        for(const prompt of calls({...settings,[key+'Enabled']:false})) assert.ok(!prompt.includes(settings[key]));
        for(const prompt of calls({...settings,[key]:'   '})) assert.ok(!prompt.includes(settings[key]));
    }
    assert.equal(buildDeepseekUserRules({}), '');
});
test('user priority, identities and scope hints survive composition',()=>{
    const rule=buildDeepseekUserRules({...settings,translationRuleOrder:['global','global','invalid','otherDialogue']},{characterName:'Chris',userName:'Dana'});
    assert.ok(rule.indexOf('GLOBAL_SENTINEL')<rule.indexOf('OTHER_SENTINEL'));
    assert.equal(rule.match(/GLOBAL_SENTINEL/g).length,1);
    assert.match(rule,/ALL-DIALOGUE — direct speech by any speaker only/);
    assert.match(rule,/TARGET-DIALOGUE — confirmed current-character direct speech only/);
    assert.match(rule,/OTHER-DIALOGUE — USER, NPC, other or uncertain speakers only/);
    const id=segmented.segments.find(x=>x.type==='dialogue_candidate').id;
    const prompt=buildOutputPrompt(segmented,settings,'',{characterName:'Chris'},null,{[id]:'target_dialogue'});
    assert.match(prompt, /"speaker_scope":"target_dialogue"/);
    assert.match(buildSelectionPrompt({source:'"Wait."',translation:'"기다려."',selected:'기다려.',start:1,end:5,settings}), /"in_dialogue":true/);
});
test('saved MAD mode cannot strip bilingual output from the DeepSeek experiment',async()=>{
    const sample=segmentSource('"Wait here."');
    const result=await translateMinimalOutput(sample,settings,{}, {
        requestSegments:async(prompt,rows)=>new Map(rows.map(row=>[row.id,'"Wait here. [여기서 기다려.]"'])),
        buildSourceMap:()=>[],
    });
    assert.equal(result.translation,'"Wait here. [여기서 기다려.]"');
});
test('bundled review sees active bilingual rules without excluded MAD or custom rules',async()=>{
    const original=snapshot();
    original.settings.aiPostReview={bilingual:true};
    original.settings.allDialoguePrompt='For dialogue, preserve English and include Korean in square brackets: "English [한국어]".';
    let calls=0;
    const engine=createEngine(original,async(id,messages)=>{
        calls++;
        const prompt=messages[0].content;
        if(prompt.startsWith('UNIFIED OUTPUT POST REVIEW')) {
            assert.match(prompt,/For dialogue, preserve English/);
            assert.doesNotMatch(prompt,/MAD KOREAN-ONLY|CUSTOM_output_SENTINEL/);
            const rows=JSON.parse(prompt.split('\nREVIEW_UNITS\n').at(-1));
            assert.ok(rows.some(row=>row.checks.includes('bilingual')));
            return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:'"Wait here. [여기서 기다려.]"'}))})};
        }
        const rows=JSON.parse(prompt.split('\nTARGETS\n').at(-1));
        return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:'"여기서 기다려."'}))})};
    });
    const result=await engine.output('"Wait here."');
    assert.equal(calls,2);
    assert.match(result.translation,/Wait here/);
    assert.match(result.translation,/여기서 기다려/);
});
