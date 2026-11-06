
const TEXT_LIMIT = 160000;
const TOTAL_LIMIT = 2000000;
const EVENT_LIMIT = 60;
const SECRET = /(?:api[-_ ]?key|token|secret|password|authorization|cookie|credential|headers|connection|proxy[-_]?password)/i;
const SAFE_TOKEN_COUNT = /^(?:max_tokens|max_completion_tokens|prompt_tokens|completion_tokens|total_tokens)$/;

// Dedicated, opt-in text trace. Unlike normal error logs, this intentionally
// includes RP source/drafts/prompts. Never accepts request headers or settings.
function redactText(value) {
    // Bound labels and require a word boundary: long unbroken provider text must
    // not trigger quadratic scanning in a generic secret-label expression.
    const text = String(value)
        .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/(\b[\w-]{0,64}(?:api[-_ ]?key|token|secret|password|authorization|cookie|credential)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, '$1[REDACTED]')
        .replace(/([?&](?:key|api_key|access_token|auth|signature|sig)=)[^&#\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_KEY]')
        .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
    return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) + '…[길이 한도 생략]' : text;
}
export function cleanSecondTranslationDiagnostic(value) {
    const seen = new WeakSet(); let nodes = 0;
    function clean(item, depth) {
        if (++nodes > 8000 || depth > 12) return '[구조 한도 생략]';
        if (typeof item === 'string') return redactText(item);
        if (item == null || typeof item === 'boolean' || typeof item === 'number') return item;
        if (typeof item !== 'object') return '[직렬화 제외]';
        if (seen.has(item)) return '[순환 참조]';
        seen.add(item);
        if (Array.isArray(item)) {
            const rows = item.slice(0, 500).map(v => clean(v, depth + 1));
            if (item.length > 500) rows.push('[500개 이후 생략]');
            return rows;
        }
        const result = Object.create(null);
        for (const key of Object.keys(item).slice(0, 100)) {
            result[key] = SECRET.test(key) && !SAFE_TOKEN_COUNT.test(key) ? '[REDACTED]' : clean(item[key], depth + 1);
        }
        return result;
    }
    return clean(value, 0);
}

export function createSecondTranslationTrace({ binding = null, onUpdate } = {}) {
    const enabled = typeof onUpdate === 'function';
    const state = { version: 1, capturedAt: new Date().toISOString(), revision: 0,
        binding: cleanSecondTranslationDiagnostic(binding), events: [], omittedEvents: 0,
        limits: { textCharacters: TEXT_LIMIT, totalCharacters: TOTAL_LIMIT, events: EVENT_LIMIT },
        notice: '원문·1차 초안·2차 요청·응답·2차 결과가 포함됩니다. 민감값을 마스킹하며 생략 한도는 limits에 표시됩니다.' };
    let size = 0;
    return { enabled, add(kind, data) {
        if (!enabled) return;
        try {
            const event = { kind, at: new Date().toISOString(), data: cleanSecondTranslationDiagnostic(data) };
            const length = JSON.stringify(event).length;
            if (size + length > TOTAL_LIMIT || state.events.length >= EVENT_LIMIT) {
                state.omittedEvents++;
                // Preserve terminal outcome metadata even when text budget is full.
                state.lastOmittedKind = kind;
            } else { state.events.push(event); size += length; }
            state.lastKind = kind;
            if (['final-result', 'failed', 'cancelled'].includes(kind)) state.outcome = {
                kind, ...(data?.summary ? {summary: cleanSecondTranslationDiagnostic(data.summary)} : {})
            };
            state.revision++;
            onUpdate(structuredClone(state));
        } catch { /* Logging cannot affect requests, cancellation, or results. */ }
    } };
}

let attemptSequence = 0;
export function createSecondTranslationAttempt(options, profileSlot, prompt) {
    if (typeof options.onSecondTranslationWire !== 'function') return null;
    const attemptId = `${Date.now()}-${++attemptSequence}`;
    const emit = data => {
        try { options.onSecondTranslationWire({ attemptId, stage: options.stage, profileSlot,
            retryAttempt: Number(options.retryAttempt) || 0, segmentAttempt: Number(options.segmentAttempt) || 0,
            fallback: options.fallback === true, ...data }); } catch { /* diagnostic only */ }
    };
    return {
        request: () => emit({ boundary: 'connection-manager-input', messages: [{role: 'user', content: prompt}],
            note: '연결 관리자에 전달한 입력입니다. 브라우저에서는 프로필 적용 후 HTTP 본문을 관찰하지 않습니다.' }),
        provider: event => emit(event),
        response: text => emit({ boundary: 'assistant-text-before-segment-parser', text }),
        error: error => emit({ boundary: 'attempt-error', name: error?.name, message: String(error?.message || error) }),
    };
}
