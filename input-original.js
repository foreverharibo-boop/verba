// Shared metadata lets either member of the translation pair display saved inputs.
// Never write the original to mes or display_text: both can enter prompt pipelines.
export const INPUT_ORIGINAL_KEY = 'verba_input_original';

export function saveInputOriginal(message, source, translation) {
    if (!message?.is_user || typeof source !== 'string' || !source.trim()
        || typeof translation !== 'string' || !translation.trim()
        || message.mes !== translation) return false;
    message.extra ??= {};
    message.extra[INPUT_ORIGINAL_KEY] = { source, translation };
    return true;
}

export function createPendingInputOriginal() {
    let pending = null;
    return {
        reset() { pending = null; },
        stage(chat, source, translation) {
            pending = { chat, index: chat.length, source, translation };
        },
        attach(chat, id) {
            const candidate = pending;
            pending = null;
            if (!candidate || candidate.chat !== chat || candidate.index !== id) return false;
            const message = chat?.[id];
            if (String(message?.mes ?? '').trim() !== candidate.translation.trim()) return false;
            return saveInputOriginal(message, candidate.source, message.mes);
        },
    };
}

export function renderInputOriginal(element, message, { prefix, enabled }) {
    const className = `${prefix}-input-original`;
    const existing = element.querySelector(`.${className}`);
    const record = message?.extra?.[INPUT_ORIGINAL_KEY];
    const text = element.querySelector('.mes_text');
    const visible = enabled && message?.is_user && text
        && !element.querySelector('.edit_textarea')
        && typeof record?.source === 'string' && record.source.trim()
        && record.translation === message.mes;
    if (!visible) {
        existing?.remove();
        return;
    }
    // Keep the original outside .mes_text so copy, edit, and translation tools
    // continue to operate on the English message alone. textContent is deliberate:
    // user-authored HTML/macros must remain literal, never executable markup.
    const block = existing || element.ownerDocument.createElement('div');
    if (!existing) {
        block.className = className;
        const label = element.ownerDocument.createElement('small');
        label.textContent = '입력 원문';
        const body = element.ownerDocument.createElement('div');
        block.append(label, body);
    }
    if (block.lastElementChild.textContent !== record.source) {
        block.lastElementChild.textContent = record.source;
    }
    if (text.nextElementSibling !== block) text.after(block);
}
