import assert from 'node:assert/strict';
import * as core from '../core.js';

// Exercise final assembled requests, including disabled/excluded options.
// No model calls or user settings writes.
const source = 'Alex waited.\n\n"Come here."';
const segmented = core.segmentSource(source);
const identity = { characterName: 'Alex', userName: 'Sam', characterGender: 'male' };
const korean = {
    koreanFlavorEnabled: true,
    koreanFlavorDialogueRhythm: 'short',
    koreanFlavorPronounOmission: 'active',
    koreanFlavorProfanityTone: 'dry',
    koreanFlavorInterjectionTone: 'lively',
    koreanFlavorMemeDensity: 'light',
    koreanFlavorReduceReferentRepetition: true,
};
const enabledPrompts = {
    globalPromptEnabled: true, globalPrompt: 'GLOBAL_SENTINEL',
    dialoguePromptEnabled: true, dialoguePrompt: 'TARGET_SENTINEL',
    otherDialoguePromptEnabled: true, otherDialoguePrompt: 'OTHER_SENTINEL',
    allDialoguePromptEnabled: true, allDialoguePrompt: 'ALL_SENTINEL',
    englishFlavorEnabled: true, englishFlavorSlangDensity: 'ENGLISH_SENTINEL',
    baseTranslationCustom: { enabled: true, prompt: 'BASE_SENTINEL' },
    developerRelationshipExperimentEnabled: true, developerTargetToUserAddress: 'ADDRESS_SENTINEL',
    beginnerCharacterGuideEnabled: true, beginnerPersonalityCustom: 'PERSONALITY_SENTINEL',
};
const marker = /Korean-character taste|KOREAN-NATIVE CHARACTER TASTE/;
const voice = /KIM HONG-JIN VOICE|DEVELOPER KIM HONGJIN FLAVOR|KIM HONG-JIN FLAVOR — TARGET/;
let checks = 0;
for (const mode of [{developerMode:false}, {developerMode:true}, {developerMode:true,developerCompressedPromptEnabled:true}, {developerMode:true,developerExtremeCompressedPromptEnabled:true}]) {
    for (const enabled of [false, true]) for (const hongjin of [false, true]) {
        const settings = {...enabledPrompts,...korean,...mode,koreanFlavorEnabled:enabled,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:hongjin};
        const before = structuredClone(settings);
        for (const scope of ['mixed','narration','target_dialogue','other_dialogue','tagged_content']) {
            const prompt = core.buildScopedOutputPrompt({segments:segmented.segments,sourceContext:source,settings,scope,speakerIdentity:identity,oneTimeInstruction:'ONETIME_SENTINEL'});
            assert.equal(marker.test(prompt), enabled, scope+' Korean toggle');
            assert.match(prompt, /GLOBAL_SENTINEL/);
            assert.match(prompt, /ONETIME_SENTINEL/);
            assert.match(prompt, /English(?:-speaking)?-character taste|ENGLISH-SPEAKING CHARACTER TASTE/);
            assert.equal(prompt.includes('TARGET_SENTINEL'), ['mixed','target_dialogue'].includes(scope));
            assert.equal(prompt.includes('OTHER_SENTINEL'), ['mixed','other_dialogue'].includes(scope));
            assert.equal(prompt.includes('ALL_SENTINEL'), ['mixed','target_dialogue','other_dialogue'].includes(scope));
            assert.equal(voice.test(prompt), hongjin && ['mixed','target_dialogue'].includes(scope),scope+' Hongjin scope');
            if (enabled) {
                assert.match(prompt,/pronoun omission=active|pronoun=active|PronounOmission=active|SUBJECT \/ PRONOUN EXPRESSION — ACTIVE/);
                assert.match(prompt,/profanity=dry|ProfanityTone=dry|PROFANITY \/ ROUGH LANGUAGE TASTE — DRY/);
                assert.equal(/rhythm=short|DialogueRhythm=short|DIALOGUE RHYTHM — SHORT/.test(prompt),['mixed','target_dialogue','other_dialogue'].includes(scope));
                assert.equal(/interjections?=lively|InterjectionTone=lively|INTERJECTIONS \/ REACTION WORDS — LIVELY/.test(prompt),['mixed','target_dialogue','other_dialogue'].includes(scope));
                assert.match(prompt,/meme=light|MemeDensity=light|INTERNET MEME FLAVOR — LIGHT/);
            }
            checks++;
        }
        const full = core.buildOutputPrompt(segmented,settings,'ONETIME_SENTINEL',identity);
        assert.equal(marker.test(full),enabled);
        for (const value of ['GLOBAL_SENTINEL','ALL_SENTINEL','TARGET_SENTINEL','OTHER_SENTINEL','ONETIME_SENTINEL']) assert.ok(full.includes(value),value);
        const selection={source,translation:'"이리 와."',selected:'이리 와.',start:1,end:6,settings,speakerIdentity:identity};
        assert.equal(marker.test(core.buildSelectionPrompt(selection)),enabled);
        assert.equal(marker.test(core.buildMultiSelectionPrompt({...selection,selections:[{id:'m0',selected:'이리 와.',start:1,end:6}]})),enabled);
        assert.equal(core.buildInputPrompt('안녕',settings,'male',identity), core.buildInputPrompt('안녕',{...settings,koreanFlavorEnabled:false},'male',identity));
        assert.deepEqual(settings,before);
        checks+=4;
    }
}
const settings={...korean,developerMadKoreanOutputEnabled:true};
const custom=core.buildOutputPrompt(segmented,{...settings,customTranslatorEnabled:true,customTranslatorTemplates:{mad:'CUSTOM_MAD'},customTranslatorModified:{mad:true}},'',identity);
assert.match(custom,/CUSTOM_MAD/);
assert.match(custom,marker);
const galbwae=core.buildOutputPrompt(segmented,{...settings,developerMode:true,chuseokGalbwaeScope:'all'},'',identity);
assert.doesNotMatch(galbwae,marker);
assert.doesNotMatch(galbwae,/Korean-character taste|KOREAN-NATIVE CHARACTER TASTE/);
console.log('PASS: MAD + Korean taste toggles, three-way combination, selected values, scopes, selection, custom MAD, enabled settings, input isolation and settings preservation ('+checks+' checks).');

