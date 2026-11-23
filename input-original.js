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

const renderedOriginals = new WeakMap();

export function renderInputOriginal(element, message, { prefix, enabled, formatMessage }) {
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
    // Use the existing message body so theme typography, padding and quote
    // styles apply equally to English and the original. Do not create another
    // .mes_text: SillyTavern would create a second editor when editing a message.
    // Only DOM presentation changes; mes and display_text remain untouched.
    const block = existing || element.ownerDocument.createElement('div');
    if (!existing) {
        block.className = className;
    }
    const key = JSON.stringify([record.source, message.name, Boolean(message.is_system)]);
    if (renderedOriginals.get(block) !== key) {
        if (typeof formatMessage === 'function') {
            // The caller supplies SillyTavern's native formatter, including its
            // Markdown, user-message regex, quote markup and DOMPurify stages.
            try {
                block.innerHTML = String(formatMessage(record.source, message) ?? '');
            } catch {
                block.textContent = record.source;
            }
        } else {
            block.textContent = record.source;
        }
        renderedOriginals.set(block, key);
    }
    if (text.lastElementChild !== block) text.append(block);
}
