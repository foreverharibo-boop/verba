import assert from 'node:assert/strict';
import {
    createSourceChangeTracer,
    readPersistentFullTextPreference,
    writePersistentFullTextPreference,
} from '../source-change-tracer.js';

const values = new Map();
const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
};

assert.equal(readPersistentFullTextPreference(storage, 'test'), false);
assert.equal(writePersistentFullTextPreference(true, storage, 'test'), true);
assert.equal(readPersistentFullTextPreference(storage, 'test'), true);
assert.equal(writePersistentFullTextPreference(false, storage, 'test'), false);
assert.equal(readPersistentFullTextPreference(storage, 'test'), false);

const message = { mes: 'one' };
const tracer = createSourceChangeTracer({
    enabled: () => true,
    fullTextEnabled: () => false,
    persistentFullTextEnabled: () => true,
    readSource: row => row.mes,
});
tracer.observe(1, message, 'received');
message.mes = 'two';
const event = tracer.diagnostics().events.at(-1);
assert.equal(event.beforeText, 'one');
assert.equal(event.afterText, 'two');
assert.equal(tracer.diagnostics().fullTextEnabled, true);
tracer.reset();

const privateMessage = { mes: 'secret' };
const privateTracer = createSourceChangeTracer({
    enabled: () => true,
    fullTextEnabled: () => false,
    persistentFullTextEnabled: () => false,
    readSource: row => row.mes,
});
privateTracer.observe(2, privateMessage, 'received');
privateMessage.mes = 'changed';
assert.equal(privateTracer.diagnostics().events.at(-1).beforeText, undefined);
privateTracer.reset();

console.log('PASS: persistent full-source preference and privacy gate');
