import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as core from '../core.js';
import { normalizeBaseTranslationCustom } from '../base-editor.js';

// No API calls, credentials, browser state, or settings writes.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: 'CHAR_ID_SENTINEL', userName: 'USER_ID_SENTINEL', characterGender: 'male' };
const segmented = { segments: [
    { id: 'seg_0000', type: 'narration', text: '' },
    { id: 'seg_0001', type: 'dialogue_candidate', text: '""' },
], nameTokens: [] };
const translations = new Map(segmented.segments.map(s => [s.id, '']));
const selectionArgs = { source: '', translation: '""', selected: '""', start: 0, end: 2, speakerIdentity: identity };
const multiArgs = { source: '', translation: '""', selections: [{ id: 'm0', selected: '""', start: 0, end: 2 }], speakerIdentity: identity };
const builders = {
    full: (m, s) => m.buildOutputPrompt(segmented, s, '', identity),
    ...Object.fromEntries(['narration', 'target_dialogue', 'other_dialogue', 'tagged_content'].map(scope => [scope,
        (m, s) => m.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings: s, scope, speakerIdentity: identity })])),
    input: (m, s) => m.buildInputPrompt('', s, 'male', identity),
    selection: (m, s) => m.buildSelectionPrompt({ ...selectionArgs, translation: '', selected: '', end: 0, settings: s }),
    selectionDialogue: (m, s) => m.buildSelectionPrompt({ ...selectionArgs, settings: s }),
    selectionCandidates: (m, s) => m.buildSelectionPrompt({ ...selectionArgs, settings: s, candidateCount: 3 }),
    multi: (m, s) => m.buildMultiSelectionPrompt({ ...multiArgs, settings: s }),
    qa: (m, s) => m.buildQualityAuditPrompt({ segments: segmented.segments, currentTranslations: translations,
        sourceContext: '', settings: s, speakerIdentity: identity, enabledChecks: ['meaning', 'referent', 'voice', 'translationese', 'continuity'] }),
    bannedRepair: (m, s) => m.buildBannedRepairPrompt(segmented.segments, translations, s, identity),
    tokenRepair: (m, s) => m.buildProtectedTokenRepairPrompt(segmented.segments, translations, s, identity),
    untranslatedRepair: (m, s) => m.buildUntranslatedRepairPrompt(segmented.segments, translations, s, identity),
    termRepair: (m, s) => m.buildTermConsistencyRepairPrompt({ rows: [], terms: [], settings: s }),
    rolePlan: (m, s) => m.buildRoleTermPlanPrompt({ sourceContext: '', terms: [], settings: s }),
    attribution: (m) => m.buildSpeakerAttributionPrompt(segmented, identity),
    nameMatch: (m) => m.buildNameMatchPrompt(selectionArgs),
    nameHistory: (m) => m.buildNameHistoryFormsPrompt({ sourceName: '', currentName: '', candidates: [] }),
};

// v.54 replaces built-in wording in every mode. Assert contracts, not legacy prose.
const old = process.argv[2] ? await import(pathToFileURL(path.resolve(process.argv[2])).href) : null;
let checks=0;
for (const flags of [{},{developerMadKoreanOutputEnabled:true},{developerHongjinFlavorEnabled:true},{developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true}]) {
 for (const mode of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}]) {
  const settings={...defaults,developerMode:true,...mode,...flags};
  const snapshot=JSON.stringify(settings);
  for (const [name,build] of Object.entries(builders)) {
   const text=build(core,settings);
   assert.ok(text.includes('segments') || text.includes('candidates'),name+' schema');
   assert.ok(!text.includes('[object Object]')&&!text.includes('undefined'),name+' valid serialization');
   assert.equal(build(core,{...settings,developerMode:false}),build(core,{...settings,developerMode:false,developerCompressedPromptEnabled:false,developerExtremeCompressedPromptEnabled:false}),name+' developer gate');
   assert.equal((text.match(/TOP PRIORITY — NO MISOGYNY/g)||[]).length<=1,true,name+' no duplicate policy');
   if(old && !mode.developerExtremeCompressedPromptEnabled) assert.ok(text.length<build(old,settings).length,name+' shorter than v.53 '+JSON.stringify({...mode,...flags}));
   checks+=5;
  }
  assert.equal(JSON.stringify(settings),snapshot,'builders never modify settings');
 }
}
const s={...defaults,developerMode:true,globalPrompt:'GLOBAL_LITERAL',allDialoguePrompt:'ALL_LITERAL',dialoguePrompt:'TARGET_LITERAL',otherDialoguePrompt:'OTHER_LITERAL',baseTranslationCustom:{enabled:true,prompt:'CUSTOM_LITERAL'},bannedWords:'BAN_LITERAL',dialogueEndingRepetitionReduction:false};
for(const mode of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}]) {
 const config={...s,...mode};
 const full=builders.full(core,config);
 for(const value of ['GLOBAL_LITERAL','ALL_LITERAL','TARGET_LITERAL','OTHER_LITERAL','CUSTOM_LITERAL','BAN_LITERAL'])assert.ok(full.includes(value),value+' preserved');
 assert.ok(!builders.input(core,config).includes('GLOBAL_LITERAL'));
 for(const scope of ['narration','target_dialogue','other_dialogue','tagged_content']) {
  const out=builders[scope](core,config);
  assert.equal(out.includes('TARGET_LITERAL'),scope==='target_dialogue');
  assert.equal(out.includes('OTHER_LITERAL'),scope==='other_dialogue');
  assert.equal(out.includes('ALL_LITERAL'),scope.endsWith('dialogue'));
 }
 const reversed={...config,translationRuleOrder:['global','oneTime','allDialogue','characterDialogue','otherDialogue','fineTuning']};
 const ordered=builders.full(core,reversed);
 assert.ok(ordered.indexOf('GLOBAL_LITERAL')<ordered.indexOf('TARGET_LITERAL'),'custom rule order');
 // Disabled stored text is retained in settings but excluded from transmission.
 assert.ok(!builders.full(core,{...config,globalPromptEnabled:false}).includes('GLOBAL_LITERAL'));
 const exclusive=builders.full(core,{...config,developerMadKoreanOutputEnabled:true});
 for(const value of ['GLOBAL_LITERAL','ALL_LITERAL','TARGET_LITERAL','OTHER_LITERAL','CUSTOM_LITERAL'])assert.ok(!exclusive.includes(value),'MAD exclusion '+value);
 assert.ok(exclusive.includes('BAN_LITERAL'));
 for(const route of ['tokenRepair','bannedRepair']) {
  const repaired=builders[route](core,{...config,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true});
  assert.ok(!repaired.includes('MANDATORY REAUTHORING'),'local repair avoids full style prompt');
  assert.ok(repaired.includes('USER-directed profanity guard'));
  assert.ok(repaired.includes('BAN_LITERAL'));
 }
}
// A supplied source is never shortened or altered by whole-output construction.
const source='"A" <b>text</b> @@VERBA_0000@@\n\nnext';
const payload=[{id:'seg_0123',type:'narration',text:source}];
const rendered=core.buildOutputPrompt({segments:payload,nameTokens:[]},defaults);
assert.deepEqual(JSON.parse(rendered.split('\nSEGMENTS\n')[1]),payload);
assert.ok(core.buildSelectionPrompt({...selectionArgs,settings:defaults,candidateCount:3}).includes('candidate_3'));
assert.ok(core.buildMultiSelectionPrompt({...multiArgs,settings:defaults}).includes('"id":"m0"'));
console.log(`PASS: shortened prompt contracts (${checks} route checks, custom text/scopes, no API calls).`);
