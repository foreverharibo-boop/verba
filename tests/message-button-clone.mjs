import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isPredominantlyKorean } from '../core.js';

// Native EventTarget dispatch, with a minimal DOM adapter for the ST template
// and clone lifecycle. No browser layout, device session, or AI requests.
const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
};
class Button extends EventTarget {
    constructor() { super(); this.classList = { toggle() {} }; this.listenerCount = 0; }
    addEventListener(...args) { this.listenerCount++; super.addEventListener(...args); }
    setAttribute(name, value) { this[name] = value; }
    closest() { return this.owner; }
    remove() { this.owner.button = null; }
    cloneNode() {
        const copy = new Button();
        for (const key of ['className', 'innerHTML', 'title', 'type']) copy[key] = this[key];
        return copy;
    }
    click() { this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })); }
}
function messageNode(id) {
    const node = { button: null, classList: { toggle() {} }, getAttribute: () => id,
        querySelectorAll: () => [], querySelector: selector => selector === '.mes_buttons' ? actions : node.button };
    const hint = {};
    const actions = { firstChild: hint, querySelector: () => hint,
        insertBefore(button) { node.button = button; button.owner = node; button.parentElement = actions; button.nextElementSibling = hint; } };
    node.actions = actions;
    return node;
}
const hiddenTemplate = messageNode(''); // ST #message_template has mesid="".
const live = messageNode('1');
const notices = [], requests = [];
const chat = [
    { mes: '이것은 한국어 그리팅입니다.', extra: {} },
    { mes: '신의 턱에 괴고 있던 담은이 검지로 배달 앱 화면을 짚었다.', extra: {} },
];
const env = {
    settings: { autoOutput: false }, pendingOutputs: new Map(), swipeTranslationJobs: new Map(), failedOutputSignatures: new Map(),
    liveContext: () => ({ chat }), messageSource: m => m.mes, currentRecord: m => m?.record,
    isNameReplacementMessage: m => Boolean(m && !m.is_user), messageVersionSignature: m => m.mes,
    isPredominantlyKorean, scheduleSelectionHighlights() {},
    noticeUI: { show: (text, options) => notices.push({ text, type: options.type }) },
    translateMessage: async (id, options) => requests.push({ id, automatic: options.automatic }),
    latestAssistantMessage: () => ({ id: 1, message: chat[1] }), activeTranslationControllers: () => [],
    refreshRetranslateButton: () => env.refreshMessageTranslationButtons(),
    reportError: (_, error) => { throw error; }, errorText: e => e.message,
    document: {
        createElement: () => new Button(),
        querySelectorAll: selector => selector === '#chat .mes[mesid]' ? [live] : [hiddenTemplate, live],
    },
};
vm.createContext(env);
vm.runInContext([
    slice('function notify(', 'function renderOutputTiming('),
    slice('function refreshTranslationClasses()', 'function selectTranslationProfile('),
    slice('async function translateUntranslatedOutput(', 'async function retranslateOutputTarget('),
    slice('async function retranslateLatestOutput()', 'function setTextareaValue('),
    slice('const pendingMessageActions =', 'function injectInputAction('),
].join('\n'), env);
const settle = () => new Promise(resolve => setImmediate(resolve));
env.refreshTranslationClasses();
assert.equal(hiddenTemplate.button, null, 'hidden template must not acquire message 0 button');
// Defensive check even if another caller accidentally passes the blank template ID.
env.syncMessageTranslationButton(hiddenTemplate, 0, chat[0]);
assert.equal(hiddenTemplate.button, null);

const cloned = live.button.cloneNode(true);
live.actions.insertBefore(cloned);
assert.equal(cloned.listenerCount, 0, 'clone copies icon markup without native handlers');
env.refreshMessageTranslationButtons();
env.refreshMessageTranslationButtons();
assert.equal(cloned.listenerCount, 1, 'existing clone is bound exactly once');
cloned.click(); await settle();
assert.deepEqual(notices, [{ text: '선택한 아웃풋이 이미 한국어라 번역할 필요가 없어요.', type: 'info' }]);
assert.equal(requests.length, 0);
await env.retranslateLatestOutput();
assert.deepEqual(notices[1], notices[0], 'cloned message button reaches the same notice as the lower action');

chat[1].mes = 'She pointed at the delivery app on the screen.';
cloned.click(); await settle();
assert.deepEqual(requests, [{ id: 1, automatic: undefined }]);
assert.equal(cloned.disabled, false);
env.settings.autoOutput = true; env.refreshMessageTranslationButtons();
assert.equal(live.button, null);
cloned.click(); await settle();
assert.equal(requests.length, 1, 'detached manual button stays inactive in automatic mode');
console.log('PASS: blank hidden template excluded; native click on a cloned/rebound message button produces the Korean notice or requests the correct English message, once per click. DOM adapter; not a device/browser render test.');
