import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { INPUT_ORIGINAL_KEY, createPendingInputOriginal, saveInputOriginal, renderInputOriginal } from '../input-original.js';

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
            assert.equal(message.extra.display_text, undefined);
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
    Function('panel', 'settings', 'pendingInputOriginal', 'saveSettings', 'refreshTranslationClasses', index.slice(start, end))(
        { querySelector: () => input }, settings, createPendingInputOriginal(), () => saves++, () => renders++,
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

// Minimal DOM adapter; validates renderer behavior without a browser dependency.
class Element {
    constructor() { this.children = []; this.parent = null; this.className = ''; this.content = ''; this.writes = 0; }
    get ownerDocument() { return { createElement: () => new Element() }; }
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this.content; }
    set textContent(value) { this.writes++; this.content = value; this.children = []; }
    get lastElementChild() { return this.children.at(-1); }
    get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1]; }
    append(...children) { children.forEach(c => { c.remove(); c.parent = this; this.children.push(c); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
    after(child) { child.remove(); child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.className === selector.slice(1)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
}

test('rendering is literal, display-only, idempotent, and restored after toggle/remount', () => {
    const element = new Element();
    const text = new Element(); text.className = 'mes_text'; text.textContent = translation; element.append(text);
    const message = { is_user: true, mes: translation };
    saveInputOriginal(message, source, translation);
    const before = JSON.stringify(message);
    const options = { prefix: 'test', enabled: true };
    const draw = () => renderInputOriginal(element, message, options);
    draw();
    const block = text.nextElementSibling;
    assert.equal(block.lastElementChild.textContent, source, 'HTML and macros are literal text');
    assert.equal(element.querySelector('.mes_text').textContent, translation);
    const writes = block.lastElementChild.writes;
    for (let i = 0; i < 10; i++) draw();
    assert.equal(block.lastElementChild.writes, writes, 'no observer feedback loop');
    assert.equal(element.children.length, 2, 'one original block');
    assert.equal(JSON.stringify(message), before, 'rendering cannot mutate API text or metadata');
    options.enabled = false; draw(); assert.equal(element.children.length, 1);
    options.enabled = true; draw(); assert.equal(element.children.length, 2);
    const editor = new Element(); editor.className = 'edit_textarea'; element.append(editor);
    draw(); assert.equal(element.querySelector('.test-input-original'), null); editor.remove();
    message.mes = 'Edited English'; draw(); assert.equal(element.querySelector('.test-input-original'), null);
    message.mes = translation;
    renderInputOriginal(element, JSON.parse(before), options);
    assert.equal(text.nextElementSibling.lastElementChild.textContent, source);
    text.nextElementSibling.remove(); draw(); assert.equal(element.children.length, 2);
});
