// Checkpoints only. No property interception, polling, DOM reads or full text retention.
const PHASES = new Set(['translation-entered','before-result-apply','apply-before','apply-stored','apply-rendered',
    'message-received','message-edited','message-updated','generation-ended','page-resumed','page-hidden','page-visible',
    'dom-updated','debug-enabled','full-text-enabled','full-text-disabled','startup','log-copy','diagnostic']);
const fingerprint = value => {
    if (typeof value !== 'string') return { present:false, length:0, hash:null };
    let hash = 2166136261;
    for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash,16777619); }
    return { present:true, length:value.length, hash:(hash>>>0).toString(36) };
};
export function createDisplayStateTrace({ enabled=()=>false, now=()=>Date.now() }={}) {
    let previous = new Map(), events = [];
    return {
        observe(messageId, message, record, phase, active, sourceViewRequested) {
            if (!enabled() || !message || !Number.isInteger(messageId) || messageId < 0) return;
            const state = { swipeId:Number.isInteger(message.swipe_id)?message.swipe_id:0,
                stored:fingerprint(record?.translation), display:fingerprint(message.extra?.display_text),
                matches:!!record && message.extra?.display_text === record.translation,
                active:active===true, sourceViewRequested:sourceViewRequested===true };
            const prior = previous.get(messageId);
            const at = now();
            if (!prior || JSON.stringify(prior.state) !== JSON.stringify(state) || String(phase).startsWith('apply-')) {
                events.push({ messageId, at, phase:PHASES.has(phase)?phase:'other',
                    previousObservedAt:prior?.at ?? null, before:prior?.state ?? null, after:state });
                events = events.slice(-24);
            }
            previous.delete(messageId); previous.set(messageId,{at,state});
            while(previous.size>16) previous.delete(previous.keys().next().value);
        },
        diagnostics() { return { enabled:enabled(), events:enabled()?structuredClone(events):[],
            limitation:'Checkpoint observations of display_text versus saved translation, not rendered DOM. Change happened between observations; phase does not identify the writer. Hashes are non-cryptographic.' }; },
        reset() { previous.clear(); events=[]; },
    };
}
