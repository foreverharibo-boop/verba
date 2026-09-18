const COORDINATOR_KEY = '__verbaTranslationPairCoordinatorV1';
const DEFAULT_EXTENSION_KEY = 'verba';

function coordinator() {
    const current = globalThis[COORDINATOR_KEY];
    if (
        current
        && current.version === 1
        && current.registered instanceof Set
    ) return current;

    const created = {
        version: 1,
        registered: new Set(),
        selectedOwner: '',
        revision: 0,
    };
    globalThis[COORDINATOR_KEY] = created;
    return created;
}

function normalizedExtensionKey(value) {
    return String(value || '').trim();
}

function resolvedOwner(state) {
    if (state.selectedOwner && state.registered.has(state.selectedOwner)) {
        return state.selectedOwner;
    }
    if (state.registered.has(DEFAULT_EXTENSION_KEY)) return DEFAULT_EXTENSION_KEY;
    return state.registered.values().next().value || '';
}

export function registerTranslationExtension(extensionKey) {
    const key = normalizedExtensionKey(extensionKey);
    if (!key) return '';
    const state = coordinator();
    state.registered.add(key);
    return resolvedOwner(state);
}

export function activateTranslationExtension(extensionKey) {
    const key = normalizedExtensionKey(extensionKey);
    if (!key) return '';
    const state = coordinator();
    state.registered.add(key);
    if (state.selectedOwner !== key) {
        state.selectedOwner = key;
        state.revision += 1;
    }
    return key;
}

export function isTranslationExtensionActive(extensionKey) {
    const key = normalizedExtensionKey(extensionKey);
    if (!key) return false;
    const state = coordinator();
    state.registered.add(key);
    return resolvedOwner(state) === key;
}

export function currentTranslationExtensionOwner() {
    return resolvedOwner(coordinator());
}
