import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual index handlers without loading SillyTavern or making API calls.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => {
    const begin = index.indexOf(start);
    const finish = index.indexOf(end, begin + start.length);
    assert.ok(begin >= 0 && finish > begin, `missing source boundary: ${start}`);
    return index.slice(begin, finish);
};
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const message = { mes: 'source', extra: {} };
    const state = { chat: [message], calls: [], menuResolve: null };
    const env = {
        console: { ...console, error: (...args) => state.calls.push(['console-error', ...args]) },
        pendingOutputs: new Map(), pendingSelectionTranslations: new Set(), pendingInputControllers: new Set(),
        liveContext: () => state,
        latestAssistantMessage: () => state.chat.length ? { id: 0, message: state.chat[0] } : null,
        currentRecord: m => m.record,
        messageVersionSignature: m => m.mes,
        currentSwipeExtra: () => null,
        sourceViewRequested: m => m.original === true,
        outputAbortReason: code => code,
        refreshRetranslateButton: () => {},
        notify: (...args) => state.calls.push(['notify', ...args]),
        errorText: e => e.message,
        reportError: (...args) => state.calls.push(['error', ...args]),
        translateUntranslatedOutput: async target => {
            state.calls.push(['translate', target.id]);
            if (state.fail) throw new Error('test failure');
            if (state.deferTranslation) {
                const controller = new AbortController();
                env.pendingOutputs.set(target.id, { controller });
                await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
                env.pendingOutputs.delete(target.id);
            }
            return true;
        },
        requestRetranslateTargetChoice: () => {
            state.calls.push(['menu']);
            return new Promise(resolve => { state.menuResolve = resolve; });
        },
        showOriginalDisplay: () => state.calls.push(['original']),
        showTranslationDisplay: () => state.calls.push(['translation']),
        retranslateOutputTarget: async t => { state.calls.push(['retranslate', t.id]); return true; },
        requestPreviousOutputTarget: async () => state.previous,
        captureChatViewportPosition: () => ({}),
        jumpToOutputMessage: async id => { state.calls.push(['jump', id]); return true; },
        showPreviousOutputReturnButton: () => state.calls.push(['return-button']),
    };
    state.SlashCommand = { fromProps: props => props };
    state.SlashCommandParser = { addCommandObject: cmd => {
        state.calls.push(['register']); state.command = cmd;
    } };
    vm.runInNewContext([
        slice('function activeTranslationControllers()', 'function trackSelectionTranslation('),
        slice('function abortActiveTranslations(', 'function wait('),
        slice('async function retranslateLatestOutput()', 'function setTextareaValue('),
        slice('let outputActionPending =', 'function createRetranslateButton()'),
        'globalThis.register = registerVerbaSlashCommand; globalThis.icon = runOutputAction;',
    ].join('\n'), env);
    env.register(); env.register();
    assert.equal(state.calls.filter(c => c[0] === 'register').length, 1);
    assert.equal(state.command.name, 'verba');
    const invoke = () => { assert.equal(state.command.callback(), ''); };
    return { state, env, message, invoke };
}

// No output: feedback, no translation. All active job types cancel even without a chat.
{
    const f = fixture(); f.state.chat = []; f.invoke(); await flush();
    assert.equal(f.state.calls.at(-1)[0], 'notify');
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    f.env.pendingOutputs.set(0, { controller: controllers[0] });
    f.env.pendingSelectionTranslations.add(controllers[1]); f.env.pendingInputControllers.add(controllers[2]);
    f.invoke(); assert.ok(controllers.every(c => c.signal.aborted));
    f.state.chat = [f.message]; f.invoke(); await flush();
    assert.equal(f.state.calls.filter(c => c[0] === 'translate').length, 0, 'no retry during abort cleanup');
}
// Untranslated/failed latest output starts immediately; same QR can cancel before completion.
{
    const f = fixture(); f.state.deferTranslation = true;
    f.invoke(); assert.equal(f.env.pendingOutputs.size, 1);
    const controller = f.env.pendingOutputs.get(0).controller;
    f.invoke(); assert.equal(controller.signal.aborted, true); await flush();
    assert.equal(f.env.pendingOutputs.size, 0);
    assert.equal(f.state.calls.filter(c => c[0] === 'menu').length, 0);
    f.state.deferTranslation = false; f.invoke(); await flush();
    assert.equal(f.state.calls.filter(c => c[0] === 'translate').length, 2);
}
// Completed output opens exactly one chooser shared by icon and command.
for (const choice of ['recent', 'previous', 'toggle-view', null]) {
    const f = fixture(); f.message.record = { translation: '번역' }; f.message.extra.display_text = '번역';
    f.state.previous = { target: { id: 9, message: { record: {} } }, completionAction: 'stay' };
    f.invoke(); void f.env.icon();
    assert.equal(f.state.calls.filter(c => c[0] === 'menu').length, 1);
    f.state.menuResolve(choice); await flush();
    if (choice === 'recent') assert.ok(f.state.calls.some(c => c[0] === 'retranslate' && c[1] === 0));
    if (choice === 'previous') assert.ok(f.state.calls.some(c => c[0] === 'retranslate' && c[1] === 9));
    if (choice === 'toggle-view') assert.ok(f.state.calls.some(c => c[0] === 'original'));
    f.message.original = true; f.invoke(); f.state.menuResolve('toggle-view'); await flush();
    assert.ok(f.state.calls.some(c => c[0] === 'translation'));
}
// A menu for a replaced/swiped source must not act on stale content.
{
    const f = fixture(); f.message.record = {}; f.invoke();
    f.message.mes = 'new swipe'; f.state.menuResolve('recent'); await flush();
    assert.equal(f.state.calls.filter(c => c[0] === 'retranslate').length, 0);
}
// Errors are handled; the action lock is released and retry remains available.
{
    const f = fixture(); f.state.fail = true; f.invoke(); await flush();
    assert.equal(f.state.calls.filter(c => c[0] === 'error').length, 1);
    f.state.fail = false; f.invoke(); await flush();
    assert.equal(f.state.calls.filter(c => c[0] === 'translate').length, 2);
}
assert.ok(index.includes("button.addEventListener('click', runOutputAction)"));
assert.ok(slice('function initialize()', "if (document.readyState === 'loading')").includes('registerVerbaSlashCommand();'));

// Run the actual popup builder against a small DOM adapter: all options,
// absent/hidden anchors, placement, dismissal and listener cleanup.
for (const anchorMode of ['visible', 'hidden', 'absent']) {
    for (const choice of ['recent', 'previous', 'toggle-view', 'escape', 'outside']) {
        const listeners = new Map(); const frames = [];
        let menu;
        const anchor = anchorMode === 'absent' ? null : { getBoundingClientRect: () => anchorMode === 'hidden'
            ? { left: 0, top: 0, width: 0, height: 0, bottom: 0 }
            : { left: 320, top: 650, width: 30, height: 30, bottom: 680 } };
        const doc = {
            querySelector: selector => selector === '#verba-retranslate-latest' ? anchor : null,
            body: { append: el => { menu = el; el.connected = true; } },
            addEventListener: (name, handler) => listeners.set(name, handler),
            removeEventListener: name => listeners.delete(name),
            createElement: () => {
                const options = ['recent', 'previous', 'toggle-view'].map(target => ({
                    dataset: { target }, addEventListener: (_, fn) => { options.find(o => o.dataset.target === target).click = fn; }, focus() {},
                }));
                return {
                    options, style: { setProperty(name, value) { this[name] = value; } },
                    setAttribute() {}, getBoundingClientRect: () => ({ width: 156, height: 38 }),
                    querySelectorAll: () => options, querySelector: () => options[0],
                    contains: t => options.includes(t), remove() { this.connected = false; },
                };
            },
        };
        const env = { document: doc, innerWidth: 360, innerHeight: 720,
            currentRecord: () => ({ translation: '번역' }), currentSwipeExtra: () => null, sourceViewRequested: () => false,
            requestAnimationFrame: fn => frames.push(fn),
        };
        vm.runInNewContext(slice('function positionVerbaChoiceMenu(', 'const PREVIOUS_OUTPUT_PAGE_SIZE')
            + '\nglobalThis.open = requestRetranslateTargetChoice;', env);
        const result = env.open({ message: { extra: { display_text: '번역' } } });
        assert.equal(menu.connected, true); assert.ok(menu.innerHTML.includes('>원문</button>'));
        assert.equal(menu.options.length, 3);
        assert.ok(parseFloat(menu.style.left) >= 0 && parseFloat(menu.style.left) + 156 <= 360);
        assert.ok(parseFloat(menu.style.top) >= 0 && parseFloat(menu.style.top) + 38 <= 720);
        if (anchorMode !== 'visible') assert.equal(parseFloat(menu.style.top), 574, 'hidden translation menu uses the same +70px baseline as profiles');
        frames.forEach(fn => fn());
        if (choice === 'escape') listeners.get('keydown')({ key: 'Escape' });
        else if (choice === 'outside') listeners.get('pointerdown')({ target: {} });
        else menu.options.find(o => o.dataset.target === choice).click({ preventDefault() {}, stopPropagation() {} });
        assert.equal(await result, ['escape', 'outside'].includes(choice) ? null : choice);
        assert.equal(menu.connected, false); assert.equal(listeners.size, 0);
    }
}
console.log('PASS: /verba routing/cancellation/retry, duplicate guards, errors, popup creation/options/dismissal/placement (DOM adapter). API calls: 0; live SillyTavern browser: not tested.');
