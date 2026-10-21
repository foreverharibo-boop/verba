import test from 'node:test';
import assert from 'node:assert/strict';
import { captureConnectionProfiles } from '../../server-client.js';
// Separate module instance simulates the other translator sharing ST services.
import { captureConnectionProfiles as captureOther } from '../../server-client.js?other-extension';

const tick = () => new Promise(resolve => setImmediate(resolve));
for (const failFirst of [false, true]) test(`overlapping profile snapshots restore native services (first fails=${failFirst})`, async () => {
    const gates = new Map();
    let paid = 0;
    const original = async () => { paid++; return { content: 'ordinary request' }; };
    const service = { sendRequest: original };
    const context = { ChatCompletionService: service, ConnectionManagerRequestService: {
        async sendRequest(id, messages, maxTokens, custom) {
            assert.notEqual(custom.includePreset, false);
            await new Promise(resolve => gates.set(id, resolve));
            if (id === 'A' && failFirst) throw Error('preset construction failed');
            return service.sendRequest({ model: 'gemini-4-argon', messages, max_tokens: maxTokens });
        },
    } };
    const first = captureConnectionProfiles(context, ['A']);
    const second = captureOther(context, ['B']);
    const settled = Promise.allSettled([first, second]);
    await tick();
    gates.get('A')();
    await first.catch(() => {});
    await tick();
    gates.get('B')();
    const results = await settled;
    assert.equal(results[0].status, failFirst ? 'rejected' : 'fulfilled');
    assert.equal(results[1].value.B.payload.model, 'gemini-4-argon');
    assert.equal(paid, 0);
    assert.equal(service.sendRequest, original, 'temporary capture wrapper must not remain installed');
    await service.sendRequest({ messages: [] });
    assert.equal(paid, 1);
});
