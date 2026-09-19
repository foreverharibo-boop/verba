import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { normalizeBaseTranslationCustom } from '../base-editor.js';

// Prompt construction only: no API, credentials, browser state, or settings writes.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '혜담은', characterGender: 'male', nameLocks: [] };
const segmented = { protectedText: '', segments: [
    { id: 'seg_0000', type: 'narration', text: '' },
    { id: 'seg_0001', type: 'dialogue_candidate', text: '""' },
], nameTokens: [] };
const translations = new Map(segmented.segments.map(row => [row.id, '']));
const selection = { source: '', sourceContext: '', translation: '""', selected: '""', start: 0, end: 2, oneTimeInstruction: '', speakerIdentity: identity };
const builders = {
    full: s => core.buildOutputPrompt(segmented, s, '', identity),
    narration: s => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings: s, scope: 'narration', speakerIdentity: identity }),
    target: s => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings: s, scope: 'target_dialogue', speakerIdentity: identity }),
    other: s => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings: s, scope: 'other_dialogue', speakerIdentity: identity }),
    tagged: s => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings: s, scope: 'tagged_content', speakerIdentity: identity }),
    input: s => core.buildInputPrompt('', s, 'male', identity),
    selection: s => core.buildSelectionPrompt({ ...selection, settings: s, speakerScope: 'target_dialogue' }),
    multi: s => core.buildMultiSelectionPrompt({ source: '', translation: '""', selections: [{ id: 'm0', selected: '""', start: 0, end: 2, speakerScope: 'target_dialogue' }], settings: s, oneTimeInstruction: '', speakerIdentity: identity }),
    qa: s => core.buildQualityAuditPrompt({ segments: segmented.segments, currentTranslations: translations, sourceContext: '', settings: s, speakerIdentity: identity, enabledChecks: ['meaning', 'referent', 'voice', 'translationese', 'continuity'] }),
    bannedRepair: s => core.buildBannedRepairPrompt(segmented.segments, translations, s, identity),
    tokenRepair: s => core.buildProtectedTokenRepairPrompt(segmented.segments, translations, s, identity),
    untranslatedRepair: s => core.buildUntranslatedRepairPrompt(segmented.segments, translations, s, identity),
    termRepair: s => core.buildTermConsistencyRepairPrompt({ rows: [], terms: [], settings: s }),
    rolePlan: s => core.buildRoleTermPlanPrompt({ sourceContext: '', terms: [], settings: s }),
    attribution: s => core.buildSpeakerAttributionPrompt(segmented, identity, s),
    nameMatch: s => core.buildNameMatchPrompt({ ...selection, settings: s }),
    nameHistory: s => core.buildNameHistoryFormsPrompt({ sourceName: '', currentName: '', candidates: [], settings: s }),
};

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const has = (text, value, message = value) => ok(text.includes(value), message);
const lacks = (text, value, message = value) => ok(!text.includes(value), message);
const count = (text, value) => text.split(value).length - 1;
const base = { ...defaults, developerMode: true };
const measures = [];

for (const [mode, flags] of Object.entries({
    standard: {},
    mad: { developerMadKoreanOutputEnabled: true },
    madHongjin: { developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true },
})) {
    for (const [name, build] of Object.entries(builders)) {
        const safe = build({ ...base, ...flags, developerCompressedPromptEnabled: true });
        const extreme = build({ ...base, ...flags, developerExtremeCompressedPromptEnabled: true });
        ok(mode === 'standard' ? extreme.length < safe.length : extreme.length <= safe.length, `${mode}/${name} must not exceed safe mode`);
        ok(build({ ...defaults, ...flags, developerExtremeCompressedPromptEnabled: true }) === build({ ...defaults, ...flags }), `${mode}/${name} developer gate`);
        measures.push({ mode, name, safe: safe.length, extreme: extreme.length, reduction: +(100 * (1 - extreme.length / safe.length)).toFixed(1) });
    }
}

const standardSettings = {
    ...base,
    developerExtremeCompressedPromptEnabled: true,
    globalPrompt: 'GLOBAL_SENTINEL',
    allDialoguePrompt: 'ALL_DIALOGUE_SENTINEL',
    dialoguePrompt: 'TARGET_DIALOGUE_SENTINEL',
    otherDialoguePrompt: 'OTHER_DIALOGUE_SENTINEL',
    bannedWords: 'BAN_SENTINEL',
};
const standardFull = builders.full(standardSettings);
for (const value of ['GLOBAL_SENTINEL', 'ALL_DIALOGUE_SENTINEL', 'TARGET_DIALOGUE_SENTINEL', 'OTHER_DIALOGUE_SENTINEL', 'BAN_SENTINEL']) has(standardFull, value);
has(builders.target(standardSettings), 'TARGET_DIALOGUE_SENTINEL');
lacks(builders.target(standardSettings), 'OTHER_DIALOGUE_SENTINEL');
has(builders.other(standardSettings), 'OTHER_DIALOGUE_SENTINEL');
lacks(builders.other(standardSettings), 'TARGET_DIALOGUE_SENTINEL');
lacks(builders.input(standardSettings), 'GLOBAL_SENTINEL');

const madSettings = { ...standardSettings, developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true };
const madPrompt = builders.full(madSettings);
has(madPrompt, 'TARGET CHARACTER AUTHORING PATH');
has(madPrompt, 'DEEPSEEK V4.1 FLASH — CURRENT TARGET CHARACTER DIALOGUE VOICE PASS');
has(madPrompt, 'MAD KOREAN EXCLUSIVE ENGINE — FACT-LOCKED KOREAN REAUTHORING');
has(madPrompt, 'DEEPSEEK V4.1 FLASH EXECUTION ORDER');
has(madPrompt, 'MUST still sound like the established character');
has(madPrompt, 'direct no curse at USER');
has(madPrompt, 'USER-DIRECTED PROFANITY GUARD');
has(madPrompt, 'NON-NEGOTIABLE ENGINE SAFETY — NOT STYLE PROMPTS');
has(madPrompt, 'BAN_SENTINEL');
for (const value of ['GLOBAL_SENTINEL', 'ALL_DIALOGUE_SENTINEL', 'TARGET_DIALOGUE_SENTINEL', 'OTHER_DIALOGUE_SENTINEL']) lacks(madPrompt, value);
assert.equal(count(madPrompt, 'TOP PRIORITY — NO MISOGYNY'), 1); checks += 1;
assert.ok(count(madPrompt, 'USER-DIRECTED PROFANITY GUARD') >= 1); checks += 1;
lacks(madPrompt, 'generate three');
lacks(builders.narration(madSettings), 'CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT');
has(builders.narration(madSettings), 'MAD FLASH V2 — SINGLE-PASS KOREAN COMPOSITION');
has(builders.target(madSettings), 'CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT');
has(builders.target(madSettings), 'HIGH BOUNDARIES' .replace('HIGH ', 'HARD '));

for (const compressed of [false, true]) {
    const prompt = builders.target({ ...base, developerCompressedPromptEnabled: compressed, developerHongjinFlavorEnabled: true });
    has(prompt, 'USER-DIRECTED PROFANITY GUARD');
}

// Presets retain the extreme choice and normalize conflicting compression flags.
const state = { ...defaults, baseTranslationCustom: normalizeBaseTranslationCustom({}) };
const funcs = index.slice(index.indexOf('function normalizedPromptPresetDeveloperSettings('), index.indexOf('function normalizedPromptPresetTranslationSettings('));
const applySource = index.slice(index.indexOf('function applyPromptPresetDeveloperSettings('), index.indexOf('function applyPromptPresetTranslationSettings('));
const helpers = Function('normalizeBaseTranslationCustom', 'settings', definitions + '\n' + funcs + '\n' + applySource + '\nreturn {snap:currentPromptPresetDeveloperSettingsSnapshot,apply:applyPromptPresetDeveloperSettings};')(normalizeBaseTranslationCustom, state);
const preset = helpers.snap({ ...defaults, developerCompressedPromptEnabled: true, developerExtremeCompressedPromptEnabled: true, baseTranslationCustom: normalizeBaseTranslationCustom({}) });
assert.equal(preset.developerCompressedPromptEnabled, false); checks += 1;
assert.equal(preset.developerExtremeCompressedPromptEnabled, true); checks += 1;
helpers.apply(preset);
assert.equal(state.developerCompressedPromptEnabled, false); checks += 1;
assert.equal(state.developerExtremeCompressedPromptEnabled, true); checks += 1;

for (const marker of ['xxx미친압축xxx', 'verba-deep-developer-extreme-compressed-prompt-enabled', "settings.developerExtremeCompressedPromptEnabled = false"]) has(index, marker);
const safeHandler = index.slice(index.indexOf("if (target.id === 'verba-deep-developer-compressed-prompt-enabled'"), index.indexOf("if (target.id === 'verba-deep-developer-extreme-compressed-prompt-enabled'"));
const extremeHandler = index.slice(index.indexOf("if (target.id === 'verba-deep-developer-extreme-compressed-prompt-enabled'"), index.indexOf("if (target.id === 'verba-deep-beginner-character-enabled'"));
has(safeHandler, 'settings.developerExtremeCompressedPromptEnabled = false', 'safe compression disables extreme');
has(extremeHandler, 'settings.developerCompressedPromptEnabled = false', 'extreme compression disables safe');

// Settings must affect the actual request in their intended scopes, not merely exist in the UI.
const scoped = (flags, scope = 'target_dialogue', tuning = null, who = identity) => core.buildScopedOutputPrompt({
    segments: [{ id: 's1', type: scope, text: 'Alex said, "Wait here."' }],
    sourceContext: '', settings: { ...base, developerExtremeCompressedPromptEnabled: true, ...flags },
    scope, tuning, speakerIdentity: who,
});
for (const [enabled, repeat] of [
    ['koreanFlavorEnabled', 'koreanFlavorReduceReferentRepetition'],
    ['englishFlavorEnabled', 'englishFlavorReduceReferentRepetition'],
]) {
    for (const scope of ['narration', 'target_dialogue', 'other_dialogue', 'tagged_content']) {
        ok(scoped({ [enabled]: true, [repeat]: true }, scope) !== scoped({ [enabled]: true, [repeat]: false }, scope), `${repeat}/${scope} ON/OFF affects request`);
        ok(scoped({ [enabled]: false, [repeat]: true }, scope) === scoped({ [enabled]: false, [repeat]: false }, scope), `${repeat}/${scope} disabled parent excludes rule`);
    }
    ok(scoped({ [enabled]: true, [repeat]: true, developerMadKoreanOutputEnabled: true }) === scoped({ [enabled]: true, [repeat]: false, developerMadKoreanOutputEnabled: true }), `${repeat} Mad exclusion`);
}
for (const [enabled, keys] of [
    [null, ['expressionDisfluencyTaste']],
    ['koreanFlavorEnabled', ['koreanFlavorDialogueRhythm', 'koreanFlavorInterjectionTone']],
    ['englishFlavorEnabled', ['englishFlavorDialogueRhythm', 'englishFlavorConversationNaturalization', 'englishFlavorSlangDensity', 'englishFlavorInterjectionTone']],
]) {
    const flags = enabled ? { [enabled]: true } : {};
    for (const key of keys) {
        for (const scope of ['narration', 'tagged_content']) {
            ok(scoped({ ...flags, [key]: 'SETTING_A' }, scope) === scoped({ ...flags, [key]: 'SETTING_B' }, scope), `${key} excluded from ${scope}`);
        }
        for (const scope of ['target_dialogue', 'other_dialogue', 'dialogue_mixed']) {
            ok(scoped({ ...flags, [key]: 'SETTING_A' }, scope) !== scoped({ ...flags, [key]: 'SETTING_B' }, scope), `${key} retained in ${scope}`);
        }
    }
}
const tuning = { dialogueEndingRepeatHints: [{ ending: 'RECENT_ENDING', count: 8 }, null, { ending: ' ', count: 9 }] };
has(scoped({}, 'target_dialogue', tuning), '"ending":"RECENT_ENDING","count":8');
lacks(scoped({ dialogueEndingRepetitionReduction: false }, 'target_dialogue', tuning), 'RECENT_ENDING');
for (const scope of ['narration', 'other_dialogue', 'tagged_content']) lacks(scoped({}, scope, tuning), 'RECENT_ENDING');
lacks(scoped({ developerMadKoreanOutputEnabled: true }, 'target_dialogue', tuning), 'RECENT_ENDING');
for (const gender of ['male', 'female', 'unknown']) {
    for (const scope of ['mixed', 'narration', 'target_dialogue', 'other_dialogue']) {
        const p = scoped({ developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true, developerHongjinOppaFrequency: 'often' }, scope, null, { ...identity, characterGender: gender });
        has(p, `gender=${JSON.stringify(gender)}`, `Mad identity gender/${scope}`);
        if (scope === 'target_dialogue') has(p, 'CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT');
    }
}
for (const mad of [false, true]) {
    for (const scope of ['mixed', 'narration', 'target_dialogue', 'other_dialogue', 'tagged_content']) {
        const flags = { developerMadKoreanOutputEnabled: mad };
        has(scoped(flags, scope), mad ? 'MAD FLASH V2 — SINGLE-PASS KOREAN COMPOSITION' : 'Transliterate clear Latin-script human names into Hangul');
        const p = scoped(flags, scope, null, { ...identity, nameLocks: [{ source: 'Alex', target: '알렉스고정' }] });
        has(p, '알렉스고정');
        has(p, 'FIXED-SPELLING PRIORITY');
    }
}

console.log(`PASS: ${checks} assertions; API calls: 0; live browser testing: not performed.`);
console.table(measures.filter(row => row.mode === 'standard' || row.name === 'full'));
