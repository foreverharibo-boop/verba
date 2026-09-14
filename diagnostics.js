// Diagnostics only: never changes a request, retry policy, or translation text.
const requestEvidence = new WeakMap();
const LIMIT = 10000;

export function sanitizeDebugValue(value, limit = 6000) {
    const text = String(value ?? '')
        .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/(["']?(?:[\w-]*(?:api[-_ ]?key|token|secret|password)|authorization|cookie|set-cookie)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, '$1[REDACTED]')
        .replace(/([?&](?:key|api_key|access_token|auth|signature|sig)=)[^&#\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_KEY]')
        .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
    return text.length > limit ? `${text.slice(0, limit)}…[생략]` : text;
}

export function debugRawText(value, limit = LIMIT) {
    const seen = new WeakSet();
    let budget = 240;
    function clean(item, depth = 0) {
        if (--budget < 0 || depth > 7) return '[생략]';
        if (typeof item === 'string') return sanitizeDebugValue(item, limit);
        if (item == null || typeof item === 'number' || typeof item === 'boolean') return item;
        if (typeof item !== 'object') return String(item);
        if (seen.has(item)) return '[순환 참조]';
        seen.add(item);
        if (Array.isArray(item)) return item.slice(0, 24).map(v => clean(v, depth + 1));
        const result = Object.create(null);
        for (const key of Object.keys(item).slice(0, 60)) {
            if (/(?:key|token|secret|password|authorization|cookie|credential)/i.test(key)) {
                result[key] = '[REDACTED]';
            } else if (/^(?:config|request|prompt|messages|input|system|headers)$/i.test(key)) {
                result[key] = '[요청·설정 제외]';
            } else {
                try { result[key] = clean(item[key], depth + 1); }
                catch { result[key] = '[읽기 실패]'; }
            }
        }
        return result;
    }
    try {
        return sanitizeDebugValue(typeof value === 'string' ? value : JSON.stringify(clean(value)), limit);
    } catch { return '[원본 오류 직렬화 실패]'; }
}

export function rememberRequestError(error, context = {}, response = undefined) {
    const result = error && typeof error === 'object' ? error : new Error(String(error || '알 수 없는 오류'));
    const received = response ?? result.response?.data ?? result.response ?? result.data ?? result.body
        ?? (result.error === undefined ? undefined : { error: result.error });
    requestEvidence.set(result, {
        stage: sanitizeDebugValue(context.stage || 'request', 160),
        profileSlot: sanitizeDebugValue(context.profileSlot || '', 20),
        retryAttempt: Number(context.retryAttempt) || 0,
        httpStatus: Number(received?.status ?? received?.statusCode ?? received?.error?.code) || null,
        rawResponse: received === undefined ? '' : debugRawText(received),
        availability: received === undefined ? '연결 관리자가 원본 응답 본문을 전달하지 않았습니다.' : '브라우저가 받은 응답 (민감값 마스킹·길이 제한)',
    });
    return result;
}

// A rejected fetch Response can be read without consuming the original body.
// Keep the diagnostic read bounded so it cannot hold up cancellation/retries.
export async function readErrorResponse(error) {
    const response = error?.response ?? error;
    if (typeof response?.clone !== 'function') return undefined;
    let reader;
    let timer;
    try {
        const copy = response.clone();
        reader = copy.body?.getReader?.();
        if (!reader) return undefined;
        const read = async () => {
            const decoder = new TextDecoder();
            let text = '';
            while (text.length < LIMIT) {
                const part = await reader.read();
                if (part.done) return text + decoder.decode();
                text += decoder.decode(part.value, { stream: true });
            }
            return text.slice(0, LIMIT) + '…[생략]';
        };
        return await Promise.race([read(), new Promise(resolve => {
            timer = setTimeout(() => resolve(undefined), 200);
        })]);
    } catch { return undefined; }
    finally {
        clearTimeout(timer);
        try { reader?.cancel()?.catch?.(() => {}); } catch { /* best effort */ }
    }
}

export function debugErrorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current) && chain.length < 6) {
        seen.add(current);
        chain.push({
            name: sanitizeDebugValue(current.name || '', 120),
            message: sanitizeDebugValue(current.message || String(current), 2200),
            code: sanitizeDebugValue(current.code || '', 200),
            status: sanitizeDebugValue(current.status ?? current.statusCode ?? current.response?.status ?? '', 120),
            statusText: sanitizeDebugValue(current.statusText || current.response?.statusText || '', 300),
            details: debugRawText(current.details ?? current.response?.data ?? current.data ?? '', 3000),
            stack: sanitizeDebugValue(current.stack || '', 4500),
            request: requestEvidence.get(current) || null,
        });
        current = current.cause;
    }
    return chain;
}

export function classifyDebugError(chain, displayMessage = '') {
    const text = chain.map(item => [item.message, item.code, item.details, item.request?.rawResponse].join(' ')).join(' ') + ' ' + displayMessage;
    const statuses = chain.flatMap(item => [Number(item.status), Number(item.request?.httpStatus)]).filter(value => value >= 400 && value <= 599);
    // Some connection managers preserve HTTP status only in the error message.
    const statusMatch = text.match(/(?:HTTP(?:\/[\d.]+)?|status(?:\s*code)?|상태)\s*["':= ]+([45]\d\d)\b/i);
    const status = statuses.at(-1) || Number(statusMatch?.[1]) || null;
    const result = (category, evidence) => ({ category, evidence, httpStatus: status });
    if (chain.some(item => /VERBA_TIMEOUT|ETIMEDOUT|TIMEOUT/i.test(item.code)) || /timed?\s*out|시간.*초과/i.test(text)) return result('시간 초과', '응답 대기 제한 초과');
    if (status === 429) return result('요청 한도·할당량 오류', 'HTTP 429');
    if (status >= 500) return result('서버 오류', `HTTP ${status} (상위 제공자/프록시의 구분은 원본 참조)`);
    if (/\b(?:content_filter|content_policy_violation|PROHIBITED_CONTENT)\b|["']?(?:blockReason|finishReason|finish_reason)["']?\s*[:=]\s*["']?(?:SAFETY|BLOCKLIST|RECITATION)\b|blocked (?:by|due to) (?:the )?safety/i.test(text)) return result('안전 필터·정책 차단', '응답에 명시된 차단 사유');
    if (status === 401 || status === 403) return result('인증·권한 오류', `HTTP ${status}; 이 상태 코드만으로 검열 여부는 알 수 없음`);
    if (status) return result('서버 요청 오류', `HTTP ${status}`);
    if (/Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED|ENOTFOUND|network request failed|Load failed/i.test(text)) return result('네트워크·연결 오류', '브라우저/연결 관리자의 통신 실패 메시지');
    if (chain.some(item => item.code === 'VERBA_RESPONSE_EMPTY')) return result('AI 빈 응답', '차단 원인은 확인되지 않음');
    if (chain.some(item => item.code === 'VERBA_RESPONSE_FORMAT')) return result('AI 응답 형식·누락 오류', '결과 해석 또는 필수 구간 확인 실패');
    if (chain.some(item => /^(?:ReferenceError|TypeError|RangeError|SyntaxError)$/.test(item.name) && !item.request)) return result('베르바 실행 오류 의심', 'JavaScript 예외; stage·stack에서 발생 위치 확인');
    return result('원인 미확정', '전달된 정보만으로 서버·모델·확장 원인을 단정할 수 없음');
}

// Bounded snapshots of only failing segments; never mutate source or translations.
export function protectedRecoverySnapshot(invalid, segmented, translations) {
    const entries = new Map([...(segmented.tokens || []), ...(segmented.nameTokens || [])].map(row => [row.token, row]));
    const counts = text => {
        const result = new Map();
        for (const mark of String(text || '').match(/@@VERBA_(?:NAME_)?\d{4}@@/g) || []) result.set(mark, (result.get(mark) || 0) + 1);
        return result;
    };
    const rows = invalid.slice(0, 12).map(segment => {
        const before = String(segment.text || '');
        const received = String(translations.get(segment.id) || '');
        const expected = counts(before), actual = counts(received);
        const marks = [...new Set([...expected.keys(), ...actual.keys()])];
        const text = (value, limit) => sanitizeDebugValue(value, limit);
        return {
            segmentId: text(segment.id, 160), type: text(segment.type, 80),
            sourceWithMarkers: text(before, 1800), translationBeforeRepair: text(received, 1800),
            sourceCharacters: before.length, translationCharacters: received.length,
            textLimit: 1800,
            omittedMarks: Math.max(0, marks.length - 100),
            marks: marks.slice(0, 100).map(mark => {
                const entry = entries.get(mark);
                const wanted = expected.get(mark) || 0, got = actual.get(mark) || 0;
                return {
                    marker: mark, kind: mark.includes('_NAME_') ? '이름·호칭 고정' : '구조·코드 보호',
                    expected: wanted, actual: got, missing: Math.max(0, wanted - got), excess: Math.max(0, got - wanted),
                    sourceValue: text(entry?.source ?? entry?.value ?? '(등록되지 않은 표식)', 500),
                    restoredValue: text(entry?.value ?? '(등록되지 않은 표식)', 500),
                };
            }),
        };
    });
    return { problemSegmentCount: invalid.length, omittedSegments: Math.max(0, invalid.length - rows.length), segments: rows };
}
