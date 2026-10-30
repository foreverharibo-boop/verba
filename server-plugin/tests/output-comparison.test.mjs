import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as createVerba } from '../engines/verba.mjs';
import { createEngine as createDeep } from '../engines/verba-deep.mjs';

for (const [name, create] of [['verba', createVerba], ['deep', createDeep]]) {
    test(`${name}: input translation remains a plain string with identical request`, async () => {
        const sent = [];
        for (const debugMode of [false, true]) {
            const engine = create({ settings: { profileId: 'A', debugMode, autoProfileFallback: false }, profiles: { A: {} }, nameLocks: [], character: {}, context: {} }, async (_id, messages) => {
                sent.push(messages);
                return { content: JSON.stringify({ segments: [{ id: 'seg_0000', translation: 'Stay quiet.' }] }) };
            });
            assert.equal(await engine.input('조용히 있어.', {}), 'Stay quiet.');
        }
        assert.deepEqual(sent[0], sent[1]);
    });
    test(`${name}: real English-review mutations are attributed to that stage`, async () => {
        let calls = 0;
        const engine = create({ settings: { profileId: 'A', debugMode: true, autoProfileFallback: false, serverRetryLimit: 1 }, profiles: { A: {} }, nameLocks: [], character: {}, context: {} }, async (_id, messages) => {
            calls++;
            const prompt = messages.map(m => m.content).join('\n');
            const marker = ['\nTARGETS\n', '\nSEGMENTS\n', '\nTRANSLATION TARGETS\n', '\nTARGETS '].find(m => prompt.includes(m));
            assert.ok(marker);
            const rows = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
            return { content: JSON.stringify({ segments: rows.map(row => ({ id: row.id,
                translation: calls === 1 ? 'Quiet [조용히]' : '조용히',
            })) }) };
        });
        const result = await engine.output('`Quiet`', {});
        assert.equal(calls, 2);
        const report = result.outputComparison;
        assert.equal(report.stages[0].totals.duplicateKoreanPairs, 0);
        assert.equal(report.firstLatinLossStage, 'english-review');
        assert.equal(report.firstDuplicateHintStage, 'english-review');
        assert.match(result.translation, /조용히 \[조용히\]/);
    });
    for (const [mode, extra] of [['normal', {}], ['minimal', { developerMode: true, developerMinimalPromptEnabled: true }], ['split', { developerMode: true, developerOutputSplitCount: 2 }]]) {
        for (const malformed of [false, true]) test(`${name}/${mode}: comparison follows ${malformed ? 'Korean duplicate' : 'bilingual'} output without changing it`, async () => {
            const run = async debugMode => {
                let calls = 0;
                const engine = create({ settings: { profileId: 'A', autoProfileFallback: false, serverRetryLimit: 1, debugMode,
                    globalPrompt: 'For all source text, preserve the original English and add Korean in brackets. Bilingual output.', ...extra }, profiles: { A: {} }, nameLocks: [], character: {}, context: {} }, async (_id, messages) => {
                    calls++;
                    const prompt = messages.map(m => m.content).join('\n');
                    const marker = ['\nTARGETS\n', '\nSEGMENTS\n', '\nTRANSLATION TARGETS\n'].find(m => prompt.includes(m));
                    assert.ok(marker, 'unexpected extra provider request');
                    const rows = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
                    return { content: JSON.stringify({ segments: rows.map(row => ({ id: row.id,
                        translation: malformed ? '조용히 있어. [조용히 있어.]' : `${row.text ?? row.source} [조용히 있어.]`,
                    })) }) };
                });
                return { result: await engine.output('`Stay quiet.`\n\n```text\nWait here.\n```', {}), calls };
            };
            const on = await run(true), off = await run(false);
            assert.equal(on.result.translation, off.result.translation);
            assert.deepEqual(on.result.sourceMap, off.result.sourceMap);
            assert.equal(on.calls, off.calls);
            assert.equal(off.result.outputComparison, undefined);
            const report = on.result.outputComparison;
            assert.equal(report.segmentCount, 2);
            assert.equal(report.stages[0].stage, 'initial-parsed');
            assert.equal(report.stages[0].totals.duplicateKoreanPairs, malformed ? 2 : 0);
            assert.ok(report.initialResponseBatches >= 1);
            assert.equal(report.stages.at(-1).stage, 'assembled');
            assert.doesNotMatch(JSON.stringify(report), /Stay quiet|Wait here|조용히/);
        });
    }
}
