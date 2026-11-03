import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deepseekKoreanEnabled, DEEPSEEK_KOREAN_PROMPT } from '../deepseek-korean.js';
import { minimalOutputEnabled } from '../minimal-output.js';
import { segmentSource, buildOutputPrompt, buildScopedOutputPrompt, buildSelectionPrompt, buildMultiSelectionPrompt, buildInputPrompt, normalizeBilingualMappedTranslation } from '../core.js';
import { createEngine } from '../server-plugin/engines/verba.mjs';

const settings = {
    developerMode:true, developerDeepseekKoreanEnabled:true,
    profileId:'A', activeProfileSlot:'A', autoProfileFallback:false, serverRetryLimit:1,
    developerMinimalPromptEnabled:true, developerMinimalPrompt:'MINIMAL_SENTINEL',
    globalPromptEnabled:true, globalPrompt:'GLOBAL_SENTINEL',
    allDialoguePromptEnabled:true, allDialoguePrompt:'ALL_DIALOGUE_SENTINEL',
    dialoguePromptEnabled:true, dialoguePrompt:'CHARACTER_SENTINEL',
    otherDialoguePromptEnabled:true, otherDialoguePrompt:'OTHER_SENTINEL',
    englishFlavorEnabled:true, englishFlavorSlangDensity:'active',
    koreanFlavorEnabled:true, koreanFlavorPronounOmission:'active',
    relationTemperatureEnabled:true, relationTemperature:'intimate',
    narrationLocalizationLevel:'naturalized', dialogueLocalizationLevel:'native',
    dialogueEndingPreferred:'ENDING_SENTINEL', expressionEmphasisTaste:'active',
    developerRelationshipExperimentEnabled:true,developerTargetToUserAddress:'ADDRESS_SENTINEL',
    beginnerCharacterGuideEnabled:true,beginnerPersonalityCustom:'GUIDE_SENTINEL',
    bannedWords:'금지표현', translateTaggedContent:true, aiPostReview:{},
};
const identity={characterName:'Chris',sourceCharacterName:'Chris',userName:'다나',sourceUserName:'Dana'};
const source='Dana smiled.\n\n"Come here."\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>';
const segmented=segmentSource(source,[{source:'Dana',target:'다나'}]);
const off=s=>({...s,developerDeepseekKoreanEnabled:false,developerMinimalPromptEnabled:false});
function regularPart(prompt) {
    assert.ok(prompt.startsWith(DEEPSEEK_KOREAN_PROMPT));
    const split=prompt.indexOf('\n',DEEPSEEK_KOREAN_PROMPT.length+1);
    assert.match(prompt.slice(DEEPSEEK_KOREAN_PROMPT.length,split),/ACTIVE SETTINGS PRECEDENCE/);
    return prompt.slice(split+1);
}
const selection=s=>({source:'"Come here."',translation:'"이리 와."',selected:'이리 와.',start:1,end:6,settings:s,oneTimeInstruction:'ONETIME_SENTINEL',speakerIdentity:identity});
function builders(s) {
    return [
        buildOutputPrompt(segmented,s,'ONETIME_SENTINEL',identity),
        buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings:s,scope:'target_dialogue',speakerIdentity:identity}),
        buildSelectionPrompt(selection(s)),
        buildSelectionPrompt({...selection(s),candidateCount:3}),
        buildMultiSelectionPrompt({...selection(s),selections:[{id:'multi_0000',selected:'이리 와.',start:1,end:6}]}),
    ];
}
const snapshot=s=>({settings:structuredClone(s),profiles:{A:{}},nameLocks:[{source:'Dana',target:'다나'}],character:{name:'Chris'},context:{name1:'Dana',name2:'Chris'}});
function answer(prompt) {
    const rows=JSON.parse(prompt.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
    return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.type==='tagged_content'?'맑음':row.type==='dialogue_candidate'?'"이리 와."':`${(row.text.match(/@@VERBA[^@]+@@/g)||[]).join(' ')} 기다렸다.`.trim()}))})};
}

test('dedicated toggle uses regular pipeline; minimal mode resumes when it is off',()=>{
    for(const dev of [false,true]) for(const toggle of [false,true]) {
        const s={...settings,developerMode:dev,developerDeepseekKoreanEnabled:toggle};
        assert.equal(deepseekKoreanEnabled(s),dev&&toggle);
        assert.equal(minimalOutputEnabled(s),dev&&!toggle);
    }
});
for(const [name,extra] of [
    ['ordinary tastes and four slots',{}],
    ['custom translators',{customTranslatorEnabled:true,customTranslatorTemplates:{output:'CUSTOM_OUTPUT',selection:'CUSTOM_SELECTION'},customTranslatorModified:{output:true,selection:true}}],
    ['custom base',{baseTranslationCustom:{enabled:true,prompt:'CUSTOM_BASE'}}],
    ['Hongjin voice',{developerHongjinFlavorEnabled:true,developerHongjinProfanity:'high'}],
    ['MAD exclusivity',{developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true}],
    ['Galbwae exclusivity',{chuseokGalbwaeScope:'all',developerMadKoreanOutputEnabled:true}],
    ['all slots and tastes off',{globalPromptEnabled:false,allDialoguePromptEnabled:false,dialoguePromptEnabled:false,otherDialoguePromptEnabled:false,englishFlavorEnabled:false,koreanFlavorEnabled:false}],
]) test(`all builders retain ordinary prompt composition: ${name}`,()=>{
    const s={...settings,...extra}, before=structuredClone(s);
    const actual=builders(s),expected=builders(off(s));
    actual.forEach((prompt,index)=>assert.equal(regularPart(prompt),expected[index]));
    assert.deepEqual(s,before);
});
test('all active settings reach prompt; scopes and disabled switches remain effective',()=>{
    const p=buildOutputPrompt(segmented,settings,'ONETIME_SENTINEL',identity);
    for(const marker of ['GLOBAL_SENTINEL','ALL_DIALOGUE_SENTINEL','CHARACTER_SENTINEL','OTHER_SENTINEL','English-character taste','Korean-character taste','relation=intimate','ENDING_SENTINEL','ADDRESS_SENTINEL','GUIDE_SENTINEL','금지표현','ONETIME_SENTINEL']) assert.ok(p.includes(marker),marker);
    for(const key of ['globalPrompt','allDialoguePrompt','dialoguePrompt','otherDialoguePrompt']) assert.ok(!buildOutputPrompt(segmented,{...settings,[key+'Enabled']:false}).includes(settings[key]));
    for(const scope of ['narration','tagged_content','other_dialogue','target_dialogue']) {
        const p=buildScopedOutputPrompt({segments:segmented.segments,settings,scope,speakerIdentity:identity});
        assert.equal(p.includes('CHARACTER_SENTINEL'),scope==='target_dialogue');
        assert.equal(p.includes('OTHER_SENTINEL'),scope==='other_dialogue');
    }
});
test('input prompt is byte-identical with experiment on/off',()=>{
    assert.equal(buildInputPrompt('안녕.',settings,'male',identity),buildInputPrompt('안녕.',off(settings),'male',identity));
});
test('bilingual local formatter has ordinary behavior with experiment on/off',()=>{
    const s={...settings,allDialoguePrompt:'대사 한영병기'};
    const map=[{id:'seg_0000',source:'"Come here."',start:0,end:7}];
    assert.deepEqual(normalizeBilingualMappedTranslation('"이리 와."',map,s,'"Come here."'),normalizeBilingualMappedTranslation('"이리 와."',map,off(s),'"Come here."'));
});
test('server sends regular full composition, previous context and identity with no added style calls',async()=>{
    const original=snapshot(settings);let calls=0;
    const engine=createEngine(original,async(id,messages)=>{
        calls++;assert.equal(id,'A');assert.equal(messages.length,1);
        const prompt=messages[0].content;
        for(const value of ['English-character taste','Korean-character taste','CHARACTER_SENTINEL','OTHER_SENTINEL','ONETIME_SENTINEL','PREVIOUS_CONTEXT_SENTINEL','Chris']) assert.ok(prompt.includes(value),value);
        assert.ok(prompt.includes(DEEPSEEK_KOREAN_PROMPT));assert.ok(!prompt.includes('MINIMAL_SENTINEL'));
        return answer(prompt);
    });
    const out=await engine.output(source,{oneTimeInstruction:'ONETIME_SENTINEL',previousUserSource:'PREVIOUS_CONTEXT_SENTINEL',speakerIdentity:identity});
    assert.equal(calls,1);assert.match(out.translation,/다나/);assert.match(out.translation,/KEEP_CODE/);assert.match(out.translation,/<Info_panel>맑음<\/Info_panel>/);
    assert.deepEqual(original,snapshot(settings));
});
test('server keeps ordinary MAD Korean-only enforcement',async()=>{
    const s={...settings,developerMadKoreanOutputEnabled:true,allDialoguePrompt:'대사 한영병기'};
    const engine=createEngine(snapshot(s),async(id,messages)=>{
        assert.match(messages[0].content,/MAD KOREAN/);
        return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"Wait here. [여기서 기다려.]"'}]})};
    });
    const out=await engine.output('"Wait here."',{speakerIdentity:identity});
    assert.equal(out.translation,'"여기서 기다려."');
});
test('server unified review retains ordinary selected checks and custom format',async()=>{
    const s={...settings,aiPostReview:{bilingual:true},customTranslatorEnabled:true,customTranslatorTemplates:{output:'For dialogue, preserve English and include Korean in square brackets: "English [한국어]".'},customTranslatorModified:{output:true}};
    let calls=0;
    const engine=createEngine(snapshot(s),async(id,messages)=>{
        calls++;const p=messages[0].content;
        if(p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
            assert.match(p,/For dialogue, preserve English/);
            const rows=JSON.parse(p.split('\nREVIEW_UNITS\n').at(-1));
            assert.ok(rows.some(row=>row.checks.includes('bilingual')));
            return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:'"Wait here. [여기서 기다려.]"'}))})};
        }
        return {content:JSON.stringify({segments:[{id:'seg_0000',translation:'"여기서 기다려."'}]})};
    });
    const out=await engine.output('"Wait here."',{speakerIdentity:identity});
    assert.equal(calls,2);assert.match(out.translation,/Wait here/);assert.match(out.translation,/여기서 기다려/);
});
test('selection-only context does not expose the entire source',()=>{
    const options={...selection(settings),source:'FULL_SOURCE_SENTINEL',sourceContext:'',contextMode:'selection'};
    assert.doesNotMatch(buildSelectionPrompt(options),/FULL_SOURCE_SENTINEL/);
    assert.doesNotMatch(buildMultiSelectionPrompt({...options,selections:[{id:'multi_0000',selected:'이리 와.',start:1,end:6,sourceContext:''}]}),/FULL_SOURCE_SENTINEL/);
});
test('server version and unchanged Deep variant hash agree with manifests',()=>{
    const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
    const manifest=JSON.parse(fs.readFileSync(new URL('../server-plugin/engines/manifest.json',import.meta.url)));
    assert.ok(index.includes(`const SERVER_ENGINE_VERSION = '${manifest.engines.verba.version}'`));
    assert.equal(manifest.engines['verba-deep'].hash,createHash('sha256').update(fs.readFileSync(new URL('../server-plugin/engines/verba-deep.mjs',import.meta.url))).digest('hex'));
});
