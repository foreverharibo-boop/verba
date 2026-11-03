import { normalizeTranslationReference, TRANSLATION_REFERENCE_LIMIT } from './translation-context.js';

// A separate field avoids overwriting the character's existing name locks.
export function createCharacterTranslationReference({ fieldKey, currentReference, notify, delay = 350 }) {
    const entries = new Map();
    let input = null;
    let status = null;
    let boundReference = null;
    const key = reference => reference?.character?.avatar || reference?.character;
    const persisted = reference => normalizeTranslationReference(reference?.character?.data?.extensions?.[fieldKey]);
    function read(reference = currentReference()) {
        if (!reference) return '';
        return entries.get(key(reference))?.text ?? persisted(reference);
    }
    function show(reference, text) {
        if (status && key(boundReference) === key(reference)) status.textContent = text;
    }
    function flush(entry) {
        clearTimeout(entry.timer);
        entry.timer = null;
        const text = entry.text;
        const reference = entry.reference;
        const version = entry.version;
        entry.chain = entry.chain.catch(() => {}).then(async () => {
            // Resolve the captured character by stable identity, never by the active chat.
            const characters = reference.context.characters || [];
            const id = characters.findIndex(character => reference.character.avatar
                ? character?.avatar === reference.character.avatar : character === reference.character);
            if (id < 0 || typeof reference.context.writeExtensionField !== 'function') {
                throw new Error('캐릭터를 찾을 수 없거나 저장을 지원하지 않습니다.');
            }
            const character = characters[id];
            await reference.context.writeExtensionField(id, fieldKey, text);
            character.data ||= {};
            character.data.extensions ||= {};
            character.data.extensions[fieldKey] = text;
            if (entry.version === version) {
                entry.dirty = false;
                entries.delete(key(reference));
                show(reference, '저장됨');
            }
        }).catch(() => {
            show(reference, '저장 실패 · 입력 내용을 다시 수정해 재시도해 주세요');
            notify('번역 참고 설정을 저장하지 못했어요. 입력 내용은 현재 화면에 유지됩니다.', 'error');
        });
        return entry.chain;
    }
    function edit(reference, value) {
        if (!reference) return Promise.resolve();
        const id = key(reference);
        const entry = entries.get(id) || { chain: Promise.resolve(), version: 0 };
        clearTimeout(entry.timer);
        Object.assign(entry, { reference, text: normalizeTranslationReference(value), dirty: true, version: entry.version + 1 });
        entries.set(id, entry);
        show(reference, '저장 중…');
        entry.timer = setTimeout(() => flush(entry), delay);
    }
    function refresh() {
        if (!input) return;
        boundReference = currentReference();
        input.disabled = !boundReference;
        input.value = read(boundReference);
        const name = boundReference?.character?.name || boundReference?.character?.data?.name || '';
        status.textContent = boundReference ? `${name} · ${entries.get(key(boundReference))?.dirty ? '저장 중…' : '캐릭터별 자동 저장'}` : '개별 캐릭터 채팅에서 입력해 주세요';
    }
    function bind(root) {
        input = root.querySelector('[data-translation-reference]');
        status = root.querySelector('[data-translation-reference-status]');
        if (!input || !status) return;
        input.maxLength = TRANSLATION_REFERENCE_LIMIT;
        input.addEventListener('input', () => edit(boundReference, input.value));
        input.addEventListener('change', () => {
            const entry = entries.get(key(boundReference));
            if (entry?.timer) flush(entry);
        });
        refresh();
    }
    return { read, edit, bind, refresh, flush: reference => {
        const entry = entries.get(key(reference));
        return entry?.dirty ? flush(entry) : Promise.resolve();
    } };
}
