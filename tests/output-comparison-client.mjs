import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '../server-client.js';

test('server result comparison reaches caller; diagnostic copy is sanitized and compact', async t => {
    const globals = ['fetch', 'localStorage', 'location', 'window', 'document'];
    const saved = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => { for (const key of globals) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
    } });
    const data = new Map();
    globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    globalThis.location = { origin: 'http://localhost', href: 'http://localhost/' };
    globalThis.window = { addEventListener() {} };
    globalThis.document = { hidden: false, addEventListener() {} };
    const comparison = { version: 1, segmentCount: 1, stages: [{ stage: 'initial-parsed', totals: { duplicateKoreanPairs: 1 }, rows: [{ index: 0, type: 'narration', text: 'SECRET' }] }], source: 'SECRET' };
    let envelope;
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).endsWith('/capabilities')) return Response.json({ protocol: 1, version: '0.1.19', engines: { verba: { version: '0.6.81' } } });
        if (init.method === 'POST') { envelope = JSON.parse(init.body); return Response.json({ id: envelope.id, state: 'queued' }); }
        return Response.json({ id: envelope.id, kind: 'output', state: 'completed', source: 'Quiet', events: [], result: { translation: '조용히 [조용히]', sourceMap: [], outputComparison: comparison } });
    };
    const settings = { serverTranslation: true, debugMode: true, translationEngine: 'google-free' };
    const client = createServerClient({ variant: 'verba', version: '0.6.81', getSettings: () => settings,
        getContext: () => ({ chatId: 'one', getRequestHeaders: () => ({}) }), isActive: () => true,
        getSnapshot: () => ({ settings: { ...settings }, nameLocks: [], context: {}, character: {} }), getGenerationOptions: () => ({ options: {} }) });
    const result = await client.output('Quiet', {}, () => { throw Error('unexpected local fallback'); });
    assert.equal(result.outputComparison.version, 1);
    assert.equal(envelope.snapshot.settings.debugMode, true);
    const diagnostic = client.diagnostics();
    assert.equal(diagnostic.jobs[0].outputComparison.firstDuplicateHintStage, 'initial-parsed');
    assert.equal(diagnostic.jobs[0].outputComparison.stages[0].rows.length, 0);
    assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|Quiet|조용히/);
});
