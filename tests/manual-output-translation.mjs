import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
};
const flush = () => new Promise(resolve => setImmediate(resolve));
assert.match(source, /autoOutput: true/);
assert.match(source, /settings.autoOutput = settings.autoOutput !== false/);
assert.match(source, /bindAutoOutputSetting\(panel\);/);

// Real setting handler: persist OFF/ON, clear queued work, leave running work alone.
{
    let change, saves = 0;
    const cleared = [];
    const input = { checked: false, addEventListener: (_, fn) => { change = fn; } };
    const status = {};
    const env = { settings: { autoOutput: true, autoInput: true },
        automaticTranslationTimers: new Map([[2, 42]]), clearTimeout: id => cleared.push(id),
        saveSettings: () => saves++ };
    vm.createContext(env);
    vm.runInContext(slice('function bindAutoOutputSetting(', 'function bindAutoInputSetting('), env);
    const panel = { querySelector: selector => selector.endsWith('-status') ? status : input };
    env.bindAutoOutputSetting(panel);
    assert.equal(input.checked, true); assert.equal(status.textContent, 'ON');
    input.checked = false; change();
    assert.equal(env.settings.autoOutput, false); assert.equal(env.settings.autoInput, true);
    assert.deepEqual(cleared, [42]); assert.equal(env.automaticTranslationTimers.size, 0);
    // Reopening the UI uses the saved OFF state without resetting it.
    env.bindAutoOutputSetting(panel);
    assert.equal(input.checked, false); assert.equal(status.textContent, 'OFF');
    input.checked = true; change();
    assert.equal(env.settings.autoOutput, true); assert.equal(saves, 2);
    assert.equal(env.automaticTranslationTimers.size, 0, 'turning ON does not bulk-translate history');
}

function schedulerFixture() {
    const calls = [], timers = new Map(); let nextTimer = 0;
    const message = { mes: 'Hello', extra: {} };
    const env = { settings: { autoOutput: true }, EXTENSION_KEY: 'verba',
        isTranslationExtensionActive: () => true,
        automaticTranslationTimers: new Map(), swipeTranslationJobs: new Map(),
        setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        liveContext: () => ({ chat: [message] }),
        repairSwipeTranslationIndexes: () => false, scheduleChatSave() {},
        clearStaleCurrentTranslation: id => calls.push(['clear', id]),
        translateMessage: (id, options) => calls.push(['translate', id, options.automatic]),
        refreshRetranslateButton() {}, renderSwipeHold() {}, releaseSwipeHold() {},
        currentSwipeSlot: () => ({ exists: true, hasIndexedSwipe: true }),
        messageVersionSignature: () => 'new-source',
        currentRecord: m => m.record,
        restoreCurrentDisplay: (id, m, record) => calls.push(['restore', id, record.translation]),
    };
    vm.createContext(env);
    vm.runInContext(slice('function cancelScheduledAutomaticTranslation(', 'function handleSwipe(')
        + slice('function finishSwipeTranslationJob(', 'function clearOwnedDisplay('), env);
    const tick = () => { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); };
    return { env, calls, message, timers, tick };
}
// Queued auto work rechecks the setting, including swipe/revision deferrals.
{
    const f = schedulerFixture();
    f.env.settings.autoOutput = false; f.env.scheduleAutomaticTranslation(0);
    assert.equal(f.timers.size, 0); assert.ok(!f.calls.some(c => c[0] === 'translate'));
    f.env.settings.autoOutput = true; f.env.scheduleAutomaticTranslation(0);
    f.env.settings.autoOutput = false; f.tick();
    assert.ok(!f.calls.some(c => c[0] === 'translate'));
    f.env.settings.autoOutput = true;
    f.env.swipeTranslationJobs.set(0, {}); f.env.scheduleAutomaticTranslation(0); f.tick();
    assert.equal(f.timers.size, 1);
    f.env.settings.autoOutput = false; f.env.swipeTranslationJobs.clear(); f.tick();
    assert.ok(!f.calls.some(c => c[0] === 'translate'));
    f.env.settings.autoOutput = true; f.env.scheduleAutomaticTranslation(0); f.tick();
    assert.deepEqual(f.calls.filter(c => c[0] === 'translate'), [['translate', 0, true]]);
}
for (const saved of [false, true]) {
    const f = schedulerFixture();
    f.env.settings.autoOutput = false;
    if (saved) f.message.record = { translation: '안녕' };
    f.env.scheduleSwipeTranslation(0, 'old-source'); f.tick(); f.tick();
    assert.ok(!f.calls.some(c => c[0] === 'translate'), 'OFF applies to swipe path');
    assert.equal(f.env.swipeTranslationJobs.size, 0);
    assert.equal(f.calls.some(c => c[0] === 'restore'), saved, 'stored swipe translations stay available');
}
// Full real translateMessage entry: automatic is blocked before touching source;
// explicit manual calls still reach the normal translation pipeline.
{
    const reached = new Error('manual reached source');
    const env = { settings: { autoOutput: false }, EXTENSION_KEY: 'verba',
        isTranslationExtensionActive: () => true, activateTranslationExtension() {},
        liveContext: () => ({ chat: [{}] }), isNameReplacementMessage: () => true,
        messageSource: () => { throw reached; } };
    vm.createContext(env);
    vm.runInContext(slice('async function translateMessage(', 'function latestAssistantMessage('), env);
    await env.translateMessage(0, { automatic: true });
    await assert.rejects(env.translateMessage(0), error => error === reached);
}

// Actual per-message button and routing, with a small message-menu DOM adapter.
{
    const calls = [], nodes = [], chat = [{ mes: 'First' }, { mes: 'Second' }, { mes: 'User', is_user: true }];
    let release;
    const env = { settings: { autoOutput: false }, pendingOutputs: new Map(), swipeTranslationJobs: new Map(),
        liveContext: () => ({ chat }), messageSource: m => m.mes,
        isNameReplacementMessage: m => Boolean(m && !m.is_user), currentRecord: m => m.record,
        notify: (...args) => calls.push(['notice', ...args]),
        refreshRetranslateButton: () => env.refreshMessageTranslationButtons(),
        retranslateOutputTarget: async t => { calls.push(['translate', t.id]); await new Promise(resolve => { release = resolve; }); },
        abortPendingOutput: (id, reason) => { calls.push(['cancel', id]); env.pendingOutputs.get(id).controller.abort(reason); },
        outputAbortReason: code => code, errorText: e => e.message, reportError: (...args) => calls.push(['error', ...args]),
        document: {
            querySelectorAll: () => nodes,
            createElement: () => ({ classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; },
                addEventListener(_, fn) { this.click = () => fn({ currentTarget: this, preventDefault() {}, stopPropagation() {} }); },
                closest() { return this.owner; }, remove() { this.owner.button = null; } }),
        } };
    for (let id = 0; id < chat.length; id++) {
        const node = { button: null, getAttribute: () => String(id),
            querySelector(selector) { return selector === '.extraMesButtons' ? { append: b => { this.button = b; b.owner = this; } } : this.button; } };
        nodes.push(node);
    }
    vm.createContext(env);
    vm.runInContext(slice('const pendingMessageActions =', 'function injectInputAction('), env);
    env.refreshMessageTranslationButtons();
    const button = nodes[0].button;
    assert.ok(button); assert.ok(nodes[1].button); assert.equal(nodes[2].button, null);
    env.refreshMessageTranslationButtons(); assert.equal(nodes[0].button, button, 'no duplicate icons');
    assert.match(button.title, /이 메시지 번역$/);
    const running = button.click();
    assert.deepEqual(calls, [['translate', 0]], 'old message button must not target the latest message');
    assert.equal(button.disabled, true);
    await button.click(); assert.equal(calls.length, 1, 'duplicate launch suppressed');
    release(); await running;
    assert.equal(button.disabled, false);
    chat[0].record = { translation: '첫째' }; env.refreshMessageTranslationButtons();
    assert.match(button.title, /재번역$/);
    const first = new AbortController(), second = new AbortController();
    env.pendingOutputs.set(0, { controller: first }); env.pendingOutputs.set(1, { controller: second });
    await button.click();
    assert.equal(first.signal.aborted, true); assert.equal(second.signal.aborted, false);
    assert.equal(first.signal.reason, 'VERBA_OUTPUT_USER_CANCELLED');
    env.pendingOutputs.clear();
    env.retranslateOutputTarget = async () => { throw new Error('failure'); };
    await button.click(); assert.equal(calls.at(-1)[0], 'error'); assert.equal(button.disabled, false);
    env.retranslateOutputTarget = async t => { calls.push(['retry', t.id]); };
    await button.click(); assert.deepEqual(calls.at(-1), ['retry', 0]);
    chat[0] = { mes: 'Became user', is_user: true }; env.refreshMessageTranslationButtons();
    assert.equal(nodes[0].button, null);
}
// Existing untranslated/retranslate routing keeps manual semantics while OFF.
{
    const calls = [];
    const env = { settings: { autoOutput: false }, pendingOutputs: new Map(), failedOutputSignatures: new Map(),
        messageSource: m => m.mes, messageVersionSignature: m => m.mes,
        isPredominantlyKorean: () => false, currentRecord: m => m.record,
        translateMessage: async (id, options) => calls.push([id, options]), notify() {} };
    vm.createContext(env);
    vm.runInContext(slice('async function translateUntranslatedOutput(', 'function captureChatViewportPosition('), env);
    await env.retranslateOutputTarget({ id: 4, message: { mes: 'Older message' } });
    assert.equal(calls[0][0], 4); assert.equal(calls[0][1].automatic, undefined);
}
await flush();
console.log('PASS: automatic ON/OFF persistence, queue and swipe gates, saved translation restore, manual routing, message menu insertion, duplicate/error recovery and per-message cancellation. No live API/browser calls.');
