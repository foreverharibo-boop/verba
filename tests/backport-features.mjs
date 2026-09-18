import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { bindPromptExpandEditors } from '../prompt-editor.js';
import { repairUnexpectedProseBreaks } from '../response-parser.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert.ok(index.includes("import { bindPromptExpandEditors } from './prompt-editor.js';"));
assert.ok(index.includes('bindPromptExpandEditors(panel);'));
assert.ok(index.includes('value="selection"> 선택 범위만'));
assert.ok(!index.includes('> 선택 주변</label>'));
assert.equal(typeof bindPromptExpandEditors, 'function');
assert.match(style, /\.verba-deep-prompt-expand[\s\S]*?width:\s*20px\s*!important/);
assert.match(style, /#verba-deep-prompt-editor\s*\{/);

const translation = 'LEFT_KOREAN_SENTINEL선택문RIGHT_KOREAN_SENTINEL';
const start = 'LEFT_KOREAN_SENTINEL'.length;
const end = 'LEFT_KOREAN_SENTINEL선택문'.length;
const settings = {};
const single = core.buildSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    sourceContext: 'MATCHED_SOURCE_ONLY',
    translation,
    selected: '선택문',
    start,
    end,
    settings,
    contextMode: 'selection',
});
assert.ok(single.includes('MATCHED_SOURCE_ONLY'));
assert.ok(single.includes('선택문'));
assert.ok(!single.includes('FULL_SOURCE_SENTINEL'));
assert.ok(!single.includes('LEFT_KOREAN_SENTINEL'));
assert.ok(!single.includes('RIGHT_KOREAN_SENTINEL'));

const noMap = core.buildSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    sourceContext: '',
    translation,
    selected: '선택문',
    start,
    end,
    settings,
    contextMode: 'selection',
});
assert.ok(!noMap.includes('FULL_SOURCE_SENTINEL'));

const multi = core.buildMultiSelectionPrompt({
    source: 'FULL_SOURCE_SENTINEL',
    translation,
    selections: [{
        id: 'multi_0000',
        selected: '선택문',
        sourceContext: 'MATCHED_SOURCE_ONLY',
        start,
        end,
    }],
    settings,
    contextMode: 'selection',
});
assert.ok(multi.includes('MATCHED_SOURCE_ONLY'));
assert.ok(!multi.includes('FULL_SOURCE_SENTINEL'));
assert.ok(!multi.includes('LEFT_KOREAN_SENTINEL'));
assert.ok(!multi.includes('RIGHT_KOREAN_SENTINEL'));

const oneLine = { id: 'seg_0000', type: 'narration', text: 'Source stays on one line.' };
assert.equal(
    repairUnexpectedProseBreaks('첫 문장.\n\n둘째 문장.', oneLine),
    '첫 문장. 둘째 문장.',
);
assert.equal(
    repairUnexpectedProseBreaks('“대사.”<br>다음 문장.', { ...oneLine, type: 'dialogue_candidate' }),
    '“대사.” 다음 문장.',
);
assert.equal(
    repairUnexpectedProseBreaks('첫 문장.\n\n둘째 문장.', { ...oneLine, text: 'Line one.\n\nLine two.' }),
    '첫 문장.\n\n둘째 문장.',
);
assert.equal(
    repairUnexpectedProseBreaks('`code`\nnext', oneLine),
    '`code`\nnext',
);

console.log('PASS: v0.5.53 long prompts with local line-break recovery, prompt editor integration, and selection-only request isolation.');
