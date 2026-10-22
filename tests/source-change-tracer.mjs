import assert from 'node:assert/strict';
import { createSourceChangeTracer } from '../source-change-tracer.js';

const readSource = message => {
    const index = Number(message?.swipe_id);
    const raw = Array.isArray(message?.swipes) && Number.isInteger(index)
        && index >= 0 && Object.hasOwn(message.swipes, index)
        ? message.swipes[index] : message.mes;
    return typeof raw === 'string' ? raw : String(raw?.mes ?? raw?.text ?? '');
};

{
    const secret = 'SECRET CHAT BODY THAT MUST NEVER APPEAR IN A LOG';
    const message = { mes: secret };
    const tracer = createSourceChangeTracer({ enabled: () => true, readSource });
    tracer.observe(10, message, 'message-received');
    assert.equal(typeof Object.getOwnPropertyDescriptor(message, 'mes').set, 'function');
    message.mes = 'SECRET CHAT BODY';
    tracer.observe(10, message, 'before-apply');
    const changes = tracer.diagnostics().events;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].method, 'property-write');
    assert.equal(changes[0].relation, 'tail-removed');
    assert.ok(!JSON.stringify(changes).includes(secret));
    tracer.reset();
    assert.equal(message.mes, 'SECRET CHAT BODY');
    assert.ok('value' in Object.getOwnPropertyDescriptor(message, 'mes'));
}
{
    const message = { mes: 'old text', swipe_id: 0, swipes: ['old text'] };
    const tracer = createSourceChangeTracer({ enabled: () => true, readSource });
    tracer.observe(5, message, 'received');
    message.swipes[0] = 'old';
    assert.equal(tracer.diagnostics().events.at(-1).field, 'swipes[0]');
    message.swipes = ['new full answer'];
    assert.equal(tracer.diagnostics().events.at(-1).field, 'message.swipes');
    message.swipes[0] = 'new';
    assert.equal(tracer.diagnostics().events.at(-1).field, 'swipes[0]');
    tracer.observe(5, { mes: 'replaced', swipes: ['different'], swipe_id: 0 }, 'before-apply');
    assert.equal(tracer.diagnostics().events.at(-1).method, 'message-object-replaced');
    tracer.reset();
    assert.ok('value' in Object.getOwnPropertyDescriptor(message, 'swipes'));
}
{
    let enabled = false;
    const message = { mes: 'private source text' };
    const tracer = createSourceChangeTracer({ enabled: () => enabled, readSource });
    tracer.observe(1, message);
    assert.ok('value' in Object.getOwnPropertyDescriptor(message, 'mes'));
    enabled = true;
    tracer.observe(1, message);
    tracer.compare(1, '0123456789abcdef', '0123456789', 'before-result-apply');
    assert.equal(tracer.diagnostics().events.at(-1).event, 'server-versus-live');
    assert.equal(tracer.diagnostics().events.at(-1).relation, 'tail-removed');
    assert.ok(!JSON.stringify(tracer.diagnostics()).includes('0123456789'));
    tracer.reset();
}

{
    const before = 'A' + 'old dialogue.'.repeat(1000) + 'THE SECRET END';
    const after = 'A' + 'new scene'.repeat(1100) + 'NEW END';
    let detailed = false;
    const message = { mes: before };
    const tracer = createSourceChangeTracer({
        enabled: () => true,
        fullTextEnabled: () => detailed,
        readSource,
    });
    tracer.observe(2, message, 'message-received');
    message.mes = after;
    let event = tracer.diagnostics().events.at(-1);
    assert.equal(event.beforeText, undefined, 'full text must default off');
    assert.equal(event.removedText, undefined);

    detailed = true;
    tracer.reset();
    tracer.observe(2, message, 'full-text-enabled');
    message.mes = before;
    event = tracer.diagnostics().events.at(-1);
    assert.equal(event.beforeText, after);
    assert.equal(event.afterText, before);
    assert.equal(event.removedText, after.slice(event.commonPrefixLength, after.length - event.commonSuffixLength));
    assert.equal(event.insertedText, before.slice(event.commonPrefixLength, before.length - event.commonSuffixLength));
    assert.equal(event.beforeText.length, after.length, 'full source must not be truncated');

    tracer.compare(2, before, after, 'before-result-apply');
    event = tracer.diagnostics().events.at(-1);
    assert.equal(event.event, 'server-versus-live');
    assert.equal(event.beforeText, before);
    assert.equal(event.afterText, after);
    assert.equal(event.removedText.length > 1000, true);

    for (let i = 0; i < 12; i += 1) message.mes = 'EDIT-' + String(i).repeat(1000);
    assert.equal(tracer.diagnostics().events.filter(item => typeof item.beforeText === 'string').length, 8);
    assert.ok(tracer.diagnostics().events.some(item => item.fullTextExpired === true));

    detailed = false;
    tracer.reset();
    assert.equal(tracer.diagnostics().events.length, 0);
    assert.ok(!JSON.stringify(tracer.diagnostics()).includes('THE SECRET END'));
    message.mes = 'another private edit';
    assert.equal(tracer.diagnostics().events.length, 0, 'reset unhooks source');
}
{
    const message = { mes: 'initial', swipe_id: 0, swipes: [{ mes: 'PERSONAL START', note: 'unmodified' }] };
    const tracer = createSourceChangeTracer({ enabled: () => true, fullTextEnabled: () => true, readSource });
    tracer.observe(3, message, 'message-received');
    message.swipes[0].mes = 'PERSONAL END';
    const event = tracer.diagnostics().events.at(-1);
    assert.equal(event.field, 'swipes[0].mes');
    assert.equal(event.beforeText, 'PERSONAL START');
    assert.equal(event.afterText, 'PERSONAL END');
    tracer.reset();
    assert.ok('value' in Object.getOwnPropertyDescriptor(message.swipes[0], 'mes'));
}
{
    let enabled = true;
    const message = { mes: 'PRIVATE' };
    const tracer = createSourceChangeTracer({ enabled: () => enabled, fullTextEnabled: () => true, readSource });
    tracer.observe(9, message);
    enabled = false;
    message.mes = 'PRIVATE NEW';
    assert.equal(tracer.diagnostics().events.length, 0, 'server/debug disabled must not log property writes');
    tracer.reset();
}

console.log('PASS: source change hints, writable-property restoration, opt-in full-text snapshots and default privacy');
