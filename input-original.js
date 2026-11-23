// Shared metadata lets either member of the translation pair display saved inputs.
// mes remains the English prompt. display_text is the native display-only field.
export const INPUT_ORIGINAL_KEY = 'verba_input_original';

export function saveInputOriginal(message, source, translation) {
    if (!message?.is_user || typeof source !== 'string' || !source.trim()
        || typeof translation !== 'string' || !translation.trim()
        || message.mes !== translation) return false;
    message.extra ??= {};
    syncInputOriginalDisplay(message, false);
    message.extra[INPUT_ORIGINAL_KEY] = { source, translation };
    syncInputOriginalDisplay(message, true);
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

/** Synchronize the native saved display field; never change prompt text. */
export function syncInputOriginalDisplay(message, enabled) {
    const extra = message?.extra;
    const record = extra?.[INPUT_ORIGINAL_KEY];
    if (!message?.is_user || !record || typeof record !== 'object') return false;
    const owned = typeof record.displayText === 'string' ? record.displayText : null;
    const valid = typeof record.source === 'string' && record.source.trim()
        && typeof record.translation === 'string' && record.translation === message.mes;
    let changed = false;
    if (!enabled || !valid) {
        // Restore the normal English view only while we still own this field.
        // A different extension's replacement must never be erased.
        if (owned !== null && extra.display_text === owned) {
            delete extra.display_text;
            changed = true;
        }
        if (Object.hasOwn(record, 'displayText')) {
            delete record.displayText;
            changed = true;
        }
        return changed;
    }
    const current = extra.display_text;
    if (current != null && current !== message.mes && current !== owned) {
        if (Object.hasOwn(record, 'displayText')) {
            delete record.displayText;
            return true;
        }
        return false;
    }
    // Markdown, rather than already rendered HTML, lets SillyTavern and other
    // readers apply their own normal formatting, regex and sanitization.
    const displayText = `${message.mes}\n\n---\n\n${record.source}`;
    if (current !== displayText) {
        extra.display_text = displayText;
        changed = true;
    }
    if (owned !== displayText) {
        record.displayText = displayText;
        changed = true;
    }
    return changed;
}
