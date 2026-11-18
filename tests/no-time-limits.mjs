import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { translateGoogleFreeText } from '../google-free.js';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const requestSource = source.slice(source.indexOf('async function sendProfileRequest('), source.indexOf('function fallbackEligibleError('));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function boundary(transport, enqueue = fn => fn()) {
    const env = {
        settings: { profileId: 'a', timeoutSeconds: 1, debugMode: false },
        profileSlotForId: () => 'A', profileList: () => [{ id: 'a' }],
        createSecondTranslationAttempt: () => null,
        performance, AbortController, Promise,
        outputTiming: { enqueue() {}, sent() {}, received() {}, settled() {} },
        liveContext: () => ({ ConnectionManagerRequestService: { sendRequest: transport } }),
        enqueueRequest: enqueue, enqueueScopedParallelRequest: enqueue,
        enqueueSplitOutputRequest: enqueue, enqueueProfileRaceRequest: enqueue,
        extractResponseText: r => r.content,
        abortError: () => new DOMException('cancelled', 'AbortError'),
        recordProfileAttempt() {}, VERBA_MAX_TOKENS: 15000, VERBA_DEEP_MAX_TOKENS: 15000,
    };
    return Function(...Object.keys(env), requestSource + '\nreturn sendProfileRequest;')(...Object.values(env));
}
for (const stage of ['output-translation', 'second-translation', 'output-post-review', 'final-english-review', 'bilingual-check']) {
    test(`${stage}: elapsed time and legacy overrides never abort a browser request`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        let release, signal;
        const send = boundary((_id, _messages, _tokens, options) => {
            signal = options.signal;
            return new Promise(resolve => { release = resolve; });
        });
        let settled = false;
        const pending = send('fixture', { stage, timeoutSecondsOverride: 1 }).finally(() => { settled = true; });
        await flush();t.mock.timers.tick(3 * 60 * 60 * 1000);await flush();
        assert.equal(settled, false);assert.equal(signal.aborted, false);
        release({ content: '늦게 완료된 번역' });
        assert.equal((await pending).content, '늦게 완료된 번역');
    });
}
for (const queued of [false, true]) test(`manual cancel settles ${queued ? 'queued' : 'provider-ignores-abort'} request`, async () => {
    const controller = new AbortController();let calls = 0;
    const send = boundary(() => { calls++;return new Promise(() => {}); }, queued ? () => new Promise(() => {}) : fn => fn());
    const pending = send('fixture', { signal: controller.signal });
    await flush();controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, queued ? 0 : 1);
});
test('free Google translation waits beyond its old deadline and remains cancellable', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release, signal;
    const fetchImpl = (_url, opts) => { signal = opts.signal; return new Promise(resolve => { release = resolve; }); };
    const pending = translateGoogleFreeText('Hello', { fetchImpl, timeoutMs: 1 });
    t.mock.timers.tick(3600000);await flush();assert.equal(signal.aborted, false);
    release({ ok: true, json: async () => [[['안녕']]] });assert.equal(await pending, '안녕');
    const controller = new AbortController();
    const cancelled = translateGoogleFreeText('Hello', { fetchImpl, signal: controller.signal });
    controller.abort();await assert.rejects(cancelled, { name: 'AbortError' });assert.equal(signal.aborted, true);
});
