import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '../../server-client.js';
import { createJobs } from '../jobs.cjs';

const fields = ['silly_pop', 'silly_pop_ios', 'silly_pop_and'];
function fixture(t, relay) {
    const storage = new Map(relay ? [['silly-relay-enabled-v1', 'true']] : []);
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    globalThis.location = { origin: 'http://localhost', href: 'http://localhost/' };
    globalThis.window = { addEventListener() {} };
    globalThis.document = { hidden: false, addEventListener() {} };
    const handlers = {};
    const context = { chatId: 'one', getRequestHeaders: () => ({}),
        eventTypes: { GENERATION_STARTED: 'start', GENERATE_AFTER_DATA: 'data', CHAT_COMPLETION_SETTINGS_READY: 'settings' },
        eventSource: { on: (name, fn) => handlers[name] = fn } };
    const body = Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Hello.' } }] }));
    const admitted = [], outgoing = [];
    let translations = 0, nativeCalls = 0;
    const jobs = createJobs({ engines: { verba: { createEngine: () => ({ shouldTranslate: () => true,
        output: async () => { translations++; return { translation: '안녕.', sourceMap: [] }; } }) } },
        request: async (_connection, _path, payload, observer) => {
            outgoing.push(payload); observer.onHeaders(200, 'application/json'); observer.onChunk(body);
            return { status: 200, type: 'application/json', body };
        } });
    if (relay) globalThis.sillyRelayReplies = { apiVersion: 1 };
    const bridge = Symbol.for('silly-pop.ios.notifications.v1');
    globalThis[bridge] = { captureTranslation: () => ({ translationEnabled: true, deviceId: 'ios-device', generationId: 'one' }) };
    t.after(() => { delete globalThis.sillyRelayReplies; delete globalThis[bridge]; jobs.stopAll(); });
    globalThis.fetch = async (url, init = {}) => {
        const path = new URL(url, location.href).pathname;
        if (path.endsWith('/capabilities')) return Response.json({ protocol: 1, notificationRouting: true,
            relayObserver: true, engines: { verba: { version: 'fixture' } } });
        if (path === '/api/plugins/verba-server/jobs') {
            const envelope = JSON.parse(init.body); admitted.push(envelope);
            return Response.json(jobs.status(jobs.start('alice', envelope, {})));
        }
        if (path.startsWith('/api/plugins/verba-server/jobs/'))
            return Response.json(jobs.status(jobs.lookup('alice', path.split('/').at(-1)), new URL(url, location.href).searchParams.get('cursor')));
        nativeCalls++;
        const payload = JSON.parse(init.body); outgoing.push(payload);
        if (payload.__verba_server_ticket) {
            jobs.observed('alice', payload.__verba_server_ticket, { state: 'completed', status: 200, type: 'application/json', body });
            await jobs.lookup('alice', payload.__verba_server_ticket).done;
        }
        return new Response(body, { headers: { 'content-type': 'application/json' } });
    };
    const settings = { serverTranslation: true, autoOutput: true, translationEngine: 'google-free' };
    const client = createServerClient({ variant: 'verba', version: 'fixture', getSettings: () => settings,
        getContext: () => context, isActive: () => true, getSnapshot: () => ({ settings }), getGenerationOptions: () => ({ options: {} }) });
    client.install();
    const messages = [{ role: 'user', content: 'real reply' }];
    handlers.start('normal', {}, false); handlers.data({ prompt: messages });
    const payload = { messages, type: 'normal', stream: false, model: 'saved-model' }; handlers.settings(payload);
    return { client, payload, admitted, outgoing, translations: () => translations, nativeCalls: () => nativeCalls };
}

for (const relay of [false, true]) for (const field of fields) for (const change of ['added', 'removed', 'replaced']) {
    test(`notification metadata ${field} ${change} retains server admission (relay=${relay})`, async t => {
        const f = fixture(t, relay);
        if (change !== 'added') f.payload[field] = { requestId: 'old', characterName: 'old metadata' };
        f.payload.__ttotto_main_request = 'consumed-browser-marker';
        const wire = structuredClone(f.payload); delete wire.__ttotto_main_request;
        if (change === 'removed') delete wire[field];
        else wire[field] = { requestId: 'new', characterName: 'new metadata' };
        // A helper still cannot borrow this binding, even with matching notification metadata.
        await fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify({ ...wire, type: 'quiet' }) });
        assert.equal(f.admitted.length, 0);
        const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(wire) });
        assert.equal((await response.json()).choices[0].message.content, 'Hello.');
        assert.equal(f.admitted.length, 1);
        assert.equal(f.admitted[0].kind, relay ? 'observed-generation' : 'generation');
        assert.equal(f.admitted[0].notification.candidates.ios.deviceId, 'ios-device');
        assert.equal(f.translations(), 1, 'translation finishes before a browser output callback');
        const sent = f.outgoing.at(-1);
        assert.deepEqual(sent[field], wire[field], 'preserve the actual wire notification metadata');
        assert.equal(Object.hasOwn(sent, '__ttotto_main_request'), false);
        assert.equal(sent.model, 'saved-model');
        if (relay) assert.equal(sent.__verba_server_ticket, f.payload.__verba_server_ticket);
        const translated = await f.client.output('Hello.', {}, () => { throw Error('unexpected local request'); });
        assert.equal(translated.translation, '안녕.'); assert.equal(f.translations(), 1);
    });
}

for (const changed of ['messages', 'model', 'temperature', 'unknownField', 'nestedNotificationName']) {
    test(`real request difference remains ineligible: ${changed}`, async t => {
        const f = fixture(t, true), wire = structuredClone(f.payload);
        wire.silly_pop_ios = { requestId: 'new' };
        if (changed === 'messages') wire.messages[0].content = 'helper prompt';
        else if (changed === 'nestedNotificationName') wire.messages[0].silly_pop_ios = 'actual message data';
        else wire[changed] = 'different';
        await fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(wire) });
        assert.equal(f.admitted.length, 0); assert.equal(f.translations(), 0); assert.equal(f.nativeCalls(), 1);
        assert.equal(f.client.diagnostics().events.at(-1).reason, 'wire-body-changed');
    });
}
