import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSelectedVertexModel, installVertexModelCompatibility } from '../../model-compat.js';

function fixture() {
    let changes = 0;
    const profile = Object.freeze({ id: 'chat-profile', mode: 'cc', api: 'vertexai', model: 'gemini-4-argon', preset: 'unchanged' });
    const current = { chat_completion_source: 'vertexai', vertexai_model: '', vertexai_region: 'global', vertexai_express_project_id: 'unchanged', temp_openai: 0.83 };
    const context = { mainApi: 'openai', chatCompletionSettings: current, extensionSettings: { connectionManager: { selectedProfile: profile.id, profiles: [profile] } } };
    const select = { options: [{ value: 'gemini-4-argon' }], value: '', dispatchEvent(event) {
        assert.equal(event.type, 'change'); assert.equal(event.bubbles, true);
        changes++; current.vertexai_model = this.value;
    } };
    const document = { getElementById: id => id === 'model_vertexai_select' ? select : null, defaultView: { Event } };
    return { context, current, select, document, changes: () => changes };
}
test('restores the selected chat profile through the native model event without changing preset fields', () => {
    const f = fixture(), before = { ...f.current };
    assert.equal(restoreSelectedVertexModel(f.context, f.document), true);
    assert.deepEqual(f.current, { ...before, vertexai_model: 'gemini-4-argon' });
    assert.equal(f.changes(), 1);
    assert.equal(restoreSelectedVertexModel(f.context, f.document), false);
    assert.equal(f.changes(), 1);
});
for (const [name, modify] of [
    ['existing manual model', f => f.current.vertexai_model = 'manual-model'],
    ['other API', f => f.current.chat_completion_source = 'openai'],
    ['text completion', f => f.context.mainApi = 'textgenerationwebui'],
    ['no selected profile', f => f.context.extensionSettings.connectionManager.selectedProfile = ''],
    ['missing custom model option', f => f.select.options = [{value:'first-model-must-not-be-used'}]],
    ['different profile API', f => f.context.extensionSettings.connectionManager.profiles = [{id:'chat-profile',mode:'cc',api:'openai',model:'gemini-4-argon'}]],
]) test(`does not guess or overwrite: ${name}`, () => {
    const f=fixture(); modify(f); const before={...f.current};
    assert.equal(restoreSelectedVertexModel(f.context,f.document),false);
    assert.equal(f.changes(),0); assert.deepEqual(f.current,before);
});
test('waits until app/profile load and installs only once for both translators', async () => {
    const f=fixture(), events=new Map();
    f.context.eventTypes={APP_READY:'ready',CONNECTION_PROFILE_LOADED:'profile'};
    f.context.eventSource={on(name,handler){assert.equal(events.has(name),false);events.set(name,handler);}};
    const old=globalThis.document; globalThis.document=f.document;
    try {
        installVertexModelCompatibility(()=>f.context);
        const deep=await import('../../model-compat.js?second-translator');
        deep.installVertexModelCompatibility(()=>f.context);
        assert.equal(f.changes(),0);
        events.get('ready')(); assert.equal(f.current.vertexai_model,'gemini-4-argon');
        events.get('profile')(); assert.equal(f.changes(),1);
    } finally {globalThis.document=old;}
});
