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
    selectionDialogue: (m, s) => m.buildSelectionPrompt({ ...selectionArgs, settings: s, speakerScope: 'target_dialogue' }),
    selectionCandidates: (m, s) => m.buildSelectionPrompt({ ...selectionArgs, settings: s, candidateCount: 3, speakerScope: 'target_dialogue' }),
    multi: (m, s) => m.buildMultiSelectionPrompt({ ...multiArgs, selections: multiArgs.selections.map(row => ({ ...row, speakerScope: 'target_dialogue' })), settings: s }),
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
check(attribution.includes('USER: "Dam-eun"'), 'original user label retained for classification');
check(attribution.includes('TARGET CHARACTER: "Hong-jin"'), 'original character label retained for classification');
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
const fallbackPrompt = core.buildIdentityNameFallbackPrompt({
    characterName: '김홍진',
    userName: '혜담은',
    candidates: ['Hong-jin', 'Dam-eun'],
});
check(fallbackPrompt.includes('CURRENT TARGET CHARACTER DISPLAY NAME: "김홍진"'), 'fallback receives only current character display name');
check(fallbackPrompt.includes('CURRENT USER / PERSONA DISPLAY NAME: "혜담은"'), 'fallback receives only current persona display name');
check(fallbackPrompt.includes('"source_name":"Dam-eun"'), 'fallback receives source name candidates');
check(fallbackPrompt.includes('__NO_MATCH__'), 'fallback can refuse uncertain identity matches');
const flashNamePrompt = core.buildOutputPrompt(segmented, {
    ...defaults,
    developerMode: true,
    developerMadKoreanOutputEnabled: true,
    developerCompressedPromptEnabled: false,
}, '', resolved);
check(flashNamePrompt.includes('MANDATORY KOREAN NAME FORMS — LOCAL MECHANICAL GRAMMAR'), 'flash prompt contains dynamic local mechanical name table');
check(flashNamePrompt.includes('"base":"담은","subject":"담은이","topic":"담은은","object":"담은을"'), 'flash prompt lists exact Korean particles');
check(flashNamePrompt.includes('Never rewrite, sanitize, neutralize, shorten, or otherwise alter the surrounding dialogue'), 'name repair cannot sanitize surrounding voice');
check(!flashNamePrompt.includes('This check overrides style and voice'), 'name repair no longer overrides character voice');
const flashHongjinPrompt = core.buildOutputPrompt(segmented, {
    ...defaults,
    developerMode: true,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerCompressedPromptEnabled: false,
    developerHongjinProfanity: 'natural',
}, '', resolved);
check(flashHongjinPrompt.includes('TARGET CHARACTER AUTHORING PATH'), 'Mad+Hongjin restores the proven 0.5.84 authoring path');
check(flashHongjinPrompt.includes('DEEPSEEK V4.1 FLASH — CURRENT TARGET CHARACTER DIALOGUE VOICE PASS'), 'restored path executes the dedicated Hongjin voice pass');
check(!/generate three|three different kim hong-jin utterances/iu.test(flashHongjinPrompt), 'restored path does not request hidden multi-candidate generation');
assert.equal(core.repairCanonicalKoreanNameSuffixes('담은이의 후드와 담은이를 잡았다.', ['담은']), '담은의 후드와 담은을 잡았다.');
assert.equal(core.repairCanonicalKoreanVocatives('"담은이아!" 그가 외쳤다.', { type: 'dialogue_candidate', text: '"Dam-eun!" he shouted.' }, ['담은']), '"담은아!" 그가 외쳤다.');
assert.equal(core.repairCanonicalKoreanVocatives('"담은이야!" 그가 외쳤다.', { type: 'dialogue_candidate', text: '"Dam-eun!" he shouted.' }, ['담은']), '"담은아!" 그가 외쳤다.');
assert.equal(core.repairCanonicalKoreanVocatives('담은이 파이프를 휘둘렀다.', { type: 'narration', text: 'Dam-eun swung the pipe.' }, ['담은']), '담은이 파이프를 휘둘렀다.');
assert.equal(core.repairCanonicalKoreanNameSuffixes('신이가 담은이를 불렀다.', ['신', '담은']), '신이 담은을 불렀다.');
assert.equal(core.repairCanonicalKoreanNameSuffixes('농담은이 먹혔다. 부담은이 컸다. 상담은은 끝났다.', ['담은']), '농담은이 먹혔다. 부담은이 컸다. 상담은은 끝났다.');
assert.equal(core.repairCanonicalKoreanVocatives('"신이아!" 그녀가 외쳤다.', { type: 'dialogue_candidate', text: '"Shin!" she shouted.' }, ['신']), '"신아!" 그녀가 외쳤다.');
assert.equal(core.repairDuplicateCanonicalIdentityNames('담은이담은 그를 따라왔다. 홍진홍진은 멈췄다.', ['담은', '홍진']), '담은이 그를 따라왔다. 홍진은 멈췄다.');
const leadingNameToken = protectedData.nameTokens[0];
assert.equal(
    core.repairLeadingLockedNameSubjectParticle(`${leadingNameToken.token} 천장을 봤다.`, { type: 'narration', text: `${leadingNameToken.token} stared at the ceiling.` }, [leadingNameToken]),
    `${leadingNameToken.token}이 천장을 봤다.`,
);
assert.equal(
    core.repairLeadingLockedNameSubjectParticle(`${leadingNameToken.token}의 손이 움직였다.`, { type: 'narration', text: `${leadingNameToken.token}'s hand moved.` }, [leadingNameToken]),
    `${leadingNameToken.token}의 손이 움직였다.`,
);
const indexSource = fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const localLockStart = indexSource.indexOf('function mergedNameLocks(');
const localLockEnd = indexSource.indexOf('async function inferredPrimaryIdentityNameLocks(', localLockStart);
const localLockHelpers = Function(
    'settings',
    'escapeRegularExpression',
    `${indexSource.slice(localLockStart, localLockEnd)}\nreturn {localFlavorIdentityNameLocks};`,
)({ developerHongjinFlavorEnabled: true }, value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
assert.deepEqual(
    localLockHelpers.localFlavorIdentityNameLocks(
        'Alex Morgan waited beside Taylor Reed.',
        {
            sourceCharacterName: 'Alex Morgan', characterName: '알렉스 모건',
            sourceUserName: 'Taylor Reed', userName: '테일러 리드',
        },
    ),
    [
        { source: 'Alex Morgan', target: '알렉스 모건' },
        { source: 'Taylor Reed', target: '테일러 리드' },
    ],
);
check(indexSource.includes('}, normalizedCharacterNameLocks(character));'), 'runtime passes character locks into output identity');
check(indexSource.includes("stage: 'identity-name-fallback'"), 'runtime has cached fallback name planning stage');
check(indexSource.includes('mergedNameLocks(explicitNameLocks, inferredNameLocks)'), 'saved name locks are merged before inferred names');
check(indexSource.includes('const collisionRepaired = repairEmbeddedIdentityWordCollisions(value, speakerIdentity);'), 'final strict name repair always fixes embedded common-word collisions');
console.log(`Name-lock routing: PASS (${checks} checks plus identity/restoration assertions; no live AI calls)`);
