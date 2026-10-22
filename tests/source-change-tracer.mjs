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
console.log('PASS: source change hints, writable-property restoration, no payload leakage');
