'use strict';
const TARGETS = new Set(['legacy', 'none', 'apk', 'ios', 'and']);
function selectNotification(owner, notification) {
    const routing = globalThis[Symbol.for('silly-relay.notification-routing.v1')];
    let value = 'legacy';
    try { if (routing?.apiVersion === 1) value = routing.get(owner); }
    catch { value = 'none'; } // A broken preference must not send to the wrong device or fail translation.
    const target = TARGETS.has(value) ? value : 'legacy';
    const kind = target === 'legacy' ? 'apk' : target;
    const marker = notification?.routing === true ? notification.candidates?.[kind]
        : kind === 'apk' ? notification : null;
    return { target, kind, marker };
}
function prepareSelected(owner, selected) {
    if (!selected.marker || selected.target === 'none') return null;
    const hook = selected.kind === 'apk' ? globalThis[Symbol.for('silly-pop.translation-notifier')]
        : globalThis[Symbol.for('silly-pop.' + selected.kind + '.translation-notifier.v1')];
    return hook?.apiVersion === 1 ? hook.prepare(owner, selected.marker) : null;
}
function routeGeneration(connection, payload, target, translationPending) {
    if (target === 'legacy') return { connection, payload };
    const copy = { ...payload };
    for (const [kind, field] of [['apk', 'silly_pop'], ['ios', 'silly_pop_ios'], ['and', 'silly_pop_and']]) {
        if (kind !== target) delete copy[field];
        else if (translationPending && kind !== 'apk' && copy[field]) copy[field] = { ...copy[field], translationPending: true };
    }
    const headers = { ...connection.headers };
    if (target !== 'apk') delete headers['x-silly-pop'];
    return { connection: { ...connection, headers }, payload: copy };
}
module.exports = { selectNotification, prepareSelected, routeGeneration };
