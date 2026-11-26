import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBilingualMappedTranslation } from '../core.js';

const settings = {
    allDialoguePromptEnabled: true,
    allDialoguePrompt: 'For all spoken dialogue, output original English followed by Korean translation in parentheses. Example: "Hello. (안녕.)"',
};

for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’']]) {
    for (const reverse of [false, true]) {
        test(`short dialogue must not match a longer dialogue suffix: ${open}${close}, reverse=${reverse}`, () => {
            const pairs = [
                [open + 'Logan.' + close, open + 'Logan. (로건.)' + close],
                [open + 'Since when, Logan.' + close, open + 'Since when, Logan. (언제부터냐고, 로건.)' + close],
            ];
            if (reverse) pairs.reverse();
            const source = pairs.map(p => p[0]).join('\n\n');
            const expected = pairs.map(p => p[1]).join('\n\n');
            let result = normalizeBilingualMappedTranslation(expected, [], settings, source);
            assert.equal(result.translation, expected);
            for (let i = 0; i < 3; i++) {
                result = normalizeBilingualMappedTranslation(result.translation, result.sourceMap, settings, source);
                assert.equal(result.translation, expected);
                for (const row of result.sourceMap) {
                    assert.ok(row.start >= 0 && row.end <= expected.length && row.end > row.start);
                }
            }
        });
    }
}

test('fallback still repairs a complete malformed dialogue next to narration', () => {
    const source = '"Oh, baby... Dana," Emris breathed.';
    const malformed = '""Oh, baby... Dana, (아, 자기야... 다나,)",)" 엠리스가 숨을 내쉬었다.';
    assert.equal(normalizeBilingualMappedTranslation(malformed, [], settings, source).translation,
        '"Oh, baby... Dana, (아, 자기야... 다나,)" 엠리스가 숨을 내쉬었다.');
});

test('unquoted prose suffix is not treated as a standalone spoken line', () => {
    const source = '"Logan."';
    const translation = '메모에는 Since when, Logan. (언제부터냐고, 로건.)이라고 쓰여 있었다.';
    assert.equal(normalizeBilingualMappedTranslation(translation, [], settings, source).translation, translation);
});

