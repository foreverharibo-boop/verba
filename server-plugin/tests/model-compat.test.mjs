import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSelectedVertexModel, installVertexModelCompatibility } from '../../model-compat.js';

function fixture({ swallowChange = false } = {}) {
    let changes = 0;
    const profiles = [
        Object.freeze({ id: 'chat-profile', mode: 'cc', api: 'vertexai', model: 'gemini-3.1-pro-preview', preset: 'unchanged' }),
        Object.freeze({ id: 'argon-profile', mode: 'cc', api: 'vertexai', model: 'gemini-4-argon', preset: 'unchanged' }),
    ];
    const current = { chat_completion_source: 'vertexai', vertexai_model: '', vertexai_region: 'global', vertexai_express_project_id: 'unchanged', temp_openai: 0.83 };
    const context = { mainApi: 'openai', chatCompletionSettings: current, extensionSettings: { connectionManager: { selectedProfile: 'chat-profile', profiles } } };
    const select = { options: [{ value: 'gemini-3.1-pro-preview' }, { value: 'gemini-4-argon' }], value: '', dispatchEvent(event) {
        assert.equal(event.type, 'change'); assert.equal(event.bubbles, true);
        changes++;
        if (!swallowChange) current.vertexai_model = this.value;
    } };
    const document = { getElementById: id => id === 'model_vertexai_select' ? select : null, defaultView: { Event } };
    return { context, current, select, document, changes: () => changes };
}

test('APP_READY restores only an empty model from the globally selected chat profile', () => {
    const f = fixture(), before = { ...f.current };
    assert.equal(restoreSelectedVertexModel(f.context, f.document), true);
    assert.deepEqual(f.current, { ...before, vertexai_model: 'gemini-3.1-pro-preview' });
    assert.equal(f.select.value, 'gemini-3.1-pro-preview');
    assert.equal(f.changes(), 1);
    assert.equal(restoreSelectedVertexModel(f.context, f.document), false);
});

test('an explicit loaded Argon profile wins over another selected chat model', () => {
    const f = fixture();
    f.current.vertexai_model = 'gemini-3.1-pro-preview';
    f.select.value = 'gemini-3.1-pro-preview';
    assert.equal(restoreSelectedVertexModel(f.context, f.document, 'argon-profile'), true);
    assert.equal(f.current.vertexai_model, 'gemini-4-argon');
    assert.equal(f.select.value, 'gemini-4-argon');
});

test('keeps the actual request model even when a custom-model listener swallows change', () => {
    const f = fixture({ swallowChange: true });
    assert.equal(restoreSelectedVertexModel(f.context, f.document, 'argon-profile'), true);
    assert.equal(f.current.vertexai_model, 'gemini-4-argon');
    assert.equal(f.select.value, 'gemini-4-argon');
    assert.equal(f.changes(), 1);
});

for (const [name, modify, loadedProfileId] of [
    ['existing manual model on APP_READY', f => f.current.vertexai_model = 'manual-model', undefined],
    ['other API', f => f.current.chat_completion_source = 'openai', 'argon-profile'],
    ['text completion', f => f.context.mainApi = 'textgenerationwebui', 'argon-profile'],
    ['no selected profile', f => f.context.extensionSettings.connectionManager.selectedProfile = '', undefined],
    ['missing custom model option', f => f.select.options = [{ value: 'first-model-must-not-be-used' }], 'argon-profile'],
    ['unknown loaded profile does not fall back', () => {}, 'missing-profile'],
    ['different profile API', f => f.context.extensionSettings.connectionManager.profiles[1] = { id: 'argon-profile', mode: 'cc', api: 'openai', model: 'gemini-4-argon' }, 'argon-profile'],
]) test(`does not guess or overwrite: ${name}`, () => {
    const f = fixture(); modify(f); const before = { ...f.current };
    assert.equal(restoreSelectedVertexModel(f.context, f.document, loadedProfileId), false);
    assert.equal(f.changes(), 0); assert.deepEqual(f.current, before);
});

test('forwards the loaded profile id and installs only once for both translators', async () => {
    const f = fixture({ swallowChange: true }), events = new Map();
    f.context.eventTypes = { APP_READY: 'ready', CONNECTION_PROFILE_LOADED: 'profile' };
    f.context.eventSource = { on(name, handler) { assert.equal(events.has(name), false); events.set(name, handler); } };
    const old = globalThis.document; globalThis.document = f.document;
    try {
        installVertexModelCompatibility(() => f.context);
        const deep = await import('../../model-compat.js?second-translator');
        deep.installVertexModelCompatibility(() => f.context);
        events.get('ready')();
        assert.equal(f.current.vertexai_model, 'gemini-3.1-pro-preview');
        f.current.vertexai_model = 'gemini-3.1-pro-preview';
        f.select.value = 'gemini-3.1-pro-preview';
        events.get('profile')('argon-profile');
        assert.equal(f.current.vertexai_model, 'gemini-4-argon');
        assert.equal(f.select.value, 'gemini-4-argon');
        assert.equal(f.changes(), 2);
    } finally { globalThis.document = old; }
});
