// Diagnostic-only, bounded source mutation tracker. Never modifies translation text.
// Active only while the owning extension enables diagnostics.
const MAX_EVENTS = 48;
const MAX_FULL_TEXT_EVENTS = 8;
const MAX_TRACKED = 6;

const MODULE_URL = String(import.meta.url || '');
const IS_DEEP_VARIANT = /(?:\/|\\)(?:veereubaa|verba-deep)(?:\/|\\)/iu.test(MODULE_URL);
const FULL_TEXT_PREFERENCE = Object.freeze({
    storageKey: IS_DEEP_VARIANT ? 'verba-deep.debugFullSource.v1' : 'verba.debugFullSource.v1',
    checkboxId: IS_DEEP_VARIANT ? 'verba-deep-debug-full-source' : 'verba-debug-full-source',
    helpClass: IS_DEEP_VARIANT ? 'verba-deep-help' : 'verba-help',
});
const UI_INSTALL_KEY = Symbol.for(`verba.full-source-preference.ui.${IS_DEEP_VARIANT ? 'deep' : 'standard'}.v1`);
const MEMORY_PREFERENCE_KEY = Symbol.for(`verba.full-source-preference.memory.${IS_DEEP_VARIANT ? 'deep' : 'standard'}.v1`);

function usableStorage(storage) {
    try {
        const candidate = storage === undefined ? globalThis.localStorage : storage;
        if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') return null;
        return candidate;
    } catch {
        return null;
    }
}

export function readPersistentFullTextPreference(storage, key = FULL_TEXT_PREFERENCE.storageKey) {
    const target = usableStorage(storage);
    if (target) {
        try { return target.getItem(key) === 'true'; }
        catch { /* Fall through to the in-memory preference. */ }
    }
    return globalThis[MEMORY_PREFERENCE_KEY] === true;
}

export function writePersistentFullTextPreference(value, storage, key = FULL_TEXT_PREFERENCE.storageKey) {
    const enabled = value === true;
    globalThis[MEMORY_PREFERENCE_KEY] = enabled;
    const target = usableStorage(storage);
    if (target) {
        try { target.setItem(key, enabled ? 'true' : 'false'); }
        catch { /* Private browsing may reject writes; memory still works for this page. */ }
    }
    return enabled;
}

function installPersistentFullTextPreferenceUi() {
    const doc = globalThis.document;
    if (!doc?.addEventListener || globalThis[UI_INSTALL_KEY]) return;
    globalThis[UI_INSTALL_KEY] = true;

    let syncQueued = false;
    const scheduleSync = () => {
        if (syncQueued) return;
        syncQueued = true;
        queueMicrotask(() => {
            syncQueued = false;
            syncPreferenceUi();
        });
    };
    const updateHelp = input => {
        const help = input.closest?.('label')?.nextElementSibling;
        if (!help?.classList?.contains(FULL_TEXT_PREFERENCE.helpClass)) return;
        const before = '세션 전용으로 새로고침하면 꺼집니다.';
        const after = '한 번 켜면 직접 끌 때까지 새로고침 후에도 유지됩니다.';
        if (help.textContent?.includes(before)) help.textContent = help.textContent.replace(before, after);
    };
    const syncPreferenceUi = () => {
        const input = doc.getElementById?.(FULL_TEXT_PREFERENCE.checkboxId);
        if (!input) return;
        const preferred = readPersistentFullTextPreference();
        updateHelp(input);

        if (!preferred) {
            delete input.dataset.verbaPersistentFullSourceApplied;
            return;
        }

        // Keep the visible preference checked even while its prerequisites are
        // temporarily disabled. Recording itself is still gated by debug mode
        // and server translation through createSourceChangeTracer().
        const restoredCheckedState = !input.checked;
        if (restoredCheckedState) input.checked = true;
        if (input.disabled) {
            delete input.dataset.verbaPersistentFullSourceApplied;
            return;
        }
        if (!restoredCheckedState && input.dataset.verbaPersistentFullSourceApplied === '1') return;
        input.dataset.verbaPersistentFullSourceApplied = '1';
        // Restoring a saved preference is not a new user opt-in. Do not dispatch
        // a synthetic change event: index.js would show the sensitive-content
        // warning again on every reload. The persisted preference already feeds
        // createSourceChangeTracer() directly, while a real click still bubbles
        // through the normal change handler and shows the warning once.
    };

    doc.addEventListener('change', event => {
        const input = event.target;
        if (input?.id !== FULL_TEXT_PREFERENCE.checkboxId) {
            scheduleSync();
            return;
        }
        if (event.isTrusted) {
            writePersistentFullTextPreference(Boolean(input.checked));
            if (!input.checked) delete input.dataset.verbaPersistentFullSourceApplied;
            else input.dataset.verbaPersistentFullSourceApplied = '1';
        }
        scheduleSync();
    }, true);
    for (const name of ['click', 'input', 'focusin']) doc.addEventListener(name, scheduleSync, true);
    doc.addEventListener('visibilitychange', scheduleSync);
    globalThis.addEventListener?.('pageshow', scheduleSync);

    // The settings panel may be inserted after this module loads. A few bounded
    // retries restore the visible checkbox without replaying the opt-in warning.
    for (const delay of [0, 50, 250, 1000]) globalThis.setTimeout?.(scheduleSync, delay);

    const root = doc.documentElement;
    if (root && typeof globalThis.MutationObserver === 'function') {
        const observer = new MutationObserver(scheduleSync);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
    scheduleSync();
}

installPersistentFullTextPreferenceUi();

function describeChange(before, after) {
    before = String(before ?? '');
    after = String(after ?? '');
    let prefix = 0, suffix = 0;
    const min = Math.min(before.length, after.length);
    while (prefix < min && before[prefix] === after[prefix]) prefix += 1;
    while (suffix < min - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const removed = before.slice(prefix, before.length - suffix);
    const allowedTags = /(?:<|&lt;)\s*\/?\s*(scene_state|sfw_scene|archive(?:[-_]now)?|charm(?:[-_]now)?|rp_plan|starter|thinking|analysis)\b/giu;
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

export function createSourceChangeTracer({
    enabled,
    fullTextEnabled,
    persistentFullTextEnabled = readPersistentFullTextPreference,
    readSource,
    onChange = () => {},
    now = Date.now,
} = {}) {
    const tracked = new Map();
    const events = [];
    const isEnabled = () => enabled?.() === true;
    const wantsFullText = () => isEnabled()
        && (fullTextEnabled?.() === true || persistentFullTextEnabled?.() === true);
    // Only the opt-in boolean is persisted. Full source text remains in memory
    // for the latest eight events and is never written to settings or storage.
    const textSnapshot = (before, after, change) => wantsFullText() ? {
        beforeText: before,
        afterText: after,
        removedText: before.slice(change.commonPrefixLength, before.length - change.commonSuffixLength),
        insertedText: after.slice(change.commonPrefixLength, after.length - change.commonSuffixLength),
    } : {};
    const safeRead = message => {
        try { return String(readSource?.(message) ?? ''); } catch { return ''; }
    };
    const push = entry => {
        events.push({ at: now(), ...entry });
        if (events.length > MAX_EVENTS) events.shift();
        // Keep entire (untruncated) strings for only the latest eight changes.
        const detailed = events.filter(row => Object.hasOwn(row, 'beforeText'));
        for (const row of detailed.slice(0, -MAX_FULL_TEXT_EVENTS)) {
            delete row.beforeText;
            delete row.afterText;
            delete row.removedText;
            delete row.insertedText;
            row.fullTextExpired = true;
        }
        const row = events.at(-1);
        try {
            onChange({
                messageId: row?.messageId, method: row?.method, field: row?.field, relation: row?.relation,
                removedLength: row?.removedLength, insertedLength: row?.insertedLength,
            });
        } catch { /* Diagnostics must never affect RP or translation. */ }
    };
    const logChange = (entry, before, after, method, field, phase, writer = null, effective = true) => {
        if (!isEnabled() || before === after) return;
        const change = describeChange(before, after);
        push({
            event: 'source-changed', messageId: entry.id, method, field, phase,
            ...change, ...textSnapshot(before, after, change),
            effectiveSourceChanged: effective,
            ...(writer || { possibleWriter: null, frames: [] }),
        });
    };
    const unhook = entry => {
        for (const stop of [...entry.restores].reverse()) {
            try { stop(); } catch { /* Host may have replaced the descriptor. */ }
        }
        entry.restores.length = 0;
        try { entry.swipeStop?.(); } catch { /* Ignore superseded descriptor. */ }
        entry.swipeStop = null;
        for (const stop of (entry.swipeNestedStops || []).reverse()) {
            try { stop(); } catch { /* Ignore superseded descriptor. */ }
        }
        entry.swipeNestedStops = [];
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
            const active = isEnabled();
            const beforeEffective = active ? safeRead(entry.message) : '';
            const old = value;
            value = next;
            if (active) {
                const afterEffective = safeRead(entry.message);
                const ownText = typeof old === 'string' && typeof next === 'string';
                const before = ownText ? old : beforeEffective;
                const after = ownText ? next : afterEffective;
                logChange(entry, before, after, 'property-write', path, entry.phase,
                    callingCode(), beforeEffective !== afterEffective);
                entry.lastSource = afterEffective;
                entry.lastMes = typeof entry.message?.mes === 'string' ? entry.message.mes : '';
            }
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
        for (const stop of (entry.swipeNestedStops || []).reverse()) {
            try { stop(); } catch { /* Ignore superseded descriptor. */ }
        }
        entry.swipeNestedStops = [];
        const swipes = entry.message?.swipes;
        const slot = Number(entry.message?.swipe_id);
        if (!Array.isArray(swipes) || !Number.isInteger(slot) || slot < 0 || !Object.hasOwn(swipes, slot)) return;
        entry.swipeStop = watchData(entry, swipes, String(slot), 'swipes[' + slot + ']', () => trackSwipe(entry));
        // Some versions hold swipe text inside an object rather than a string.
        const activeSwipe = swipes[slot];
        if (activeSwipe && typeof activeSwipe === 'object') {
            for (const field of ['mes', 'text', 'content', 'message']) {
                const stop = watchData(entry, activeSwipe, field, 'swipes[' + slot + '].' + field);
                if (stop) entry.swipeNestedStops.push(stop);
            }
        }
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
        const mes = typeof message.mes === 'string' ? message.mes : '';
        let entry = tracked.get(id);
        if (entry?.message !== message) {
            if (entry) {
                logChange(entry, entry.lastSource, source, 'message-object-replaced', 'chat[index]', phase);
                unhook(entry);
                tracked.delete(id);
            }
            entry = { id, message, lastSource: source, lastMes: mes, phase, restores: [], swipeStop: null, swipeNestedStops: [] };
            tracked.set(id, entry);
            hook(entry);
            if (tracked.size > MAX_TRACKED) {
                const first = tracked.keys().next().value;
                unhook(tracked.get(first));
                tracked.delete(first);
            }
            return;
        }
        logChange(entry, entry.lastSource, source, 'checkpoint-difference', 'effective-source', phase, null, true);
        if (entry.lastSource === source) {
            logChange(entry, entry.lastMes, mes, 'checkpoint-difference', 'message.mes', phase, null, false);
        }
        entry.lastSource = source;
        entry.lastMes = mes;
        entry.phase = phase;
    }
    function compare(id, before, after, phase = 'before-apply') {
        if (!isEnabled() || before === after) return;
        const change = describeChange(before, after);
        push({
            event: 'server-versus-live', messageId: id, method: 'output-snapshot-compare',
            field: 'effective-source', phase, ...change, ...textSnapshot(before, after, change),
            effectiveSourceChanged: true, possibleWriter: null,
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
            fullTextEnabled: wantsFullText(),
            fullTextEventLimit: MAX_FULL_TEXT_EVENTS,
            trackedMessageIds: [...tracked.keys()],
            events: events.map(row => ({
                ...row,
                frames: row.frames ? [...row.frames] : undefined,
                removedTagHints: row.removedTagHints ? [...row.removedTagHints] : undefined,
            })),
            limitation: 'possibleWriter is a clue, not proof. Object replacement or changes before tracking may only be visible at checkpoints. Full source text is captured only after explicit opt-in, in memory for the last eight changes; the opt-in preference persists locally until it is unchecked, and manually copied logs then contain the complete RP text.',
        };
    }
    return { observe, compare, reset, diagnostics };
}
