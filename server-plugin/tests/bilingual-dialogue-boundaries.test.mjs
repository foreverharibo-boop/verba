import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';

const settings = {
    allDialoguePromptEnabled: true,
    allDialoguePrompt: 'For all spoken dialogue, output original English followed by Korean translation in parentheses. Example: "Hello. (안녕.)"',
};
for (const [name, createEngine] of [['verba', verba], ['deep', deep]]) {
    const engine = createEngine({ settings, profiles: {}, nameLocks: [], character: {}, context: {} }, () => {
        throw Error('Local display normalization must never make a translation request');
    });
    for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’']]) {
        for (const reverse of [false, true]) {
            test(`${name}: preserve overlapping dialogue ${open}${close}, reverse=${reverse}`, () => {
                const pairs = [
                    [open + 'Logan.' + close, open + 'Logan. (로건.)' + close],
                    [open + 'Since when, Logan.' + close, open + 'Since when, Logan. (언제부터냐고, 로건.)' + close],
                ];
                if (reverse) pairs.reverse();
                const source = pairs.map(p => p[0]).join('\n\n');
                const expected = pairs.map(p => p[1]).join('\n\n');
                let result = engine.normalize(expected, [], settings, source);
                assert.equal(result.translation, expected);
                result = engine.normalize(result.translation, result.sourceMap, settings, source);
                assert.equal(result.translation, expected);
                for (const row of result.sourceMap) assert.ok(row.start >= 0 && row.end <= expected.length && row.end > row.start);
            });
        }
    }
    test(`${name}: keep whole-dialogue repair working`, () => {
        const source = '"Oh, baby... Dana," Emris breathed.';
        const malformed = '""Oh, baby... Dana, (아, 자기야... 다나,)",)" 엠리스가 숨을 내쉬었다.';
        assert.equal(engine.normalize(malformed, [], settings, source).translation,
            '"Oh, baby... Dana, (아, 자기야... 다나,)" 엠리스가 숨을 내쉬었다.');
    });
}
