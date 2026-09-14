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
const baseline = process.argv[2] ? await import(pathToFileURL(path.resolve(process.argv[2])).href) : null;
let checks = 0;
function equal(a, b, reason) { assert.equal(a, b, reason); checks++; }
function contains(p, s, reason = s) { assert.ok(p.includes(s), reason); checks++; }
function absent(p, s, reason = s) { assert.ok(!p.includes(s), reason); checks++; }
const short = { ...defaults, developerMode: true, developerCompressedPromptEnabled: true };
const count = (p, word) => p.split(word).length - 1;
const measures = [];
const madWritingRoutes = new Set(['full', 'narration', 'target_dialogue', 'other_dialogue', 'tagged_content',
    'selection', 'selectionDialogue', 'selectionCandidates', 'multi', 'qa', 'bannedRepair', 'tokenRepair', 'untranslatedRepair']);
const writingStart = 'KOREAN-ORIGINAL COMPOSITION — SHARED WRITING STANDARD';
const writingEnd = 'END KOREAN-ORIGINAL COMPOSITION';
let sharedWritingBlock;
for (const flags of [{}, { developerMadKoreanOutputEnabled: true }, { developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true }]) {
    for (const [name, build] of Object.entries(builders)) {
        const s = { ...short, ...flags };
        const full = build(core, { ...s, developerCompressedPromptEnabled: false });
        const compact = build(core, s);
        // Mad Korean writing changes in BOTH variants; all other routes must stay unchanged.
        const changedMadRule = flags.developerMadKoreanOutputEnabled && madWritingRoutes.has(name);
        if (baseline && !changedMadRule) equal(full, build(baseline, { ...s, developerCompressedPromptEnabled: false }), 'legacy drift: ' + name);
        if (baseline && !changedMadRule) equal(compact, build(baseline, s), 'compact drift: ' + name);
        equal(build(core, { ...s, developerMode: false }), build(core, { ...s, developerMode: false, developerCompressedPromptEnabled: false }), 'developer gate: ' + name);
        if (changedMadRule) {
            for (const prompt of [full, compact]) {
                equal(count(prompt, writingStart), 1, 'shared writing standard once: ' + name);
                equal(count(prompt, writingEnd), 1, 'complete writing standard: ' + name);
                const block = prompt.slice(prompt.indexOf(writingStart), prompt.indexOf(writingEnd) + writingEnd.length);
                sharedWritingBlock ??= block;
                equal(block, sharedWritingBlock, 'same writing criteria/examples in all Mad routes: ' + name);
                equal(count(prompt, 'NATURAL VOCATIVES:'), 1, 'vocative rule once: ' + name);
                equal(count(prompt, '3. Vocative:'), 1, 'vocative example once: ' + name);
                contains(block, 'unless human identity itself matters');
                contains(block, 'not valid surrounding narration');
                contains(block, 'not a fixed substitution or a mandate for 반말');
                absent(block, '3. Dialogue intent:');
                absent(prompt, 'Prefer the shortest complete utterance');
                absent(prompt, 'varied short-to-medium beats');
                absent(prompt, 'A figurative image is style, not scene truth');
                absent(prompt, '너도 안 먹는다는데 굳이 식탁까지');
                absent(prompt, 'Is any sentence decorative');
                equal(count(prompt, 'NATURAL PERSON REFERENCES — PRIMARY CAST REFERENCES'), 1, 'shared name policy once: ' + name);
                contains(prompt, identity.characterName); contains(prompt, identity.userName);
                contains(prompt, 'Omit recoverable subjects/possessors when clear.');
                contains(prompt, '“그/그녀/그의/그녀의” and grammatically inflected forms are ALLOWED.');
                contains(prompt, 'SPELLING, NOT FREQUENCY:');
                contains(prompt, 'Do not rotate through “여자/남자/녀석/상대/사람/사내/청년/작은 몸”');
                contains(prompt, 'do not expand a given name into a full name');
                absent(prompt, 'Canonical names are the default');
                absent(prompt, 'use the canonical name as the reference by default');
                absent(prompt, 'not “그/그녀/그의/그녀의”');
                contains(prompt, 'a new paragraph alone does not mandate a name');
                absent(prompt, 'At each new narrative paragraph, speaker change, or actor change');
                contains(prompt, 'Do not guess an uncertain referent');
                contains(prompt, 'not first/second-person dialogue address');
                absent(prompt, '(1) omit the subject/possessor');
                absent(prompt, 'Omit naturally; if ambiguity remains');
            }
        } else {
            absent(full, writingStart); absent(compact, writingStart);
            absent(full, 'NATURAL PERSON REFERENCES'); absent(compact, 'NATURAL PERSON REFERENCES');
        }
        absent(build(core, { ...s, developerMode: false }), 'NATURAL PERSON REFERENCES');
        absent(build(core, { ...s, developerMode: false }), writingStart);
        if (changedMadRule && name === 'full') assert.ok(compact.length < full.length * 0.65, 'Mad compression must remain substantial');
        measures.push({ mode: flags.developerHongjinFlavorEnabled ? 'mad+hongjin' : flags.developerMadKoreanOutputEnabled ? 'mad' : 'standard', name,
            long: [...full].length, compact: [...compact].length, reduction: +((1 - [...compact].length / [...full].length) * 100).toFixed(1) });
    }
}

// Resolve identities from the current request; do not hard-code any particular RP pair.
for (const compressed of [false, true]) {
    const renamed = core.buildOutputPrompt(segmented, { ...short, developerCompressedPromptEnabled: compressed, developerMadKoreanOutputEnabled: true }, '',
        { characterName: 'NEW_CHARACTER_SENTINEL', userName: 'NEW_USER_SENTINEL' });
    contains(renamed, 'NEW_CHARACTER_SENTINEL'); contains(renamed, 'NEW_USER_SENTINEL');
    absent(renamed, identity.characterName); absent(renamed, identity.userName);
}

// Identities must not depend on either flavor being active.
for (const name of ['selection', 'selectionDialogue', 'selectionCandidates', 'multi']) {
    const p = builders[name](core, short);
    contains(p, identity.characterName); contains(p, identity.userName);
}
// User-written prompts remain intact, cumulative and scope-isolated.
const authored = { globalPrompt: 'GLOBAL_SENTINEL\nDo exactly this.', allDialoguePrompt: 'ALL_SENTINEL', dialoguePrompt: 'TARGET_SENTINEL', otherDialoguePrompt: 'OTHER_SENTINEL' };
const withPrompts = { ...short, ...authored };
const full = builders.full(core, withPrompts);
for (const value of Object.values(authored)) equal(count(full, value), 1, 'authored prompt once');
contains(builders.target_dialogue(core, withPrompts), authored.dialoguePrompt);
absent(builders.target_dialogue(core, withPrompts), authored.otherDialoguePrompt);
contains(builders.other_dialogue(core, withPrompts), authored.otherDialoguePrompt);
absent(builders.other_dialogue(core, withPrompts), authored.dialoguePrompt);
for (const name of ['narration', 'tagged_content']) {
    for (const value of [authored.dialoguePrompt, authored.otherDialoguePrompt, authored.allDialoguePrompt]) absent(builders[name](core, withPrompts), value);
}
for (const value of Object.values(authored)) absent(builders.full(core, { ...withPrompts, developerMadKoreanOutputEnabled: true }), value);
equal(count(builders.full(core, { ...short, baseTranslationCustom: { enabled: true, prompt: 'CUSTOM_BASE_SENTINEL' } }), 'CUSTOM_BASE_SENTINEL'), 1);

// Repeat toggles and actual runtime hints, not merely generic advice.
for (const prefix of ['korean', 'english']) {
    const key = prefix + 'FlavorReduceReferentRepetition';
    const s = { ...short, [prefix + 'FlavorEnabled']: true };
    assert.notEqual(builders.full(core, { ...s, [key]: true }), builders.full(core, { ...s, [key]: false })); checks++;
}
const scoped = (s, scope, tuning) => core.buildScopedOutputPrompt({ segments: [], sourceContext: '', settings: s, scope, tuning, speakerIdentity: identity });
const hints = { dialogueEndingRepeatHints: [{ ending: 'HINT_SENTINEL', count: 9 }] };
contains(scoped(short, 'target_dialogue', hints), 'HINT_SENTINEL');
absent(scoped({ ...short, dialogueEndingRepetitionReduction: false }, 'target_dialogue', hints), 'HINT_SENTINEL');
absent(scoped(short, 'narration', hints), 'HINT_SENTINEL');
absent(scoped(short, 'other_dialogue', hints), 'HINT_SENTINEL');
const flavors = { ...short, koreanFlavorEnabled: true, englishFlavorEnabled: true, expressionDisfluencyTaste: 'active' };
for (const scope of ['narration', 'tagged_content']) {
    const p = scoped(flavors, scope);
    for (const fragment of ['rhythm=', 'interjections=', 'conversation=', 'slang=', 'disfluency=']) absent(p, fragment);
    contains(p, 'pronoun omission='); contains(p, 'referent repetition:');
}
const dialogue = scoped(flavors, 'target_dialogue');
for (const fragment of ['rhythm=', 'interjections=', 'conversation=', 'slang=', 'disfluency=']) contains(dialogue, fragment);
// Dialogue-only settings must not alter a narration request at all.
for (const key of ['koreanFlavorDialogueRhythm', 'koreanFlavorInterjectionTone', 'englishFlavorDialogueRhythm',
    'englishFlavorConversationNaturalization', 'englishFlavorSlangDensity', 'englishFlavorInterjectionTone', 'expressionDisfluencyTaste']) {
    equal(scoped({ ...flavors, [key]: 'default' }, 'narration'), scoped({ ...flavors, [key]: 'active' }, 'narration'), 'narration leak: ' + key);
}

const hongjin = { ...short, developerHongjinFlavorEnabled: true, developerHongjinOppaFrequency: 'often' };
contains(builders.full(core, hongjin), 'if the character is clearly not male, never add');
contains(builders.full(core, hongjin), 'never second-person you or USER/NPC wording');
contains(builders.full(core, { ...hongjin, developerHongjinOppaFrequency: 'rare' }), 'at most one');
absent(builders.narration(core, hongjin), 'KIM HONG-JIN FLAVOR');
absent(builders.other_dialogue(core, hongjin), 'KIM HONG-JIN FLAVOR');
contains(builders.full(core, { ...hongjin, developerMadKoreanOutputEnabled: true }), 'SOLE VOICE EXCEPTION');
const female = core.buildOutputPrompt(segmented, hongjin, '', { ...identity, characterGender: 'female' });
contains(female, 'TARGET CHARACTER gender="female"'); contains(female, 'if the character is clearly not male, never add');
const stressed = { ...flavors, ...authored, ...hongjin, developerRelationshipExperimentEnabled: true,
    developerTargetToUserAddress: 'ADDRESS_SENTINEL', developerTargetToUserRegister: 'banmal', developerTargetToOtherRegister: 'jondaetmal',
    developerHongjinAgeBand: 'late20s', beginnerCharacterGuideEnabled: true, beginnerPersonalityCustom: 'PERSONALITY_SENTINEL',
    dialogueEndingPreferred: 'PREFERRED_SENTINEL', dialogueEndingAvoid: 'AVOIDED_SENTINEL',
    baseTranslationCustom: { enabled: true, prompt: 'CUSTOM_BASE_SENTINEL' }, bannedWords: 'UNIQUE_BAN_SENTINEL' };
for (const [name, build] of Object.entries(builders)) {
    const oldSettings = { ...stressed, developerCompressedPromptEnabled: false };
    if (baseline) equal(build(core, oldSettings), build(baseline, oldSettings), 'populated legacy drift: ' + name);
}
contains(builders.target_dialogue(core, stressed), 'ADDRESS_SENTINEL');
contains(builders.target_dialogue(core, stressed), 'PERSONALITY_SENTINEL');
absent(builders.other_dialogue(core, stressed), 'ADDRESS_SENTINEL');
absent(builders.narration(core, stressed), 'PERSONALITY_SENTINEL');
for (const name of ['bannedRepair', 'selection', 'selectionDialogue', 'multi', 'qa']) {
    for (const mad of [false, true]) equal(count(builders[name](core, { ...short, bannedWords: 'UNIQUE_BAN_SENTINEL', developerMadKoreanOutputEnabled: mad }), 'UNIQUE_BAN_SENTINEL'), 1, 'duplicate ban list: ' + name);
}

// Execute the real preset helpers and OFF state assignments with in-memory settings.
const state = { ...defaults, baseTranslationCustom: normalizeBaseTranslationCustom({}) };
const funcs = index.slice(index.indexOf('function normalizedPromptPresetDeveloperSettings('), index.indexOf('function normalizedPromptPresetTranslationSettings('));
const apply = index.slice(index.indexOf('function applyPromptPresetDeveloperSettings('), index.indexOf('function applyPromptPresetTranslationSettings('));
const helpers = Function('normalizeBaseTranslationCustom', 'settings', definitions + '\n' + funcs + '\n' + apply + '\nreturn {snap:currentPromptPresetDeveloperSettingsSnapshot, apply:applyPromptPresetDeveloperSettings};')(normalizeBaseTranslationCustom, state);
const preset = JSON.parse(JSON.stringify(helpers.snap(hongjin)));
helpers.apply(preset);
equal(state.developerMode, false); equal(state.developerCompressedPromptEnabled, true);
equal(Object.hasOwn(preset, 'developerMode'), false);
equal(Object.hasOwn(preset, 'developerAccessFingerprint'), false);
const offStart = index.indexOf("if (target.closest('#verba-developer-mode-off'))");
const offBody = index.slice(offStart, index.indexOf('saveSettings();', offStart)).split('\n').slice(1).join('\n');
Function('settings', offBody)(state);
for (const key of ['developerMode', 'developerCompressedPromptEnabled', 'developerHongjinFlavorEnabled', 'developerMadKoreanOutputEnabled']) equal(state[key], false);
state.developerMode = true; equal(state.developerCompressedPromptEnabled, false);
equal(preset.developerCompressedPromptEnabled, true, 'preset asset must survive OFF');
helpers.apply(preset); equal(state.developerCompressedPromptEnabled, true);

console.log('PASS: ' + checks + ' assertions; API calls: 0; live browser testing: not performed.');
console.table(measures.filter(row => row.mode === 'standard' || row.name === 'full'));
