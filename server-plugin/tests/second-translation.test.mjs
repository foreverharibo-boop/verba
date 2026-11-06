import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
import { reportedPrompt } from '../../tests/fixtures/bilingual-inline-rules.js';

const snapshot = extra => ({ settings: {
    developerDeepseekKoreanEnabled: true, developerSecondTranslationEnabled: true,
    developerMode: true, profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false,
    serverRetryLimit: 1, debugMode: true, globalPromptEnabled: true, globalPrompt: 'STYLE_SENTINEL',
    allDialoguePromptEnabled: true, allDialoguePrompt: reportedPrompt,
    translateTaggedContent: true, aiPostReview: { deepseekTranslationese: true }, ...extra,
}, profiles: { A: {} }, nameLocks: [{ source: 'Dana', target: '다나' }], character: {}, context: {} });
const source = 'Dana waited.\n\n"Stay."\n\n`KEEP_CODE`\n\n<Info_panel>Sunny</Info_panel>';
const rows = p => JSON.parse(p.split('\nSEGMENTS\n').at(-1).split('\n')[0]);
const reply = segments => ({ content: JSON.stringify({ segments }) });
function answer(p, final) {
    return reply(rows(p).map(row => ({ id: row.id, translation:
        row.type === 'dialogue_candidate' ? `"Stay. (${final ? '여기 있어.' : '있어.'})"`
        : row.type === 'tagged_content' ? '맑음'
        : `${(row.text.match(/@@VERBA[^@]+@@/g) || []).join(' ')} ${final ? '기다렸다.' : '기다리는 것을 했다.'}`.trim(),
    })));
}
for (const [name, create] of [['verba', verba], ['deep', deep]]) {
    for (const split of [1, 2, 3]) test(`${name}: one rewrite after ${split} batches, only final returned with protected format`, async () => {
        const config = snapshot({ developerOutputSplitCount: split });
        const before = structuredClone(config); let initial = 0, rewrites = 0;
        const engine = create(config, async (_id, messages) => {
            const p = messages[0].content;
            assert.doesNotMatch(p, /^UNIFIED OUTPUT POST REVIEW/);
            if (p.startsWith('SECOND TRANSLATION')) {
                rewrites++; assert.equal(initial, split);
                assert.doesNotMatch(p, /HIGHEST-PRIORITY TRANSLATION PRINCIPLE|TRANSLATION SUCCESS CRITERION|ACTIVE SETTINGS PRECEDENCE/);
                assert.match(p, /초안은.*참고 자료/);
                if (name === 'deep') assert.match(p, /His voice carried a hint of irritation/);
                else assert.doesNotMatch(p, /His voice carried a hint of irritation/);
                for (const marker of ['STYLE_SENTINEL', 'ONETIME_SENTINEL', 'PREVIOUS_CONTEXT_SENTINEL']) assert.ok(!p.includes(marker), marker);
                for (const marker of ['first_translation', '기다리는 것을 했다.']) assert.ok(p.includes(marker), marker);
                assert.equal(JSON.parse(p.split('\nSOURCE_CONTEXT\n')[1].split('\n')[0]), source);
                assert.ok(rows(p).some(row => row.first_translation.includes('Stay. (있어.)')));
                assert.equal(rows(p).length, 3);
                return answer(p, true);
            }
            initial++; assert.match(p, /HIGHEST-PRIORITY TRANSLATION PRINCIPLE/); return answer(p, false);
        });
        const out = await engine.output(source, { oneTimeInstruction: 'ONETIME_SENTINEL', previousUserSource: 'PREVIOUS_CONTEXT_SENTINEL' });
        assert.equal(rewrites, 1); assert.equal(initial, split);
        assert.match(out.translation, /다나.*기다렸다/);
        assert.match(out.translation, /"Stay\. \(여기 있어\.\)"/);
        assert.match(out.translation, /`KEEP_CODE`/);
        assert.match(out.translation, /<Info_panel>맑음<\/Info_panel>/);
        assert.doesNotMatch(out.translation, /기다리는 것을 했다/);
        assert.ok(out.sourceMap.length > 0);
        assert.ok(out.sourceMap.some(row => out.translation.slice(row.start, row.end).includes('기다렸다')));
        assert.ok(out.sourceMap.every(row => !out.translation.slice(row.start, row.end).includes('기다리는 것을 했다')));
        assert.deepEqual(config, before);
    });
    for (const mad of [false, true]) test(`${name}: first pass keeps custom rules; second pass omits every first-pass instruction (${mad})`, async () => {
        let calls = 0;
        const config = snapshot({
            developerMadKoreanOutputEnabled: mad,
            customTranslatorEnabled: true,
            customTranslatorTemplates: { deepseek: 'CUSTOM_DEEPSEEK_SENTINEL', output: 'CUSTOM_OUTPUT_SENTINEL', mad: 'CUSTOM_MAD_SENTINEL' },
            customTranslatorModified: { deepseek: true, output: true, mad: true },
            aiPostReview: {},
        });
        const before = structuredClone(config);
        const engine = create(config, async (_id, messages) => {
            const p = messages[0].content;
            const second = p.startsWith('SECOND TRANSLATION');
            calls++;
            assert.equal(p.includes('CUSTOM_DEEPSEEK_SENTINEL'), !second);
            assert.equal(p.includes('CUSTOM_OUTPUT_SENTINEL'), !second);
            assert.equal(p.includes('CUSTOM_MAD_SENTINEL'), mad && !second);
            assert.equal(p.includes('PREVIOUS_CONTEXT_SENTINEL'), !second);
            for (const marker of ['STYLE_SENTINEL', 'ONETIME_SENTINEL']) assert.equal(p.includes(marker), !second);
            return answer(p, second);
        });
        const out = await engine.output('Dana waited.', { oneTimeInstruction: 'ONETIME_SENTINEL', previousUserSource: 'PREVIOUS_CONTEXT_SENTINEL' });
        assert.equal(calls, 2);
        assert.match(out.translation, /다나.*기다렸다/);
        assert.deepEqual(config, before);
    });
    test(`${name}: disabling either checkbox preserves single-pass behavior`, async () => {
        for (const extra of [{ developerSecondTranslationEnabled: false }, { developerDeepseekKoreanEnabled: false }]) {
            let calls = 0;
            const engine = create(snapshot({ ...extra, aiPostReview: {} }), async (_id, messages) => {
                calls++; assert.doesNotMatch(messages[0].content, /^SECOND TRANSLATION/); return answer(messages[0].content, false);
            });
            await engine.output('He waited.'); assert.equal(calls, 1);
        }
    });
    test(`${name}: general fluency and other selected checks review the rewritten result`, async () => {
        let reviews = 0;
        const engine = create(snapshot({ aiPostReview: { meaning: true, translationese: true, deepseekTranslationese: true } }), async (_id, messages) => {
            const p = messages[0].content;
            if (p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
                reviews++;
                const targets = JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
                assert.ok(targets.every(row => row.checks.includes('meaning') && row.checks.includes('translationese') && !row.checks.includes('deepseekTranslationese')));
                assert.ok(targets.some(row => row.CURRENT.includes('기다렸다')));
                return reply(targets.map(row => ({ id: row.id, translation: row.CURRENT })));
            }
            return answer(p, p.startsWith('SECOND TRANSLATION'));
        });
        await engine.output(source); assert.equal(reviews, 1);
    });
    test(`${name}: cancellation during second request rejects instead of returning draft`, async () => {
        const controller = new AbortController(); let calls = 0;
        const engine = create(snapshot(), async (_id, messages) => {
            calls++;
            const p = messages[0].content;
            if (p.startsWith('SECOND TRANSLATION')) controller.abort();
            return answer(p, p.startsWith('SECOND TRANSLATION'));
        });
        await assert.rejects(engine.output(source, { signal: controller.signal }), { name: 'AbortError' });
        assert.equal(calls, 2);
    });
    test(`${name}: empty rewrite fails without publishing partial result`, async () => {
        const engine = create(snapshot(), async (_id, messages) => {
            const p = messages[0].content;
            return p.startsWith('SECOND TRANSLATION') ? reply([]) : answer(p, false);
        });
        await assert.rejects(engine.output(source), /초벌 번역은 표시하지 않았습니다/);
    });
}
