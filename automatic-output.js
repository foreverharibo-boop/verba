// Completion evidence belongs to one live chat and exact source/swipe version.
// No DOM, timers, model calls, message bodies, or names are retained in diagnostics.
export function createAutomaticOutputLifecycle({ getChat, signature, now = Date.now, visibility = () => 'unknown' }) {
    let chat = null;
    let generation = null;
    const completed = new Map();
    const history = [];
    const assistant = message => message && !message.is_user && !message.is_system;
    function trace(event, id = null) {
        history.push({ event, messageId: id, at: now(), visibility: visibility() });
        if (history.length > 60) history.shift();
    }
    function reset() {
        chat = getChat();
        generation = null;
        completed.clear();
        history.length = 0;
    }
    function sync() { if (chat !== getChat()) reset(); }
    function complete(id, reason = 'message-received') {
        sync();
        const message = chat?.[id];
        if (!assistant(message)) return false;
        const version = signature(message);
        if (!version) return false;
        if (generation) generation.proven.add(id);
        const previous = completed.get(id);
        if (previous?.version !== version) {
            completed.set(id, { version, receivedAt: now(), startedAt: null });
            // Keep bounded, including for exceptionally long sessions.
            if (completed.size > 96) completed.delete(completed.keys().next().value);
        }
        trace(reason, id);
        return true;
    }
    function isComplete(id) {
        sync();
        return assistant(chat?.[id]) && completed.get(id)?.version === signature(chat[id])
            && (!generation || generation.proven.has(id));
    }
    function ready() {
        sync();
        if (generation) return [];
        return [...completed.keys()].filter(id => isComplete(id) && completed.get(id).startedAt === null);
    }
    return {
        reset, complete, isComplete, ready, trace,
        busy() { sync(); return generation !== null; },
        start(type, options = {}, dryRun = false) {
            sync();
            if (dryRun || type === 'quiet' || type === 'impersonate') return;
            generation = { baseline: new Map(), proven: new Set() };
            (chat || []).forEach((message, id) => {
                if (assistant(message)) generation.baseline.set(id, signature(message));
            });
            trace('generation-started');
        },
        end() {
            sync();
            const baseline = generation?.baseline;
            generation = null;
            // A timestamp is NOT completion proof: ST updates gen_finished while streaming.
            if (baseline) (chat || []).forEach((message, id) => {
                if (assistant(message) && baseline.get(id) !== signature(message)) complete(id, 'generation-ended');
            });
            trace('generation-ended');
            return ready();
        },
        started(id) {
            sync();
            if (isComplete(id)) completed.get(id).startedAt ??= now();
            trace('translation-started', id);
        },
        stop() { sync(); generation = null; trace('generation-stopped'); },
        discard() { sync(); completed.clear(); },
        diagnostics() {
            sync();
            return {
                generating: generation !== null,
                events: history.map(row => ({ ...row })),
                jobs: [...completed.entries()].map(([id, row]) => ({
                    messageId: id, receivedAt: row.receivedAt, startedAt: row.startedAt,
                    waitMs: row.startedAt === null ? null : Math.max(0, row.startedAt - row.receivedAt),
                })),
            };
        },
    };
}
