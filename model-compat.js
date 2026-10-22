// Restore Vertex custom models after late option registration or profile loads.
// Never infer a model from the translation profile or the first dropdown item.
const INSTALLED = Symbol.for('verba.vertex-model-compat.sources.v1');

function exactProfile(manager, loadedProfileId) {
    const explicitId = typeof loadedProfileId === 'string' ? loadedProfileId.trim() : '';
    const profileId = explicitId || String(manager?.selectedProfile || '').trim();
    if (!profileId) return { profile: null, explicit: Boolean(explicitId) };
    return {
        profile: manager?.profiles?.find(profile => profile?.id === profileId) || null,
        explicit: Boolean(explicitId),
    };
}

export function restoreSelectedVertexModel(context, document = globalThis.document, loadedProfileId) {
    const current = context?.chatCompletionSettings;
    if (context?.mainApi !== 'openai' || current?.chat_completion_source !== 'vertexai') return false;
    const manager = context.extensionSettings?.connectionManager;
    const { profile, explicit } = exactProfile(manager, loadedProfileId);
    if (profile?.mode !== 'cc' || profile.api !== 'vertexai' || typeof profile.model !== 'string') return false;
    const target = profile.model.trim();
    if (!target) return false;

    const currentModel = String(current.vertexai_model ?? '').trim();
    // APP_READY is only a safety restore for an empty setting. A concrete
    // CONNECTION_PROFILE_LOADED event, however, must follow that exact profile
    // even if another model was selected before the temporary profile load.
    if (!explicit && currentModel) return false;

    const select = document?.getElementById?.('model_vertexai_select');
    if (!select || ![...select.options].some(option => option.value === target)) return false;
    if (currentModel === target && select.value === target) return false;

    select.value = target;
    // Custom-model extensions can stop the synthetic change event before
    // SillyTavern's own listener runs. Set the authoritative in-memory value
    // first, then still dispatch the native event so every listener can persist
    // the same explicit selection when its ordering permits.
    current.vertexai_model = target;
    const EventClass = document.defaultView?.Event || globalThis.Event;
    select.dispatchEvent(new EventClass('change', { bubbles: true }));
    // A listener must not be able to leave the outgoing request model blank.
    select.value = target;
    current.vertexai_model = target;
    return true;
}

export function installVertexModelCompatibility(getContext) {
    const context = getContext();
    const source = context?.eventSource;
    if (!source?.on || !context.eventTypes?.APP_READY) return;
    const installed = globalThis[INSTALLED] ||= new WeakSet();
    if (installed.has(source)) return;
    installed.add(source);
    const restore = loadedProfileId => {
        try { restoreSelectedVertexModel(getContext(), globalThis.document, loadedProfileId); }
        catch (error) { console.warn('[Verba] Vertex model restoration failed', error); }
    };
    source.on(context.eventTypes.APP_READY, () => restore());
    if (context.eventTypes.CONNECTION_PROFILE_LOADED) {
        source.on(context.eventTypes.CONNECTION_PROFILE_LOADED, loadedProfileId => restore(loadedProfileId));
    }
}
