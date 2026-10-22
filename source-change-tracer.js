// Diagnostic-only, bounded source mutation tracker. Never modifies translation text.
// Active only while the experiment's server translation and debug modes are enabled.
const MAX_EVENTS = 48;
const MAX_TRACKED = 6;

function describeChange(before, after) {
    before = String(before ?? '');
    after = String(after ?? '');
    let prefix = 0, suffix = 0;
    const min = Math.min(before.length, after.length);
    while (prefix < min && before[prefix] === after[prefix]) prefix += 1;
    while (suffix < min - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const removed = before.slice(prefix, before.length - suffix);
    const allowedTags = /(?:<|&lt;)\s*\/?\s*(archive(?:[-_]now)?|charm(?:[-_]now)?|rp_plan|starter|thinking|analysis)\b/giu;
    return {
        beforeLength: before.length,
        afterLength: after.length,
        removedLength: removed.length,
        insertedLength: Math.max(0, after.length - prefix - suffix),
        commonPrefixLength: prefix,
        commonSuffixLength: suffix,
        relation: after === before ? 'same'
            : before.startsWith(after) ? 'tail-removed'
                : before.endsWith(after) ? 'head-removed'
                    : after.length < before.length ? 'text-shortened' : 'text-changed',
        removedTagHints: [...new Set([...removed.matchAll(allowedTags)].map(match => match[1].toLowerCase()))].slice(0, 6),
    };
}

// Only allowlisted module/extension identifiers and line numbers are recorded.
// No message body, URL query string, or unsanitized JavaScript stack is exported.
function callingCode() {
    const frames = [];
    for (const line of String(new Error().stack || '').split('\n').slice(1)) {
        if (line.includes('source-change-tracer.js')) continue;
        const match = line.match(/(?:https?:\/\/[^\s)]+|file:\/\/\/[^\s)]+|\/scripts\/[^\s)]+|\/script\.js:\d+:\d+)/u);
        if (!match) continue;
        const raw = match[0];
        const pos = /:(\d+):(\d+)$/u.exec(raw);
        const pathname = raw.replace(/:(\d+):(\d+)$/u, '').split(/[?#]/u)[0];
        const ext = /\/scripts\/extensions\/(?:third-party\/)?([a-z0-9_.-]+)\/([a-z0-9_./-]+\.m?js)$/iu.exec(pathname);
        const script = /\/([a-z0-9_.-]+\.m?js)$/iu.exec(pathname);
        if (!script) continue;
        const name = ext ? 'extension:' + ext[1] + '/' + ext[2].split('/').slice(-2).join('/')
            : 'script:' + script[1];
        frames.push(name + ':' + (pos?.[1] || '?') + ':' + (pos?.[2] || '?'));
        if (frames.length >= 5) break;
    }
    return { possibleWriter: frames.find(frame => frame.startsWith('extension:')) || frames[0] || null, frames };
}

export function createSourceChangeTracer({ enabled, readSource, now = Date.now } = {}) {
    const tracked = new Map();
    const events = [];
    const isEnabled = () => enabled?.() === true;
    const safeRead = message => {
        try { return String(readSource?.(message) ?? ''); } catch { return ''; }
    };
    const push = entry => {
        events.push({ at: now(), ...entry });
        if (events.length > MAX_EVENTS) events.shift();
    };
    const logChange = (entry, before, after, method, field, phase, writer = null) => {
        if (before === after) return;
        push({
            event: 'source-changed', messageId: entry.id, method, field, phase,
            ...describeChange(before, after), ...(writer || { possibleWriter: null, frames: [] }),
        });
    };
    const unhook = entry => {
        for (const stop of [...entry.restores].reverse()) {
            try { stop(); } catch { /* Host may have replaced the descriptor. */ }
        }
        entry.restores.length = 0;
        try { entry.swipeStop?.(); } catch { /* Ignore superseded descriptor. */ }
        entry.swipeStop = null;
    };
    // Only configurable, writable *own data* properties are observed.
    // Accessor properties already owned by SillyTavern or other extensions are left alone.
    const watchData = (entry, target, field, path, changed) => {
        if (!target || typeof target !== 'object') return null;
        const desc = Object.getOwnPropertyDescriptor(target, field);
        if (!desc || !desc.configurable || !('value' in desc) || !desc.writable) return null;
        let value = desc.value;
        const get = () => value;
        const set = next => {
            const before = safeRead(entry.message);
            value = next;
            const after = safeRead(entry.message);
            logChange(entry, before, after, 'property-write', path, entry.phase, callingCode());
            entry.lastSource = after;
            try { changed?.(); } catch { /* Diagnostics must never block source writes. */ }
        };
        try { Object.defineProperty(target, field, { configurable: true, enumerable: desc.enumerable, get, set }); }
        catch { return null; }
        return () => {
            const current = Object.getOwnPropertyDescriptor(target, field);
            if (current?.get === get && current?.set === set) {
                Object.defineProperty(target, field, { ...desc, value });
            }
        };
    };
    const trackSwipe = entry => {
        try { entry.swipeStop?.(); } catch { /* Ignore superseded descriptor. */ }
        entry.swipeStop = null;
        const swipes = entry.message?.swipes;
        const slot = Number(entry.message?.swipe_id);
        if (!Array.isArray(swipes) || !Number.isInteger(slot) || slot < 0 || !Object.hasOwn(swipes, slot)) return;
        entry.swipeStop = watchData(entry, swipes, String(slot), 'swipes[' + slot + ']', () => trackSwipe(entry));
    };
    const hook = entry => {
        for (const name of ['mes', 'swipes', 'swipe_id']) {
            const stop = watchData(entry, entry.message, name, 'message.' + name, () => {
                if (name !== 'mes') trackSwipe(entry);
            });
            if (stop) entry.restores.push(stop);
        }
        trackSwipe(entry);
    };
    function observe(id, message, phase = 'checkpoint') {
        if (!isEnabled() || !Number.isInteger(id) || id < 0 || !message || message.is_user || message.is_system) return;
        const source = safeRead(message);
        let entry = tracked.get(id);
        if (entry?.message !== message) {
            if (entry) {
                logChange(entry, entry.lastSource, source, 'message-object-replaced', 'chat[index]', phase);
                unhook(entry);
                tracked.delete(id);
            }
            entry = { id, message, lastSource: source, phase, restores: [], swipeStop: null };
            tracked.set(id, entry);
            hook(entry);
            if (tracked.size > MAX_TRACKED) {
                const first = tracked.keys().next().value;
                unhook(tracked.get(first));
                tracked.delete(first);
            }
            return;
        }
        logChange(entry, entry.lastSource, source, 'checkpoint-difference', 'effective-source', phase);
        entry.lastSource = source;
        entry.phase = phase;
    }
    function compare(id, before, after, phase = 'before-apply') {
        if (!isEnabled() || before === after) return;
        push({
            event: 'server-versus-live', messageId: id, phase, ...describeChange(before, after),
            possibleWriter: null,
            interpretation: 'Compare earlier source-changed events for attribution; this difference alone does not prove the writer.',
        });
    }
    function reset() {
        for (const entry of tracked.values()) unhook(entry);
        tracked.clear();
        events.length = 0;
    }
    function diagnostics() {
        return {
            enabled: isEnabled(),
            trackedMessageIds: [...tracked.keys()],
            events: events.map(row => ({
                ...row,
                frames: row.frames ? [...row.frames] : undefined,
                removedTagHints: row.removedTagHints ? [...row.removedTagHints] : undefined,
            })),
            limitation: 'possibleWriter is a call-stack clue, not proof. Object replacement, in-place mutation or changes before tracking may only be visible at checkpoints. Source text is not logged.',
        };
    }
    return { observe, compare, reset, diagnostics };
}
