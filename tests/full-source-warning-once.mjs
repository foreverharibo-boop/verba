import assert from 'node:assert/strict';

const values = new Map([['verba.debugFullSource.v1', 'true']]);
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
};

let dispatched = 0;
const input = {
    id: 'verba-debug-full-source',
    checked: false,
    disabled: false,
    dataset: {},
    closest: () => null,
    dispatchEvent: () => { dispatched += 1; return true; },
};
const listeners = new Map();
globalThis.document = {
    readyState: 'complete',
    documentElement: null,
    getElementById: id => id === input.id ? input : null,
    addEventListener(name, handler) { listeners.set(name, handler); },
};

await import('../source-change-tracer.js?warning-once-test');
await new Promise(resolve => setTimeout(resolve, 20));

assert.equal(input.checked, true, 'saved preference restores the visible checkbox');
assert.equal(dispatched, 0, 'saved preference restore must not replay the opt-in change warning');

console.log('PASS: saved full-source preference restores silently');
