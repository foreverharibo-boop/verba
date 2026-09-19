import assert from 'node:assert/strict';
import {
    assembleTranslation,
    bilingualDialogueBracketPair,
    bilingualDialogueRequested,
    buildOutputPrompt,
    ensureBilingualDialogueFormat,
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
assert.equal(
    ensureBilingualDialogueFormat(namedDialogue, already, settings, null, named.nameTokens, named.tokens),
    `"Dana... (${token}…)"`,
);
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

const speakerOnly = {
    ...settings,
    allDialoguePromptEnabled: false,
    dialoguePromptEnabled: true,
    dialoguePrompt: instruction,
};
assert.equal(bilingualDialogueRequested(speakerOnly), false);
assert.equal(ensureBilingualDialogueFormat(dialogue, '"난 그런 말 안 했어."', speakerOnly), '"난 그런 말 안 했어."');

const prompt = buildOutputPrompt(segmented, settings, '', {}, null, { [dialogue.id]: 'other_dialogue' });
assert.match(prompt, /BILINGUAL DIALOGUE IS REQUIRED/);
assert.match(prompt, /Korean-only dialogue is invalid/);

console.log('PASS: bilingual dialogue is detected from user prompts and enforced locally.');
