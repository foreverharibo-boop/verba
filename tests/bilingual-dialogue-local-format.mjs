import assert from 'node:assert/strict';
import {
    assembleTranslation,
    bilingualDialogueBracketPair,
    bilingualDialogueRequested,
    buildOutputPrompt,
    ensureBilingualDialogueFormat,
    findProtectedTokenIntegrityProblems,
    normalizeLocallyRecoverableProtectedTokens,
    segmentSource,
} from '../core.js';

const instruction = `[BILINGUAL DIALOGUE FORMAT]
For dialogue only, always output both the original English dialogue and its Korean translation.
The English dialogue must appear first, immediately followed by its Korean translation inside parentheses.
Apply this format to ALL spoken dialogue without exception.
Do NOT apply bilingual formatting to narration.`;

const settings = {
    globalPromptEnabled: false,
    allDialoguePromptEnabled: true,
    allDialoguePrompt: instruction,
    dialoguePromptEnabled: false,
    otherDialoguePromptEnabled: false,
};

assert.equal(bilingualDialogueRequested(settings), true);
assert.deepEqual(bilingualDialogueBracketPair(settings), ['(', ')']);

// Regression: an exact direct-dialogue format is mandatory even when it does
// not literally say always/must and separately excludes narration.
const exactFormatInstruction = `[BILINGUAL DIALOGUE FORMAT]
For direct dialogue only, output both the original English dialogue and its Korean translation in this exact format:
"English dialogue. [한국어 번역.]"
Apply this format only to direct dialogue inside quotation marks.
Keep narration in Korean only.
Preserve the original English dialogue exactly in the first part.
Put the Korean translation immediately after it inside parentheses.
Keep both the English and Korean inside the same quotation marks.
Do not create bilingual narration.`;
const exactFormatSettings = {
    ...settings,
    allDialoguePrompt: exactFormatInstruction,
};
assert.equal(bilingualDialogueRequested(exactFormatSettings), true);
assert.deepEqual(bilingualDialogueBracketPair(exactFormatSettings), ['[', ']']);

const shortNamed = segmentSource('"Dana—"\n\n"Nyon."', [
    { source: 'Dana', target: '다나' },
    { source: 'Nyon', target: '니욘' },
]);
const shortDialogues = shortNamed.segments.filter(segment => segment.type === 'dialogue_candidate');
assert.equal(shortDialogues.length, 2);
const shortTranslations = new Map([
    [shortDialogues[0].id, '"다나—"'],
    [shortDialogues[1].id, '"니욘."'],
]);
normalizeLocallyRecoverableProtectedTokens(shortNamed, shortTranslations, exactFormatSettings, {});
assert.equal(shortTranslations.get(shortDialogues[0].id), `"Dana— [${shortNamed.nameTokens[0].token}—]"`);
assert.equal(shortTranslations.get(shortDialogues[1].id), `"Nyon. [${shortNamed.nameTokens[1].token}.]"`);
assert.equal(
    assembleTranslation(shortNamed, shortTranslations),
    '"Dana— [다나—]"\n\n"Nyon. [니욘.]"',
);

const shortPlain = segmentSource('"Yes."');
const shortPlainSegment = shortPlain.segments[0];
assert.equal(
    ensureBilingualDialogueFormat(shortPlainSegment, '"응."', exactFormatSettings),
    '"Yes. [응.]"',
);

const segmented = segmentSource('Alex said, "I did not say that."', [{ source: 'Alex', target: '알렉스' }]);
const narration = segmented.segments.find(segment => segment.type === 'narration');
const dialogue = segmented.segments.find(segment => segment.type === 'dialogue_candidate');
assert.ok(narration && dialogue);

const formatted = ensureBilingualDialogueFormat(
    dialogue,
    '"난 그런 말 안 했어."',
    settings,
    { [dialogue.id]: 'other_dialogue' },
    segmented.nameTokens,
    segmented.tokens,
);
assert.equal(formatted, '"I did not say that. (난 그런 말 안 했어.)"');
assert.equal(ensureBilingualDialogueFormat(narration, '알렉스가 말했다.', settings), '알렉스가 말했다.');
assert.equal(ensureBilingualDialogueFormat(dialogue, formatted, settings), formatted);

const named = segmentSource('*그는 망설였다.*\n\n"Dana..."', [{ source: 'Dana', target: '다나' }]);
const namedDialogue = named.segments.find(segment => segment.type === 'dialogue_candidate');
assert.ok(namedDialogue);
const token = named.nameTokens[0].token;
const koreanOnly = `"${token}..."`;
const namedFormatted = ensureBilingualDialogueFormat(
    namedDialogue, koreanOnly, settings, null, named.nameTokens, named.tokens,
);
assert.equal(namedFormatted, `"Dana... (${token}...)"`);
assert.equal(
    assembleTranslation(named, new Map([[namedDialogue.id, namedFormatted]])),
    '*그는 망설였다.*\n\n"Dana... (다나...)"',
);

// Already bilingual and common malformed variants must be normalized once,
// never nested as Source (Source (Korean)).
const already = `"${token}… (${token}…)"`;
const canonicalAlready = ensureBilingualDialogueFormat(namedDialogue, already, settings, null, named.nameTokens, named.tokens);
assert.equal(canonicalAlready, `"Dana... (${token}…)"`);
assert.equal(
    findProtectedTokenIntegrityProblems(named.segments, new Map([[namedDialogue.id, canonicalAlready]])).length,
    0,
    'bilingual English copy uses literal source names, leaving one strict NAME marker in Korean',
);
const locallyNormalized = new Map([[namedDialogue.id, already]]);
normalizeLocallyRecoverableProtectedTokens(named, locallyNormalized, settings, {});
assert.equal(locallyNormalized.get(namedDialogue.id), `"Dana... (${token}…)"`);
assert.equal(findProtectedTokenIntegrityProblems(named.segments, locallyNormalized).length, 0);

const bilingualNarration = segmentSource('Nyon waited.', [{ source: 'Nyon', target: '니욘' }]);
const narrationSegment = bilingualNarration.segments[0];
const narrationToken = bilingualNarration.nameTokens[0].token;
const narrationTranslations = new Map([[
    narrationSegment.id,
    `${narrationSegment.text} (${narrationToken}은 기다렸다.)`,
]]);
normalizeLocallyRecoverableProtectedTokens(bilingualNarration, narrationTranslations, settings, {});
assert.equal(narrationTranslations.get(narrationSegment.id), `Nyon waited. (${narrationToken}은 기다렸다.)`);
assert.equal(findProtectedTokenIntegrityProblems(bilingualNarration.segments, narrationTranslations).length, 0);
const misplaced = `"${token}…" (${token}…)"`;
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, misplaced, settings, null, named.nameTokens, named.tokens),
    `"Dana... (${token}…)"`,
);
const missingClose = `"Dana... (${token}…"`;
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, missingClose, settings, null, named.nameTokens, named.tokens),
    `"Dana... (${token}…)"`,
);

const squareSettings = {
    ...settings,
    allDialoguePrompt: `${instruction}\nExample: "English dialogue. [한국어 번역.]"`,
};
assert.deepEqual(bilingualDialogueBracketPair(squareSettings), ['[', ']']);
assert.equal(
    ensureBilingualDialogueFormat(dialogue, '"난 그런 말 안 했어."', squareSettings),
    '"I did not say that. [난 그런 말 안 했어.]"',
);

const visibleLockedName = `"${token}… [다나…]"`;
const rebound = ensureBilingualDialogueFormat(
    namedDialogue, visibleLockedName, squareSettings, null, named.nameTokens, named.tokens,
);
assert.equal(rebound, `"Dana... [${token}…]"`);
assert.equal(assembleTranslation(named, new Map([[namedDialogue.id, rebound]])), '*그는 망설였다.*\n\n"Dana... [다나…]"');
assert.equal(
    ensureBilingualDialogueFormat(
        namedDialogue,
        `"${token}... (${token}...)"`,
        squareSettings,
        null,
        named.nameTokens,
        named.tokens,
    ),
    `"Dana... [${token}...]"`,
    'the configured all-dialogue square-bracket format overrides model parentheses',
);

const speakerOnly = {
    ...settings,
    allDialoguePromptEnabled: false,
    dialoguePromptEnabled: true,
    dialoguePrompt: instruction,
};
assert.equal(bilingualDialogueRequested(speakerOnly), false);
assert.equal(ensureBilingualDialogueFormat(dialogue, '"난 그런 말 안 했어."', speakerOnly), '"난 그런 말 안 했어."');

// A full custom translator prompt may request bilingual output without using
// the legacy prompt fields. Existing bilingual output must still be normalized
// locally so NAME tokens in the copied English half never restore to Hangul.
const customOnly = {
    globalPromptEnabled: false,
    allDialoguePromptEnabled: false,
    dialoguePromptEnabled: false,
    otherDialoguePromptEnabled: false,
};
assert.equal(bilingualDialogueRequested(customOnly), false);
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, already, customOnly, null, named.nameTokens, named.tokens),
    `"Dana... (${token}…)"`,
);
assert.equal(
    assembleTranslation(named, new Map([[
        namedDialogue.id,
        ensureBilingualDialogueFormat(namedDialogue, already, customOnly, null, named.nameTokens, named.tokens),
    ]])),
    '*그는 망설였다.*\n\n"Dana... (다나…)"',
);
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, `"${token}… [${token}…]"`, customOnly, null, named.nameTokens, named.tokens),
    `"Dana... [${token}…]"`,
    'an existing custom square-bracket format is preserved',
);
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, `"${token}..." (${token}...)`, customOnly, null, named.nameTokens, named.tokens),
    `"Dana... (${token}...)"`,
    'a model-closing quote before the Korean wrapper is normalized even for a full custom prompt',
);
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, `"${token}…"`, customOnly, null, named.nameTokens, named.tokens),
    `"${token}…"`,
    'Korean-only dialogue is not made bilingual unless a configured prompt requests it',
);

// Regression: multiple locked names in a long bilingual line must be literal
// source spellings only in English and locked Korean spellings only in Korean.
const multiName = segmentSource(
    '"Nyon lies down and thinks about Nyen before Dana arrives."',
    [
        { source: 'Nyon', target: '니욘' },
        { source: 'Nyen', target: '니옌' },
        { source: 'Dana', target: '다나' },
    ],
);
const multiDialogue = multiName.segments.find(segment => segment.type === 'dialogue_candidate');
assert.ok(multiDialogue);
const [nyonToken, nyenToken, danaToken] = multiName.nameTokens.map(entry => entry.token);
const multiRaw = `"${nyonToken} lies down and thinks about ${nyenToken} before ${danaToken} arrives. (${nyonToken}은 ${nyenToken}을 생각하다 ${danaToken}를 만난다.)"`;
const multiFixed = ensureBilingualDialogueFormat(
    multiDialogue, multiRaw, customOnly, null, multiName.nameTokens, multiName.tokens,
);
assert.equal(
    multiFixed,
    `"Nyon lies down and thinks about Nyen before Dana arrives. (${nyonToken}은 ${nyenToken}을 생각하다 ${danaToken}를 만난다.)"`,
);
assert.equal(
    assembleTranslation(multiName, new Map([[multiDialogue.id, multiFixed]])),
    '"Nyon lies down and thinks about Nyen before Dana arrives. (니욘은 니옌을 생각하다 다나를 만난다.)"',
);

// Regression: four source mentions may become two natural Korean mentions.
// The local bilingual formatter must never insert the omitted names back.
const repeated = segmentSource(
    '"If Nyen finds out Nyon slept in Dana\'s room, Nyen will talk. Nyen will complain. Nyen will keep going."',
    [
        { source: 'Nyen', target: '니옌' },
        { source: 'Nyon', target: '니욘' },
        { source: 'Dana', target: '다나' },
    ],
);
const repeatedDialogue = repeated.segments.find(segment => segment.type === 'dialogue_candidate');
const repeatedNyen = repeated.nameTokens.filter(entry => entry.source === 'Nyen');
const repeatedNyon = repeated.nameTokens.find(entry => entry.source === 'Nyon');
const repeatedDana = repeated.nameTokens.find(entry => entry.source === 'Dana');
const repeatedKorean = `"${repeatedNyon.token}이 ${repeatedDana.token} 방에서 잤다는 걸 ${repeatedNyen[0].token}이 알면, ${repeatedNyen[2].token}은 계속 말할 거야."`;
const repeatedFixed = ensureBilingualDialogueFormat(
    repeatedDialogue, repeatedKorean, settings, null, repeated.nameTokens, repeated.tokens,
);
const repeatedTranslations = new Map([[repeatedDialogue.id, repeatedFixed]]);
assert.equal(findProtectedTokenIntegrityProblems(repeated.segments, repeatedTranslations).length, 0);
const repeatedAssembled = assembleTranslation(repeated, repeatedTranslations);
assert.equal((repeatedAssembled.match(/니옌/g) || []).length, 2);
assert.equal((repeatedAssembled.match(/니욘/g) || []).length, 1);
assert.equal((repeatedAssembled.match(/다나/g) || []).length, 1);
assert.doesNotMatch(repeatedAssembled, /니옌니옌/);

const prompt = buildOutputPrompt(segmented, settings, '', {}, null, { [dialogue.id]: 'other_dialogue' });
assert.match(prompt, /BILINGUAL DIALOGUE IS REQUIRED/);
assert.match(prompt, /Korean-only dialogue is invalid/);

console.log('PASS: bilingual dialogue is detected from user prompts and enforced locally.');
