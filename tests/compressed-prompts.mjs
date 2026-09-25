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
            const policySection = (p, start, end) => p.slice(p.indexOf(start), p.indexOf(end) + end.length);
            for (const [start, end] of [['TOP PRIORITY — NO MISOGYNY', 'END TOP PRIORITY'], ['NATURAL COLLOCATIONS AND SOURCE IMAGERY:', 'END IDIOMATIC EXPRESSION']]) {
                assert.ok(policySection(compact, start, end).length < policySection(full, start, end).length * 0.65,
                    'new policies must be materially shorter in compressed mode: ' + name); checks++;
            }
            for (const prompt of [full, compact]) {
                equal(count(prompt, 'TOP PRIORITY — NO MISOGYNY'), 1, 'misogyny rule once: ' + name);
                equal(count(prompt, 'END TOP PRIORITY'), 1, 'complete top priority: ' + name);
                assert.ok(prompt.indexOf('TOP PRIORITY — NO MISOGYNY') < prompt.indexOf('MAD KOREAN EXCLUSIVE'),
                    'ban precedes style engine: ' + name); checks++;
                contains(prompt, '네 년'); contains(prompt, '2026년/몇 년');
                equal(count(prompt, '년/네 년/이년/저년/미친년/독한 년/씨발년/시발년/썅년/개년/김치녀/된장녀/맘충/보지년/걸레년/창녀/암캐/계집/계집애'), 1,
                    'one prohibited-form list even with Hongjin: ' + name);
                absent(prompt, 'HARD SAFETY / VOICE RULE — NO MISOGYNISTIC WORDING');
                absent(prompt, 'ABSOLUTE LEXICAL BAN: Never use');
                absent(prompt, 'Never use “년” as a person label or insult');
                absent(prompt, 'MODERN KOREAN');
                equal(count(prompt, 'CLOSE-POV ROUGH DICTION:'), 1, 'rough narration preserved once: ' + name);
                absent(prompt, 'Did Korean naturalization add slang, insult, threat');
                absent(prompt, 'Did any speaker acquire an invented “-가놈/-놈/-녀석/-새끼” address');
                equal(count(prompt, writingStart), 1, 'shared writing standard once: ' + name);
                equal(count(prompt, writingEnd), 1, 'complete writing standard: ' + name);
                const block = prompt.slice(prompt.indexOf(writingStart), prompt.indexOf(writingEnd) + writingEnd.length);
                const shared = block.replace(/DEEPSEEK V4\.1 FLASH[\s\S]*?END DEEPSEEK FLASH (?:WORKFLOW|EXECUTION ORDER)/u, 'DEEPSEEK_FLASH_WORKFLOW')
                    .replace(/NATURAL COLLOCATIONS AND SOURCE IMAGERY:[\s\S]*?END IDIOMATIC EXPRESSION/u, 'IDIOM_POLICY')
                    .replace(/DIALOGUE TIME AND GROUP REFERENCES —[\s\S]*?END DIALOGUE TIME AND GROUP REFERENCES/u, 'TIME_GROUP_POLICY');
                sharedWritingBlock ??= shared;
                equal(shared, sharedWritingBlock, 'remaining writing criteria/examples unchanged across modes: ' + name);
                equal(count(block, 'END IDIOMATIC EXPRESSION'), 1, 'complete idiom policy once: ' + name);
                const idiom = policySection(block, 'NATURAL COLLOCATIONS AND SOURCE IMAGERY:', 'END IDIOMATIC EXPRESSION');
                contains(idiom, 'spoken Korean'); contains(idiom, 'actions/states');
                contains(idiom, 'wordplay effects'); contains(idiom, 'target of abuse');
                contains(idiom, 'configured profanity/vulgarity/teasing');
                contains(idiom, 'PRIMARY CAST REFERENCES');
                equal(count(prompt, 'NATURAL VOCATIVES:'), 1, 'vocative rule once: ' + name);
                equal(count(prompt, 'SUBJECT OR VOCATIVE:'), 1, 'subject/vocative rule once: ' + name);
                contains(block, 'never turn a reference to a third person into direct address');
                contains(block, 'neither 께서 nor playful honorifics are banned');
                contains(block, 'Preserve configured 반말/존댓말 and established relationships');
                contains(block, 'Do not place a comma after every name or invent a nickname or action');
                absent(block, 'omission must still meet the applicable subject/possessive rule');
                contains(block, 'ellipsis fidelity remains unchanged');
                equal(count(prompt, 'EVERYDAY KOREAN EXAMPLES —'), 1, 'everyday examples once: ' + name);
                contains(block, '"I can explain." → "잠깐만, 말 좀 들어봐."');
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
                absent(prompt, 'Omit recoverable subjects/possessors when clear.');
                absent(prompt, 'OMIT ONLY WHEN MORE NATURAL:', 'no subject-omission criterion: ' + name);
                absent(prompt, 'Mere recoverability is insufficient.');
                equal(count(prompt, 'RE-ANCHOR THE SUBJECT:'), 1, 'subject re-anchoring once: ' + name);
                contains(prompt, 'EVEN IF THE SAME PERSON CONTINUES');
                contains(prompt, 'At a new paragraph linking speech and action, normally identify');
                contains(prompt, 'Prefer 그/그녀 when clear');
                absent(prompt, 'a new paragraph alone does not mandate a name');
                absent(prompt, 'a paragraph break alone does not require repeating a name');
                equal(count(prompt, 'SOURCE ELLIPSIS FIDELITY:'), 1, 'ellipsis rule once: ' + name);
                contains(prompt, '"..." stays "..."');
                contains(prompt, '"…" stays "…"');
                contains(prompt, '"……" stays "……"');
                contains(prompt, 'preserve only pauses belonging to that fragment');
                contains(prompt, 'optional voice add-on enabled');
                contains(block, 'Stuttering/restarts, commas, sleepy speech, and sentence breaks do not authorize trailing dots');
                contains(block, 'compare ellipsis sequences in each target with its source in order');
                contains(block, 'including zero when none exist');
                contains(block, 'source meaning, facts, emotions');
                contains(block, 'subject–predicate, verb–object');
                equal(count(prompt, 'NATURAL INSULT REFERENCES:'), 1, 'name/title abuse rule once: ' + name);
                contains(block, 'an established name/title followed by a natural insult phrase is ALLOWED');
                contains(block, 'Without a source insult or an applicable voice permission, use the ordinary name/pronoun');
                equal(count(prompt, 'EVERYDAY OBJECT NAMES:'), 1, 'contextual object naming once: ' + name);
                contains(block, 'never override an explicit description or a plot-relevant distinction');
                contains(block, '단백질 바 rather than generic 보존식');
                contains(block, 'never turn explicit packet noodles into a cup');
                contains(block, 'contextual choices, not automatic substitutions');
                absent(prompt, 'Never create a Korean-only insult by fusing a name');
                equal(count(prompt, 'NATURAL COLLOCATIONS AND SOURCE IMAGERY:'), 1, 'imagery rule once: ' + name);
                contains(prompt, 'decorative metaphor');
                contains(prompt, 'meaningful imagery');
                contains(prompt, '“그/그녀/그의/그녀의” and grammatically inflected forms are ALLOWED.');
                contains(prompt, 'SPELLING, NOT FREQUENCY:');
                contains(prompt, 'Do not rotate through “여자/남자/녀석/상대/사람/사내/청년/작은 몸”');
                contains(prompt, 'do not expand a given name into a full name');
                absent(prompt, 'Canonical names are the default');
                absent(prompt, 'use the canonical name as the reference by default');
                absent(prompt, 'not “그/그녀/그의/그녀의”');
                absent(prompt, 'do not add a reference to every sentence or every paragraph mechanically');
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
        equal(build(core, { ...s, developerMode: false }), build(core, { ...s, developerMode: true, developerCompressedPromptEnabled: false, developerExtremeCompressedPromptEnabled: false }), 'general flavors survive lock: ' + name);
        if (changedMadRule && name === 'full') assert.ok(compact.length < full.length * 0.65, 'Mad compression must remain substantial');
        measures.push({ mode: flags.developerHongjinFlavorEnabled ? 'mad+hongjin' : flags.developerMadKoreanOutputEnabled ? 'mad' : 'standard', name,
            long: [...full].length, compact: [...compact].length, reduction: +((1 - [...compact].length / [...full].length) * 100).toFixed(1) });
    }
}

function hasHongjinVoice(prompt) {
    return prompt.includes('DEVELOPER KIM HONGJIN FLAVOR — TARGET CHARACTER DIALOGUE ONLY')
        || prompt.includes('KIM HONG-JIN FLAVOR — TARGET CHARACTER DIALOGUE ONLY');
}
// Contemporary twenties speech stays scoped to the target; natural insult references stay authorized and scoped at all profanity levels.
for (const age of ['early20s', 'late20s', 'thirties']) {
    for (const compressed of [false, true]) {
        for (const mad of [false, true]) {
            for (const profanity of ['low', 'natural', 'high']) {
                for (const [name, build] of Object.entries(builders)) {
                    const settings = { ...short, developerCompressedPromptEnabled: compressed,
                        developerMadKoreanOutputEnabled: mad, developerHongjinFlavorEnabled: true,
                        developerHongjinAgeBand: age, developerHongjinProfanity: profanity };
                    const prompt = build(core, settings);
                    const active = hasHongjinVoice(prompt);
                    const twenties = age !== 'thirties';
                    const label = `${name}/${age}/${compressed}/${mad}/${profanity}`;
                    equal(count(prompt, '/ MANDATORY CASUAL DELIVERY'), active && twenties && !compressed ? 1 : 0, 'v23 age scope: ' + label);
                    absent(prompt, '/ CONTEMPORARY EVERYDAY SPEECH');
                    const policyActive = active || (mad && madWritingRoutes.has(name));
                    equal(count(prompt, 'TOP PRIORITY — NO MISOGYNY'), policyActive ? 1 : 0, 'ban scope: ' + label);
                    absent(prompt, 'MODERN KOREAN');
                    if (policyActive) {
                        contains(prompt, 'spac'); contains(prompt, 'punctuation');
                        contains(prompt, 'year units'); contains(prompt, 'non-gendered');
                        contains(prompt, 'Before returning'); contains(prompt, 'every');
                    }
                    if (active && twenties) {
                        if (compressed) contains(prompt, 'mandatory contemporary casual');
                        else {
                            contains(prompt, 'Never make the line stiff, old-fashioned, literary, bureaucratic, or generically middle-aged.');
                            contains(prompt, 'make even 존댓말 relaxed and naturally spoken');
                        }
                    }
                    equal(count(prompt, 'NATURAL INSULT REFERENCES:'), active || (mad && madWritingRoutes.has(name)) ? 1 : 0, 'address guard once: ' + label);
                    equal(count(prompt, 'SUBJECT OR VOCATIVE:'), active || (mad && madWritingRoutes.has(name)) ? 1 : 0, 'subject/vocative scope: ' + label);
                    if (active) {
                        contains(prompt, 'an established name/title followed by a natural insult phrase is ALLOWED');
                        contains(prompt, 'Avoid awkward stacked forms such as “최 씨 놈”');
                        contains(prompt, 'preserve name locks and the hard ban on misogynistic wording');
                        absent(prompt, 'any name-plus-insult address');
                        absent(prompt, 'A bare source name/title must remain a name/title, not become an insult');
                        absent(prompt, 'Never manufacture a Korean-only abusive nickname');
                    }
                    if (mad && madWritingRoutes.has(name)) {
                        absent(prompt, 'A joking warlord may be');
                        contains(prompt, 'RE-ANCHOR THE SUBJECT:');
                    }
                    equal(build(core, { ...settings, developerMode: false }), build(core, { ...settings, developerMode: true, developerCompressedPromptEnabled: false, developerExtremeCompressedPromptEnabled: false }), 'general voice and ban remain active: ' + label);
                    absent(build(core, { ...settings, developerHongjinFlavorEnabled: false }), '/ CONTEMPORARY EVERYDAY SPEECH', 'Hongjin off: ' + label);
                }
            }
        }
    }
}

// Every voice strength must defer to Mad composition, in both encodings and all routes.
let sharedVoicePriority;
for (const strength of ['light', 'strong', 'maximum']) {
    for (const compressed of [false, true]) {
        for (const [name, build] of Object.entries(builders)) {
            const settings = { ...short, developerCompressedPromptEnabled: compressed,
                developerHongjinFlavorEnabled: true, developerHongjinTranscreation: strength };
            // Standalone Hongjin now shares the revised natural-reference rule; unaffected scopes stay byte-identical.
            const standalone = build(core, settings);
            if (baseline && !hasHongjinVoice(standalone)) equal(standalone, build(baseline, settings), 'standalone unaffected scope: ' + name);
            const mad = { ...settings, developerMadKoreanOutputEnabled: true };
            const prompt = build(core, mad);
            const voiceActive = prompt.includes('DEVELOPER KIM HONGJIN FLAVOR — TARGET CHARACTER DIALOGUE ONLY')
                || prompt.includes('KIM HONG-JIN FLAVOR — TARGET CHARACTER DIALOGUE ONLY');
            const label = `${name}/${strength}/${compressed}`;
            equal(count(prompt, 'MAD KOREAN + HONGJIN — VOICE-ONLY PRIORITY'), voiceActive ? 1 : 0, 'voice priority scoped once: ' + label);
            if (voiceActive) {
                equal(count(prompt, 'DEEPSEEK V4.1 FLASH — KIM HONG-JIN DIALOGUE VOICE PASS')
                    + count(prompt, 'DEEPSEEK HONGJIN VOICE PASS — hidden'), 1, 'DeepSeek Hongjin voice pass once: ' + label);
                contains(prompt, 'speech act', label);
                contains(prompt, 'read', label);
                if (compressed) {
                    contains(prompt, 'never aim it at USER', label);
                    contains(prompt, 'Serious/urgent lines stay terse and serious, but serious does not mean clean', label);
                } else {
                    contains(prompt, 'direct no curse at USER', label);
                    contains(prompt, 'An urgent command should remain short', label);
                }
                absent(prompt, 'drop recoverable subjects', label);
                absent(prompt, 'Keep the source meaning and rough sentence shape recognizable', label);
                absent(prompt, 'repair literal stiffness while keeping the rough source shape', label);
                absent(prompt, 'Mere recoverability is insufficient.', label);
                contains(prompt, 'Do not retain source sentence shape for LIGHT.', label);
                absent(prompt, 'increase omission for STRONG/MAXIMUM.', label);
                contains(prompt, 'voice settings never authorize added/altered ellipses or invented metaphors.', label);
                const priority = prompt.slice(prompt.indexOf('- KOREAN-ORIGINAL COMPOSITION and PRIMARY CAST REFERENCES'),
                    prompt.indexOf('- The voice exception permits the authorized'));
                sharedVoicePriority ??= priority;
                equal(priority, sharedVoicePriority, 'same composition priority across strengths/routes: ' + label);
            }
            absent(build(core, { ...mad, developerHongjinFlavorEnabled: false }), 'MAD KOREAN + HONGJIN — VOICE-ONLY PRIORITY', 'Hongjin off: ' + label);
            const disabled = { ...mad, developerMode: false };
            equal(build(core, disabled), build(core, { ...mad, developerCompressedPromptEnabled: false, developerExtremeCompressedPromptEnabled: false }), 'locked mode retains full flavor prompt: ' + label);
        }
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
contains(builders.full(core, { ...hongjin, developerMadKoreanOutputEnabled: true }), 'MANDATORY AUTHORIZED VOICE OVERRIDE');
const female = core.buildOutputPrompt(segmented, hongjin, '', { ...identity, characterGender: 'female' });
contains(female, 'TARGET CHARACTER gender="female"'); contains(female, 'if the character is clearly not male, never add');
const stressed = { ...flavors, ...authored, ...hongjin, developerRelationshipExperimentEnabled: true,
    developerTargetToUserAddress: 'ADDRESS_SENTINEL', developerTargetToUserRegister: 'banmal', developerTargetToOtherRegister: 'jondaetmal',
    developerHongjinAgeBand: 'late20s', beginnerCharacterGuideEnabled: true, beginnerPersonalityCustom: 'PERSONALITY_SENTINEL',
    dialogueEndingPreferred: 'PREFERRED_SENTINEL', dialogueEndingAvoid: 'AVOIDED_SENTINEL',
    baseTranslationCustom: { enabled: true, prompt: 'CUSTOM_BASE_SENTINEL' }, bannedWords: 'UNIQUE_BAN_SENTINEL' };
for (const [name, build] of Object.entries(builders)) {
    const oldSettings = { ...stressed, developerCompressedPromptEnabled: false };
    const populated = build(core, oldSettings);
    if (baseline && !hasHongjinVoice(populated)) equal(populated, build(baseline, oldSettings), 'populated unaffected scope: ' + name);
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
const offStart = index.indexOf("if (target.closest('#verba-deep-developer-mode-off'))");
const offBody = index.slice(offStart, index.indexOf('saveSettings();', offStart)).split('\n').slice(1).join('\n');
Function('settings', offBody)(state);
for (const key of ['developerMode', 'developerCompressedPromptEnabled']) equal(state[key], false);
equal(state.developerHongjinFlavorEnabled, preset.developerHongjinFlavorEnabled);
equal(state.developerMadKoreanOutputEnabled, preset.developerMadKoreanOutputEnabled);
state.developerMode = true; equal(state.developerCompressedPromptEnabled, false);
equal(preset.developerCompressedPromptEnabled, true, 'preset asset must survive OFF');
helpers.apply(preset); equal(state.developerCompressedPromptEnabled, true);

console.log('PASS: ' + checks + ' assertions; API calls: 0; live browser testing: not performed.');
console.table(measures.filter(row => row.mode === 'standard' || row.name === 'full'));
