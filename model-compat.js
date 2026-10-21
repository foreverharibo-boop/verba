// Restore a selected Vertex profile after late custom-model registration.
// Never infer a model from the translation profile or the first dropdown item.
const INSTALLED = Symbol.for('verba.vertex-model-compat.sources.v1');

export function restoreSelectedVertexModel(context, document = globalThis.document) {
    const current = context?.chatCompletionSettings;
    if (context?.mainApi !== 'openai' || current?.chat_completion_source !== 'vertexai') return false;
    if (String(current.vertexai_model ?? '').trim()) return false;
    const manager = context.extensionSettings?.connectionManager;
    if (!manager?.selectedProfile) return false;
    const profile = manager?.profiles?.find(p => p.id === manager.selectedProfile);
    if (profile?.mode !== 'cc' || profile.api !== 'vertexai' || typeof profile.model !== 'string' || !profile.model.trim()) return false;
    const select = document?.getElementById?.('model_vertexai_select');
    if (!select || ![...select.options].some(option => option.value === profile.model)) return false;

    // Use ST's own model-change handler. A native event also reaches custom
    // model extensions, allowing them to persist the same explicit selection.
    select.value = profile.model;
    const EventClass = document.defaultView?.Event || globalThis.Event;
    select.dispatchEvent(new EventClass('change', { bubbles: true }));
    return current.vertexai_model === profile.model;
}

export function installVertexModelCompatibility(getContext) {
    const context = getContext();
    const source = context?.eventSource;
    if (!source?.on || !context.eventTypes?.APP_READY) return;
    const installed = globalThis[INSTALLED] ||= new WeakSet();
    if (installed.has(source)) return;
    installed.add(source);
    const restore = () => {
        try { restoreSelectedVertexModel(getContext()); }
        catch (error) { console.warn('[Verba] Vertex model restoration failed', error); }
    };
    source.on(context.eventTypes.APP_READY, restore);
    if (context.eventTypes.CONNECTION_PROFILE_LOADED) source.on(context.eventTypes.CONNECTION_PROFILE_LOADED, restore);
}
