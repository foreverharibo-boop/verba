import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { INPUT_ORIGINAL_KEY, createPendingInputOriginal, saveInputOriginal, syncInputOriginalDisplay } from '../input-original.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const source = '  나는 집에 가고 싶어.\n<img src=x onerror=alert(1)> {{user}}  ';
const translation = 'I want to go home.';
function fixture(enabled = true) {
    let context = { chat: [] };
    const textarea = { value: source, dataset: {}, dispatchEvent() {} };
    const env = {
        settings: { autoInput: true, showInputOriginal: enabled },
        EXTENSION_KEY: 'verba', inputBusy: false, bypassSendClick: false,
        pendingInputOriginal: createPendingInputOriginal(), pendingSentInputs: new Map(),
        saveInputOriginal, AbortController, Event, console,
        isTranslationExtensionActive: () => true,
        liveContext: () => context,
        translateInputText: async () => translation,
        document: { querySelector: () => textarea },
        trackInputTranslation() {}, untrackInputTranslation() {}, showInputProgress() {},
        clearProgress() {}, notify() {}, reportError() {}, updateMessageBlock() {},
        isAbort: error => error.name === 'AbortError', errorText: error => error.message,
        normalizedMessageId: Number, hasKorean: text => /[가-힣]/u.test(text),
        setTimeout() {}, scheduleChatSave() {},
    };
    vm.createContext(env);
    const start = index.indexOf('function setTextareaValue(');
    const end = index.indexOf('function setupAutoInput()', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(index.slice(start, end), env);
    return { env, textarea, get context() { return context; }, switchChat() { context = { chat: [] }; } };
}

for (const enabled of [false, true]) {
    for (const route of ['button', 'generation', 'sent']) {
        test(`${route}: English-only message, original capture ${enabled ? 'on' : 'off'}`, async () => {
            const f = fixture(enabled);
            const { env, textarea } = f;
            const push = () => f.context.chat.push({ is_user: true, mes: textarea.value, extra: { unrelated: 1 } });
            if (route === 'button') await env.translateInputAndSend(textarea, { click: push }, source);
            if (route === 'generation') {
                await env.translateInputBeforeGeneration('normal', {}, false);
                push();
            }
            if (route === 'sent') push();
            await env.translateSentInputMessage(0);
            const message = f.context.chat[0];
            assert.equal(message.mes, translation);
            assert.equal(message.extra.display_text, enabled ? `${translation}\n\n---\n\n${source}` : undefined);
            assert.equal(message.extra.unrelated, 1);
            assert.equal(message.extra[INPUT_ORIGINAL_KEY]?.source, enabled ? source : undefined);
            // A serialized chat reload retains exactly the source typed, while
            // building a model history from mes still produces English only.
            const loaded = JSON.parse(JSON.stringify(f.context.chat));
            assert.deepEqual(loaded.map(m => ({ role: 'user', content: m.mes })), [{ role: 'user', content: translation }]);
            assert.equal(loaded[0].extra[INPUT_ORIGINAL_KEY]?.source, enabled ? source : undefined);
        });
    }
}

test('a pending source cannot attach to a different chat, message, or later identical send', () => {
    const pending = createPendingInputOriginal();
    const chat = [];
    pending.stage(chat, source, translation);
    const other = [{ is_user: true, mes: translation }];
    assert.equal(pending.attach(other, 0), false);
    chat.push({ is_user: true, mes: translation });
    assert.equal(pending.attach(chat, 0), false);
    pending.stage(chat, source, translation);
    chat.push({ is_user: true, mes: 'Different input' });
    assert.equal(pending.attach(chat, 1), false);
    chat[1].mes = translation;
    assert.equal(pending.attach(chat, 1), false);
    pending.stage(chat, source, translation);
    pending.reset();
    chat.push({ is_user: true, mes: translation });
    assert.equal(pending.attach(chat, 2), false);
});

for (const route of ['button', 'generation']) {
    for (const change of ['edit', 'chat', 'failure']) {
        test(`${route}: ${change} during translation does not capture or send a stale source`, async () => {
            const f = fixture();
            let resolve, reject, sends = 0;
            f.env.translateInputText = () => new Promise((yes, no) => { resolve = yes; reject = no; });
            f.env.console = { error() {} };
            const work = route === 'button'
                ? f.env.translateInputAndSend(f.textarea, { click: () => sends++ }, source)
                : f.env.translateInputBeforeGeneration('normal', {}, false);
            if (change === 'edit') f.textarea.value = '수정한 인풋';
            if (change === 'chat') f.switchChat();
            if (change === 'failure') reject(new Error('translation failed'));
            else resolve(translation);
            await work;
            assert.equal(sends, 0);
            f.context.chat.push({ is_user: true, mes: translation });
            assert.equal(f.env.pendingInputOriginal.attach(f.context.chat, 0), false);
        });
    }
}

test('checkbox persists display preference and refreshes existing messages', () => {
    const start = index.indexOf('    const showInputOriginal = panel.querySelector(');
    const end = index.indexOf('    characterTranslationReference.bind(panel);', start);
    assert.ok(start >= 0 && end > start);
    let handler, saves = 0, renders = 0;
    const input = { checked: false, addEventListener: (_, fn) => { handler = fn; } };
    const settings = { showInputOriginal: true };
    Function('panel', 'settings', 'pendingInputOriginal', 'saveSettings', 'refreshTranslationClasses', 'syncInputOriginalChat', index.slice(start, end))(
        { querySelector: () => input }, settings, createPendingInputOriginal(), () => saves++, () => renders++, () => {},
    );
    handler();
    assert.equal(settings.showInputOriginal, false);
    input.checked = true;
    handler();
    assert.equal(settings.showInputOriginal, true);
    assert.equal(saves, 2);
    assert.equal(renders, 2);
});

test('a translated message with a Korean proper name retains the first source', async () => {
    const f = fixture();
    let requests = 0;
    f.env.translateInputText = async () => { requests++; return 'Hello, 담은.'; };
    await f.env.translateInputAndSend(f.textarea, { click: () => {
        f.context.chat.push({ is_user: true, mes: f.textarea.value });
    } }, source);
    await f.env.translateSentInputMessage(0);
    assert.equal(requests, 1);
    assert.equal(f.context.chat[0].extra[INPUT_ORIGINAL_KEY].source, source);
});

test('native display survives serialization, toggles idempotently, and never changes prompt text', () => {
    const message = { is_user: true, name: 'Vivi', mes: translation };
    assert.equal(saveInputOriginal(message, source, translation), true);
    const expected = `${translation}\n\n---\n\n${source}`;
    assert.equal(message.extra.display_text, expected);
    const loaded = JSON.parse(JSON.stringify(message));
    assert.equal(loaded.mes, translation);
    assert.equal(loaded.extra.display_text, expected);
    for (let i = 0; i < 10; i++) assert.equal(syncInputOriginalDisplay(loaded, true), false);
    assert.equal(syncInputOriginalDisplay(loaded, false), true);
    assert.equal(loaded.extra.display_text, undefined);
    assert.equal(loaded.extra[INPUT_ORIGINAL_KEY].source, source);
    assert.equal(syncInputOriginalDisplay(loaded, false), false);
    assert.equal(syncInputOriginalDisplay(loaded, true), true);
    assert.equal(loaded.extra.display_text, expected);
    assert.equal(loaded.mes, translation);
});

test('old original metadata migrates; edited English hides stale original; new translation replaces owned display', () => {
    const message = { is_user: true, mes: translation, extra: { [INPUT_ORIGINAL_KEY]: {source, translation} } };
    assert.equal(syncInputOriginalDisplay(message, true), true);
    message.mes = 'Edited English.';
    assert.equal(syncInputOriginalDisplay(message, true), true);
    assert.equal(message.extra.display_text, undefined);
    assert.equal(message.mes, 'Edited English.');
    message.mes = translation;
    syncInputOriginalDisplay(message, true);
    message.mes = 'New English.';
    saveInputOriginal(message, '새 인풋', 'New English.');
    assert.equal(message.extra.display_text, 'New English.\n\n---\n\n새 인풋');
    assert.equal(message.mes, 'New English.');
});

test('unrelated display fields and assistant messages are never overwritten', () => {
    const message = {is_user:true,mes:translation,extra:{display_text:'Other extension view'}};
    saveInputOriginal(message,source,translation);
    assert.equal(message.extra.display_text,'Other extension view');
    assert.equal(syncInputOriginalDisplay(message,false),false);
    delete message.extra.display_text;
    assert.equal(syncInputOriginalDisplay(message,true),true);
    message.extra.display_text='Replacement from another extension';
    syncInputOriginalDisplay(message,false);
    assert.equal(message.extra.display_text,'Replacement from another extension');
    const assistant={is_user:false,mes:translation,extra:{display_text:'AI 번역', [INPUT_ORIGINAL_KEY]:{source,translation}}};
    assert.equal(syncInputOriginalDisplay(assistant,true),false);
    assert.equal(assistant.extra.display_text,'AI 번역');
});

test('opening or toggling a chat migrates offscreen originals, redraws mounted messages, saves once', () => {
    const chat=Array.from({length:3},()=>({is_user:true,mes:translation,extra:{[INPUT_ORIGINAL_KEY]:{source,translation}}}));
    let saves=0, active=true;
    const redraw=[];
    const context={chat};
    const env={settings:{showInputOriginal:true},EXTENSION_KEY:'verba',syncInputOriginalDisplay,
        isTranslationExtensionActive:()=>active,liveContext:()=>context,
        document:{querySelector:selector=>selector.includes('"0"')?{querySelector:()=>null}:null},
        updateMessageBlock:id=>redraw.push(id),scheduleChatSave:reference=>{assert.equal(reference,chat);saves++;}};
    vm.createContext(env);
    const start=index.indexOf('function syncInputOriginalChat() {');
    const end=index.indexOf('function refreshTranslationClasses()',start);
    vm.runInContext(index.slice(start,end),env);
    env.syncInputOriginalChat();
    assert.equal(saves,1);assert.deepEqual(redraw,[0]);
    assert.ok(chat.every(m=>m.extra.display_text.includes(source)));
    env.syncInputOriginalChat();assert.equal(saves,1);
    env.settings.showInputOriginal=false;env.syncInputOriginalChat();
    assert.equal(saves,2);assert.ok(chat.every(m=>m.extra.display_text===undefined));
    assert.ok(chat.every(m=>m.extra[INPUT_ORIGINAL_KEY].source===source));
    active=false;env.settings.showInputOriginal=true;env.syncInputOriginalChat();assert.equal(saves,2);
    assert.ok(index.includes('function restoreSavedTranslationsAfterChatOpen() {\n    if (!isTranslationExtensionActive(EXTENSION_KEY)) return;\n    syncInputOriginalChat();'));
    assert.ok(!index.includes('renderInputOriginal('),'no duplicate DOM-only original renderer');
});
