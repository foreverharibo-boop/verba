import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestSecondTranslation, firstTranslationDraftSnapshot, readFirstTranslationDraft, firstTranslationDraftText } from '../second-translation.js';

const segmented = { source: 'SOURCE_ONLY', segments: [{ id: 'one', text: 'SOURCE_ONLY' }] };
const longDraft = '초안 🐹 <script>내용</script> @@VERBA_NAME_0000@@\n'.repeat(500);

test('capture is the exact complete second-pass input and survives rewrite failure', async () => {
    const translations = new Map([['one', longDraft]]);
    let record, requests = 0;
    await assert.rejects(requestSecondTranslation({ segmented, translations,
        onDraft(rows) { record = firstTranslationDraftSnapshot(rows); },
        request: async prompt => {
            requests++;
            const actual = JSON.parse(prompt.split('\nSEGMENTS\n')[1]);
            assert.deepEqual(record.segments, actual.map(({ id, first_translation }) => ({ id, first_translation })));
            throw Error('offline');
        },
    }), /초벌 번역은 표시하지 않았습니다/);
    translations.set('one', '나중에 덮어쓴 번역');
    assert.equal(requests, 1);
    assert.equal(record.segments[0].first_translation, longDraft);
    assert.ok(firstTranslationDraftText(record).endsWith(longDraft));
    assert.ok(!JSON.stringify(record).includes('SOURCE_ONLY'));
});

test('diagnostic callback failure never changes the returned translation', async () => {
    const final = new Map([['one', '최종 번역']]);
    assert.deepEqual(await requestSecondTranslation({ segmented, translations: new Map([['one', '초안']]),
        onDraft() { throw Error('render failed'); }, request: async () => final,
    }), final);
});

test('draft reader accepts only draft fields and rejects malformed records', () => {
    const record = firstTranslationDraftSnapshot([{id:'one', first_translation:longDraft, prompt:'SECRET'}], {messageId:4, swipeId:1, sourceHash:'abc', route:'server-engine', apiKey:'SECRET'});
    const safe = readFirstTranslationDraft({...record, credentials:'SECRET'});
    assert.ok(!JSON.stringify(safe).includes('SECRET'));
    assert.equal(safe.binding.route, 'server-engine');
    assert.equal(safe.segments[0].first_translation, longDraft);
    for (const bad of [null, {}, {version:1, segments:[]}, {version:1, segments:[{id:'one'}]}]) assert.equal(readFirstTranslationDraft(bad), null);
});

test('browser UI uses plain text, latest capture, and debug OFF ignores late records', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const section = source.slice(source.indexOf('let lastFirstTranslationDraft = null;'), source.indexOf('let lastPromptConflicts = []'));
    const pre = {}, button = {}, settings = {debugMode:true};
    const ui = Function('settings','document','firstTranslationDraftText','readFirstTranslationDraft', section + '\nreturn {remember:rememberFirstTranslationDraft, clear(){lastFirstTranslationDraft=null;renderFirstTranslationDraft();}};')(
        settings, {querySelector: selector => selector.includes('copy-') ? button : pre}, firstTranslationDraftText, readFirstTranslationDraft);
    const record = firstTranslationDraftSnapshot([{id:'one',first_translation:longDraft}]);
    ui.remember(record);
    assert.ok(pre.textContent.endsWith(longDraft)); assert.equal(button.disabled, false);
    ui.remember({...record,capturedAt:'2000-01-01T00:00:00.000Z',segments:[{id:'one',first_translation:'old'}]});
    assert.ok(pre.textContent.endsWith(longDraft));
    settings.debugMode=false; ui.clear(); ui.remember(record);
    assert.equal(button.disabled,true); assert.match(pre.textContent,/아직 기록된 초안이 없어요/);
});
