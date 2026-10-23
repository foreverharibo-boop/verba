import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAutomaticOutputLifecycle } from '../automatic-output.js';
const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const extract = name => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\nfunction ', start + 1);
    assert(start >= 0 && end > start, name);
    return source.slice(start, end);
};
const signature = message => message ? `${message.swipe_id ?? 0}:${message.mes}` : '';
function fixture() {
    const state = { chat: [{ mes: 'An old English reply.', is_user: false }], mounted: false, owner: true, clock: 1000 };
    const lifecycle = createAutomaticOutputLifecycle({ getChat: () => state.chat, signature, now: () => state.clock, visibility: () => 'hidden' });
    lifecycle.reset();
    const microtasks = [], timers = new Map(), calls = [], docEvents = {}, windowEvents = {};
    let next = 0;
    const env = {
        settings: { autoOutput: true }, EXTENSION_KEY: 'test', automaticOutputLifecycle: lifecycle,
        executionTrace: { trace() {}, heartbeat() {}, page() {}, clear() {} },
        traceSourceForMessage() {}, traceLatestAssistantSource() {},
        isTranslationExtensionActive: () => state.owner, liveContext: () => ({ chat: state.chat }),
        automaticTranslationTimers: new Map(), swipeTranslationJobs: new Map(), pendingOutputs: new Map(), failedOutputSignatures: new Map(),
        pendingFallbackAssistantIds: new Set(), assistantSourceObservation: new Map(), assistantObservedChatLength: 1, assistantObservationReady: true,
        document: { hidden: true, visibilityState: 'hidden', querySelector: () => state.mounted ? {} : null, addEventListener: (name, fn) => docEvents[name] = fn },
        window: { addEventListener: (name, fn) => windowEvents[name] = fn },
        queueMicrotask: fn => microtasks.push(fn), setTimeout: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, clearTimeout: id => timers.delete(id),
        normalizedMessageId: id => Number.isInteger(id) ? id : -1,
        latestAssistantMessage: () => ({ id: state.chat.length - 1 }), currentRecord: message => message?.record,
        messageVersionSignature: signature, messageSource: message => message?.mes || '', isPredominantlyKorean: () => false, hasForeignText: () => true,
        repairSwipeTranslationIndexes: () => false, scheduleChatSave() {}, clearStaleCurrentTranslation() {}, refreshRetranslateButton() {},
        schedulePotentialAssistantRevision() {}, scheduleRecentInsteadRevisionTranslations() {}, restoreCurrentDisplay() {},
        renderSwipeHold() {}, releaseSwipeHold() {},
        currentSwipeSlot: message => ({ hasIndexedSwipe: true, exists: Boolean(message.mes) }),
        finishSwipeTranslationJob: id => env.swipeTranslationJobs.delete(id),
        translateMessage: (id, options) => { calls.push({ id, source: state.chat[id].mes, options }); lifecycle.started(id); env.pendingOutputs.set(id, {}); return Promise.resolve(); },
    };
    vm.createContext(env);
    for (const name of ['cancelScheduledAutomaticTranslation', 'scheduleAutomaticTranslation', 'scheduleSwipeTranslation', 'startCompletedAutomaticOutput', 'handleCompletedAssistantMessage', 'handleGenerationEnded', 'resumeAutomaticOutputs', 'setupAutomaticOutputLifecycle', 'scheduleFreshMountedAssistantTranslations']) vm.runInContext(extract(name), env);
    const flush = () => { while (microtasks.length) microtasks.shift()(); };
    const tick = () => { const batch = [...timers.values()]; timers.clear(); for (const row of batch) row.fn(); flush(); };
    return { state, lifecycle, env, calls, timers, flush, tick, docEvents, windowEvents };
}
// Real entry runs hidden, with neither DOM nor timer execution. Repeated signals collapse.
{
    const f = fixture();
    f.env.handleCompletedAssistantMessage(0); f.env.handleCompletedAssistantMessage(0);
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
    f.state.clock += 12; f.flush(); assert.equal(f.calls.length, 1);
    f.env.handleCompletedAssistantMessage(0); f.env.resumeAutomaticOutputs(); f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.lifecycle.diagnostics().jobs[0].waitMs, 12);
    assert(!JSON.stringify(f.lifecycle.diagnostics()).includes('English reply'));
}
// No event, no translation: gen_finished is updated during streaming and proves nothing.
{
    const f = fixture(); f.lifecycle.start('normal');
    f.state.chat.push({ mes: 'Unfinished', gen_finished: new Date().toISOString() });
    f.state.mounted = true;
    f.env.scheduleFreshMountedAssistantTranslations(); f.env.resumeAutomaticOutputs(); f.tick();
    assert.equal(f.calls.length, 0);
    f.state.chat[1].mes = 'A complete answer.';
    f.env.handleGenerationEnded(); f.flush();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].source, 'A complete answer.');
}
// A real completion event is sufficient even before GENERATION_ENDED. Old proofs aren't.
{
    const f = fixture(); f.lifecycle.complete(0); f.lifecycle.start('normal');
    assert.equal(f.lifecycle.isComplete(0), false);
    f.env.resumeAutomaticOutputs(); f.flush(); assert.equal(f.calls.length, 0);
    f.state.chat.push({ mes: 'Finished new message.' });
    f.env.handleCompletedAssistantMessage(1); f.flush(); assert.equal(f.calls.length, 1);
    f.env.handleGenerationEnded(); f.flush();
    assert.deepEqual(f.calls.map(row => row.id), [1, 0], 'previously completed pending job may resume after generation ends');
}
// Resume recovers an accepted completion whose scheduled callback never ran; no old history scan.
{
    const f = fixture(); f.env.setupAutomaticOutputLifecycle();
    f.env.resumeAutomaticOutputs(); f.flush(); assert.equal(f.calls.length, 0);
    f.lifecycle.complete(0); f.docEvents.resume(); f.windowEvents.pageshow(); f.flush();
    assert.equal(f.calls.length, 1);
    f.env.pendingOutputs.clear(); f.state.chat[0].record = { translation: '완료' };
    f.docEvents.resume(); f.flush(); assert.equal(f.calls.length, 1);
}
// Exact source, swipe and chat identity are checked again before starting.
for (const change of [f => f.state.chat[0].mes = 'New unfinished text', f => f.state.chat[0].swipe_id = 1, f => f.state.chat = [{ mes: 'Different chat' }]]) {
    const f = fixture(); f.env.handleCompletedAssistantMessage(0); change(f); f.flush();
    assert.equal(f.calls.length, 0);
}
// OFF/owner changes cancel queued immediate work; returning doesn't retry failures.
for (const change of [f => f.env.settings.autoOutput = false, f => f.state.owner = false]) {
    const f = fixture(); f.env.handleCompletedAssistantMessage(0); change(f); f.flush(); assert.equal(f.calls.length, 0);
}
{
    const f = fixture(); f.lifecycle.complete(0); f.env.failedOutputSignatures.set(0, signature(f.state.chat[0]));
    f.env.resumeAutomaticOutputs(); f.flush(); assert.equal(f.calls.length, 0);
    f.lifecycle.discard(); f.env.failedOutputSignatures.clear(); f.env.resumeAutomaticOutputs(); f.flush(); assert.equal(f.calls.length, 0);
}
// Generic missing-node fallback accepts proven completion, never unproven imported/partial data.
{
    const f = fixture(); f.state.chat.push({ mes: 'Finished offscreen.' });
    f.env.scheduleFreshMountedAssistantTranslations(); f.tick(); assert.equal(f.calls.length, 0);
    f.lifecycle.complete(1); f.env.scheduleFreshMountedAssistantTranslations(); f.tick(); assert.equal(f.calls.length, 1);
}
// Streaming swipes still wait, but a proven final swipe dispatches without any
// hidden-page setTimeout callback (which Android may defer until foreground).
{
    const f = fixture(); f.lifecycle.start('swipe');
    f.state.chat[0].swipe_id = 1; f.state.chat[0].mes = 'Partial';
    f.env.scheduleSwipeTranslation(0, '0:An old English reply.'); f.tick(); assert.equal(f.calls.length, 0);
    f.state.chat[0].mes = 'Final swipe.'; f.env.handleCompletedAssistantMessage(0);
    assert.equal(f.calls.length, 0, 'finish the event turn before dispatch');
    assert.equal(f.timers.size, 0, 'proven swipe must not wait for throttled timers');
    f.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].source, 'Final swipe.');
}
// Duplicate completion signals cannot launch the same swipe twice.
{
    const f = fixture(); f.lifecycle.start('swipe');
    f.state.chat[0].swipe_id = 1; f.state.chat[0].mes = 'Final swipe.';
    f.env.scheduleSwipeTranslation(0, '0:An old English reply.');
    f.env.handleCompletedAssistantMessage(0); f.env.handleCompletedAssistantMessage(0);
    f.flush(); assert.equal(f.calls.length, 1);
}
// If the source changes before the microtask, reject the stale proof, not
// the latest unconfirmed streaming text.
{
    const f = fixture(); f.lifecycle.start('swipe');
    f.state.chat[0].swipe_id = 1; f.state.chat[0].mes = 'First final signal.';
    f.env.scheduleSwipeTranslation(0, '0:An old English reply.');
    f.env.handleCompletedAssistantMessage(0);
    f.state.chat[0].mes = 'Later unconfirmed revision.';
    f.flush(); assert.equal(f.calls.length, 0);
}
// Quiet/dry/impersonation must not create completion evidence for an old reply.
for (const [type, dry] of [['quiet', false], ['impersonate', false], ['normal', true]]) {
    const f = fixture(); f.lifecycle.start(type, {}, dry); f.env.handleGenerationEnded(); f.flush(); assert.equal(f.calls.length, 0);
}
{
    const f = fixture(); f.lifecycle.start('normal'); f.lifecycle.stop(); assert(!f.lifecycle.busy());
    for (let i = 0; i < 100; i++) f.lifecycle.trace('page-resumed');
    assert.equal(f.lifecycle.diagnostics().events.length, 60);
}
assert.match(source, /automaticOutput:[^\n]*automaticOutputLifecycle\.diagnostics\(\)/);
assert.match(source, /if \(options\.automatic\) automaticOutputLifecycle\.started\(id\)/);
assert.match(source, /source\.on\(types\.GENERATION_STARTED, \(type, options, dryRun\) => automaticOutputLifecycle\.start/);
assert.match(source, /source\.on\(types\.CHAT_CHANGED,[\s\S]*?automaticOutputLifecycle\.reset\(\)/);
console.log('PASS: hidden completion without timers/DOM, streaming guard, exact-version resume, dedup, OFF/owner/chat changes, instant proven swipe, no history replay and private bounded timing diagnostics.');
