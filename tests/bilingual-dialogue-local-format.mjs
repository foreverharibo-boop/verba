import assert from 'node:assert/strict';
import {
    bilingualDialogueBracketPair,
    bilingualDialogueRequested,
    ensureBilingualDialogueFormat,
} from '../core.js';

const exactPrompt = `[BILINGUAL DIALOGUE FORMAT]
For direct dialogue only, output both the original English dialogue and its Korean translation in this exact format:

"English dialogue. [한국어 번역.]"

Rules:
- Apply this format only to direct dialogue inside quotation marks.
- Keep narration in Korean only.
- Preserve the original English dialogue exactly in the first part.
- Keep both the English and Korean inside the same quotation marks.
- Do not create bilingual narration.`;

const settings = {
    globalPromptEnabled: false,
    allDialoguePromptEnabled: true,
    allDialoguePrompt: exactPrompt,
};

assert.equal(bilingualDialogueRequested(settings), true);
assert.deepEqual(bilingualDialogueBracketPair(settings), ['[', ']']);

const dialogue = text => ({ id: `seg_${text}`, type: 'dialogue_candidate', text });
assert.equal(
    ensureBilingualDialogueFormat(dialogue('"Dana—"'), '"다나—"', settings),
    '"Dana— [다나—]"',
);
assert.equal(
    ensureBilingualDialogueFormat(dialogue('"Nyon."'), '"니욘."', settings),
    '"Nyon. [니욘.]"',
);
assert.equal(
    ensureBilingualDialogueFormat(dialogue('"Yes."'), '"응."', settings),
    '"Yes. [응.]"',
);

const nameToken = '@@VERBA_NAME_0000@@';
const namedDialogue = dialogue(`"${nameToken}."`);
assert.equal(
    ensureBilingualDialogueFormat(
        namedDialogue,
        '"니욘."',
        settings,
        null,
        [{ token: nameToken, source: 'Nyon', value: '니욘' }],
        [],
    ),
    `"Nyon. [${nameToken}.]"`,
);

const narration = { id: 'seg_narration', type: 'narration', text: 'Dana waited.' };
assert.equal(ensureBilingualDialogueFormat(narration, '다나는 기다렸다.', settings), '다나는 기다렸다.');
assert.equal(
    ensureBilingualDialogueFormat(dialogue('"Yes."'), '"응."', {}),
    '"응."',
);

console.log('bilingual-dialogue-local-format tests passed');
