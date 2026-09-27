import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '홍진', userName: '담은', characterGender: 'male' };
const segments = [{ id: 'seg_0000', type: 'narration', text: 'We stayed together.' }];
const forbiddenGeneral = [
    'redundant explicit subjects or pronouns',
    'omit recoverable repeated subjects',
    'repeated explicit pronouns',
    'A repeated pronoun may be omitted',
    'turn explicit subjects/possessives into Korean ellipsis',
    'subject repetition',
    'use context, natural omission, Korean clause order',
    'drop recoverable subjects',
];

for (const level of ['preserve', 'light', 'balanced', 'naturalized', 'native']) {
    const settings = {
        ...defaults,
        developerMode: true,
        developerMadKoreanOutputEnabled: false,
        developerHongjinFlavorEnabled: false,
        koreanFlavorEnabled: false,
        narrationLocalizationLevel: level,
        dialogueLocalizationLevel: level,
    };
    for (const scope of ['narration', 'target_dialogue']) {
        const prompt = core.buildScopedOutputPrompt({ segments, sourceContext: '', settings, scope, speakerIdentity: identity });
        for (const phrase of forbiddenGeneral) assert.ok(!prompt.includes(phrase), `${level}/${scope}: ${phrase}`);
    }
}

for (const compressed of [{}, { developerCompressedPromptEnabled: true }, { developerExtremeCompressedPromptEnabled: true }]) {
    const settings = {
        ...defaults,
        ...compressed,
        developerMode: true,
        developerMadKoreanOutputEnabled: true,
        developerHongjinFlavorEnabled: true,
    };
    const prompt = core.buildScopedOutputPrompt({ segments, sourceContext: '', settings, scope: 'target_dialogue', speakerIdentity: identity });
    for (const phrase of [
        'OMIT ONLY WHEN MORE NATURAL:',
        'omit a subject or possessive only',
        'Directly connected actions may omit the repeated subject',
        'drop recoverable subjects',
        'natural subject omission instead',
    ]) assert.ok(!prompt.includes(phrase), `Mad Korean: ${phrase}`);
}

const explicit = core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings: {
        ...defaults,
        koreanFlavorEnabled: true,
        koreanFlavorPronounOmission: 'active',
        developerMadKoreanOutputEnabled: false,
    },
    scope: 'narration',
    speakerIdentity: identity,
});
assert.ok(explicit.includes('SUBJECT / PRONOUN EXPRESSION — ACTIVE KOREAN OMISSION'));
console.log('PASS: general and Mad Korean prompts no longer encourage subject/pronoun omission; explicit 한캐 option remains available.');

