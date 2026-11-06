import assert from 'node:assert/strict';
import { createEngine as createVerba } from '../engines/verba.mjs';
import { createEngine as createDeep } from '../engines/verba-deep.mjs';

const source = 'The hallway was quiet.\n\n"Come here."';
let requests = 0;
for (const [name,create] of [['verba',createVerba],['verba-deep',createDeep]]) {
    for (const mode of [{},{developerMode:true,developerCompressedPromptEnabled:true},{developerMode:true,developerExtremeCompressedPromptEnabled:true}]) {
        for (const korean of [false,true]) for (const hongjin of [false,true]) {
            const settings = {
                profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,aiPostReview:{},
                developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:hongjin,
                koreanFlavorEnabled:korean,koreanFlavorDialogueRhythm:'short',
                koreanFlavorPronounOmission:'active',koreanFlavorProfanityTone:'dry',
                koreanFlavorInterjectionTone:'lively',koreanFlavorMemeDensity:'light',
                koreanFlavorReduceReferentRepetition:true,
                englishFlavorEnabled:true,englishFlavorSlangDensity:'EXCLUDED_SENTINEL',
                globalPromptEnabled:true,globalPrompt:'GLOBAL_SENTINEL',
                dialoguePromptEnabled:true,dialoguePrompt:'DIALOGUE_SENTINEL',
                baseTranslationCustom:{enabled:true,prompt:'BASE_SENTINEL'},...mode,
            };
            const snapshot={settings:structuredClone(settings),profiles:{A:{}},nameLocks:[],character:{},context:{}};
            let calls=0;
            const engine=create(snapshot,async (id,messages)=>{
                assert.ok(++calls<=2,'unexpected extra requests');
                const p=messages.map(m=>m.content).join('\n');
                assert.equal(id,'A');
                assert.equal(/Korean-character taste|KOREAN-NATIVE CHARACTER TASTE/.test(p),korean,name+' Korean toggle');
                for (const value of ['GLOBAL_SENTINEL','DIALOGUE_SENTINEL','ONETIME_SENTINEL']) assert.ok(p.includes(value),value);
                assert.match(p,/English(?:-speaking)?-character taste|ENGLISH-SPEAKING CHARACTER TASTE/);
                assert.equal(/KIM HONG-JIN VOICE|DEVELOPER KIM HONGJIN FLAVOR|KIM HONG-JIN FLAVOR — TARGET/.test(p),hongjin);
                if(korean)assert.match(p,/pronoun omission=active|pronoun=active|PronounOmission=active|SUBJECT \/ PRONOUN EXPRESSION — ACTIVE/);
                const marker='\nSEGMENTS\n';
                const at=p.lastIndexOf(marker);assert.ok(at>=0);
                const rows=JSON.parse(p.slice(at+marker.length));
                requests++;
                return {content:JSON.stringify({segments:rows.map(row=>({id:row.id,translation:row.type==='dialogue_candidate'?'"이리 와."':'복도는 조용했다.'}))})};
            });
            const result=await engine.output(source,{oneTimeInstruction:'ONETIME_SENTINEL'});
            assert.match(result.translation,/복도는 조용했다/);
            assert.match(result.translation,/이리 와/);
            assert.equal(calls,1);
            assert.deepEqual(snapshot.settings,settings);
        }
    }
}
console.log('PASS: both bundled server engines send the allowed Korean/Hongjin combination and complete translation ('+requests+' mocked requests, no external API).');

