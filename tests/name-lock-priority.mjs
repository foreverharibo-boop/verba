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
const identity = core.resolveOutputSpeakerIdentity({ characterName: 'Hong-jin', userName: '혜담은.', characterGender: 'male' }, [{ source: 'Hong-jin', target: '홍진' }, { source: 'Dam-eun', target: '담은' }]);
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

let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const input = { characterName: 'Hong-jin', userName: 'Dam-eun', characterGender: 'male' };
const locks = [{source:'Hong-jin', target:'홍진'}, {source:'Dam-eun', target:'담은'}];
const before = JSON.stringify([input, locks]);
const resolved = core.resolveOutputSpeakerIdentity(input, locks);
assert.equal(resolved.userName, '담은'); assert.equal(resolved.characterName, '홍진');
assert.equal(resolved.sourceUserName, 'Dam-eun');
assert.equal(JSON.stringify([input, locks]), before);
assert.equal(identity.userName, '혜담은'); // No invented cross-script or suffix binding.
assert.equal(core.resolveOutputSpeakerIdentity({userName:'다른담은'}, [{source:'담은',target:'다미'}]).userName, '다른담은');
assert.equal(core.resolveOutputSpeakerIdentity({userName:'Dr. A.'}, locks).userName, 'Dr. A.');
assert.equal(core.resolveOutputSpeakerIdentity({userName:'담은.'}, [{source:'담은',target:'다미'}, {source:'담은.',target:'다솜'}]).userName, '담은');
assert.equal(core.resolveOutputSpeakerIdentity({userName:'Dam-eun'}, [{source:'Dam-eun',target:'담은.'}]).userName, '담은.'); // User-saved literal untouched.
const attribution = core.buildSpeakerAttributionPrompt(segmented, resolved);
check(attribution.includes('USER/{{user}}="Dam-eun"'), 'original user label retained for classification');
check(attribution.includes('TARGET/CHAR/{{char}}="Hong-jin"'), 'original character label retained for classification');
const routes = ['full', 'narration', 'target_dialogue', 'other_dialogue', 'tagged_content', 'selection', 'selectionDialogue', 'selectionCandidates', 'multi', 'qa', 'bannedRepair', 'tokenRepair', 'untranslatedRepair'];
for (const developerMode of [false, true]) for (const developerCompressedPromptEnabled of [false,true])
for (const developerMadKoreanOutputEnabled of [false,true]) for (const developerHongjinFlavorEnabled of [false,true]) {
    const settings = {...defaults, developerMode, developerCompressedPromptEnabled, developerMadKoreanOutputEnabled, developerHongjinFlavorEnabled};
    for (const route of routes) {
        const p = builders[route](core, settings);
        check(p.includes('"source_spelling":"Dam-eun","fixed_korean_spelling":"담은"'), route + ': pronoun-only segment receives saved Korean spelling');
        check(p.split('FIXED-SPELLING PRIORITY:').length === 2, route + ': priority once');
        check(p.split('"fixed_korean_spelling":"담은"').length === 2, route + ': mapping once');
        check(p.includes('Never infer identity from a matching suffix'), route + ': identity ambiguity guard');
    }
}
const protectedData = core.protectSource('Dam-eun said. She waited. <b>Done.</b><style>.Dam-eun {color:red}</style>', locks);
const withToken = {...protectedData, segments:[{id:'seg_0000',type:'narration',text:protectedData.protectedText}]};
for (const compressed of [false,true]) {
    const p = core.buildOutputPrompt(withToken, {...defaults,developerMode:true,developerMadKoreanOutputEnabled:true,developerCompressedPromptEnabled:compressed}, '', identity);
    check(p.includes('"token":"' + protectedData.nameTokens[0].token + '"'), 'name occurrence remains tokenized');
    check(p.split('"fixed_korean_spelling":"담은"').length === 2, 'token mapping not duplicated in reference table');
    check(p.includes('never duplicate or invent a token'), 'additional pronouns must use text');
}
const token = protectedData.nameTokens[0].token;
assert.equal(core.restoreProtected(token+'이 말했다. 담은의 말이다.', protectedData.nameTokens), '담은이 말했다. 담은의 말이다.');
assert.equal(core.restoreProtected(core.restoreProtected(protectedData.protectedText, protectedData.nameTokens), protectedData.tokens), '담은 said. She waited. <b>Done.</b><style>.Dam-eun {color:red}</style>');
const indexSource = fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
check(indexSource.includes('}, normalizedCharacterNameLocks(character));'), 'runtime passes character locks into output identity');
console.log(`Name-lock routing: PASS (${checks} checks plus identity/restoration assertions; no live AI calls)`);
