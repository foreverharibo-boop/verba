import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as createVerba } from '../engines/verba.mjs';
import { createEngine as createDeep } from '../engines/verba-deep.mjs';

const source = '`Happy`\n\n```text\nStatus: Ready\n```\n\n```html\n<div class="status">Stay here.</div>\n```\n\n```json\n{"message":"Stay here.","id":"KEEP_CODE"}\n```';
const words = { Happy: '행복함', 'Status: Ready': '상태: 준비됨', 'Stay here.': '"여기" 있어.' };
for (const [name, create] of [['verba', createVerba], ['verba-deep', createDeep]]) {
    for (const [mode, extra] of [
        ['normal', {}],
        ['mad', { developerMadKoreanOutputEnabled: true }],
        ['compressed', { developerMode: true, developerCompressedPromptEnabled: true }],
        ['extreme', { developerMode: true, developerExtremeCompressedPromptEnabled: true }],
        ['minimal', { developerMode: true, developerMinimalPromptEnabled: true }],
        ['split', { developerMode: true, developerOutputSplitCount: 2 }],
    ]) test(`${name}/${mode}: code-only text reaches transport and restores syntax/source mapping`, async () => {
        const settings = { profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false, serverRetryLimit: 1, translateTaggedContent: true, ...extra };
        let calls = 0, translatedRows = 0;
        const engine = create({ settings, profiles: { A: {} }, nameLocks: [], character: {}, context: {} }, async (_id, messages) => {
            assert.ok(++calls <= 4, 'unexpected extra API calls');
            const prompt = messages.map(m => m.content).join('\n');
            const marker = ['\nTARGETS\n', '\nSEGMENTS\n', '\nTRANSLATION TARGETS\n'].find(m => prompt.includes(m));
            assert.ok(marker, 'expected translation targets');
            const rows = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
            assert.ok(rows.every(row => ['tagged_content','code_content'].includes(row.type)));
            assert.doesNotMatch(JSON.stringify(rows), /KEEP_CODE|class=|```/);
            translatedRows += rows.length;
            return { content: JSON.stringify({ segments: rows.map(row => ({
                id: row.id,
                translation: Object.entries(words).reduce((text, [a, b]) => text.split(a).join(b), row.text ?? row.source),
            })) }) };
        });
        assert.equal(engine.shouldTranslate(source), true);
        const result = await engine.output(source, {});
        assert.match(result.translation, /`행복함`/);
        assert.match(result.translation, /```text\n상태: 준비됨\n```/);
        assert.match(result.translation, /<div class="status">"여기" 있어\.<\/div>/);
        const json = result.translation.match(/```json\n([^]*?)\n```/)[1];
        assert.deepEqual(JSON.parse(json), { message: '"여기" 있어.', id: 'KEEP_CODE' });
        assert.equal(translatedRows, 4);
        assert.equal(result.sourceMap.length, 4);
        for (const row of result.sourceMap) assert.ok(result.translation.slice(row.start, row.end).trim());
        assert.doesNotMatch(result.translation, /@@VERBA/);
    });
}
