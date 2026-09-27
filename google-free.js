const GOOGLE_FREE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const DEFAULT_MAX_ENCODED_CHARS = 4200;
const PROTECTED_TOKEN_PATTERN = /@@VERBA_(?:NAME_)?[A-Z0-9_]*\d{4}@@|@@VERBA_[A-Z0-9_]+@@/gu;

function abortError() {
    try {
        return new DOMException('번역이 취소되었습니다.', 'AbortError');
    } catch {
        const error = new Error('번역이 취소되었습니다.');
        error.name = 'AbortError';
        return error;
    }
}

function encodedLength(value) {
    return encodeURIComponent(String(value || '')).length;
}

function hardCutIndex(value, maxEncodedChars) {
    let index = 0;
    let size = 0;
    for (const character of String(value || '')) {
        const next = encodedLength(character);
        if (index > 0 && size + next > maxEncodedChars) break;
        size += next;
        index += character.length;
    }
    return Math.max(1, index);
}

function preferredCutIndex(value, hardLimit) {
    const prefix = value.slice(0, hardLimit);
    const candidates = [];
    for (const match of prefix.matchAll(/\s+/gu)) {
        const before = prefix.slice(0, match.index);
        const score = /\n\s*\n$/u.test(match[0])
            ? 4
            : /\n/u.test(match[0])
                ? 3
                : /[.!?。！？…]["'”’)}\]]*$/u.test(before)
                    ? 2
                    : 1;
        candidates.push({ index: match.index, score });
    }
    const usable = candidates.filter(candidate => candidate.index >= Math.floor(hardLimit * 0.38));
    if (!usable.length) return hardLimit;
    usable.sort((left, right) => right.score - left.score || right.index - left.index);
    return usable[0].index || hardLimit;
}

/**
 * Splits an arbitrary text into request-sized pieces. Whitespace at request
 * boundaries is kept as local passthrough data so Google cannot collapse the
 * source layout while translating separate chunks.
 */
export function splitGoogleFreeText(value, maxEncodedChars = DEFAULT_MAX_ENCODED_CHARS) {
    const text = String(value || '');
    const limit = Math.max(600, Number(maxEncodedChars) || DEFAULT_MAX_ENCODED_CHARS);
    const pieces = [];
    let remaining = text;

    while (remaining) {
        const leading = remaining.match(/^\s+/u)?.[0] || '';
        if (leading) {
            pieces.push({ text: leading, translate: false });
            remaining = remaining.slice(leading.length);
            continue;
        }
        if (!remaining) break;

        PROTECTED_TOKEN_PATTERN.lastIndex = 0;
        const protectedMatch = PROTECTED_TOKEN_PATTERN.exec(remaining);
        if (protectedMatch?.index === 0) {
            pieces.push({ text: protectedMatch[0], translate: false });
            remaining = remaining.slice(protectedMatch[0].length);
            continue;
        }

        const beforeProtected = protectedMatch?.index > 0
            ? remaining.slice(0, protectedMatch.index)
            : remaining;
        if (encodedLength(beforeProtected) <= limit) {
            pieces.push({ text: beforeProtected, translate: true });
            remaining = remaining.slice(beforeProtected.length);
            continue;
        }

        const hardLimit = hardCutIndex(beforeProtected, limit);
        const cutAt = preferredCutIndex(beforeProtected, hardLimit);
        const chunk = beforeProtected.slice(0, cutAt) || beforeProtected.slice(0, hardLimit);
        pieces.push({ text: chunk, translate: true });
        remaining = remaining.slice(chunk.length);
    }

    return pieces.filter(piece => piece.text);
}

export function parseGoogleFreeResponse(payload) {
    if (Array.isArray(payload?.sentences)) {
        return payload.sentences.map(sentence => String(sentence?.trans || '')).join('');
    }
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
        throw new Error('무료 Google 번역 응답 형식을 읽지 못했습니다.');
    }
    const translated = payload[0]
        .filter(Array.isArray)
        .map(row => String(row[0] ?? ''))
        .join('');
    if (!translated && payload[0].length) {
        throw new Error('무료 Google 번역 결과가 비어 있습니다.');
    }
    return translated;
}

async function translateGoogleFreeChunk(text, {
    sourceLanguage = 'auto',
    targetLanguage = 'ko',
    signal = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 45000,
} = {}) {
    if (signal?.aborted) throw signal.reason || abortError();
    if (typeof fetchImpl !== 'function') throw new Error('이 환경에서는 무료 Google 번역 요청을 보낼 수 없습니다.');

    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort(signal?.reason || abortError());
    signal?.addEventListener?.('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, Math.max(1000, Number(timeoutMs) || 45000));

    const url = new URL(GOOGLE_FREE_ENDPOINT);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', sourceLanguage || 'auto');
    url.searchParams.set('tl', targetLanguage || 'ko');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    try {
        const response = await fetchImpl(url.toString(), {
            method: 'GET',
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            headers: { Accept: 'application/json,text/plain,*/*' },
        });
        if (!response?.ok) {
            const status = Number(response?.status) || 0;
            throw new Error(`무료 Google 번역 요청 실패${status ? ` (HTTP ${status})` : ''}`);
        }
        return parseGoogleFreeResponse(await response.json());
    } catch (error) {
        if (signal?.aborted) throw signal.reason || abortError();
        if (timedOut) throw new Error('무료 Google 번역 응답 대기 시간이 초과되었습니다.');
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', forwardAbort);
    }
}

export async function translateGoogleFreeText(value, options = {}) {
    const pieces = splitGoogleFreeText(value, options.maxEncodedChars);
    let result = '';
    for (const piece of pieces) {
        if (options.signal?.aborted) throw options.signal.reason || abortError();
        result += piece.translate
            ? await translateGoogleFreeChunk(piece.text, options)
            : piece.text;
    }
    return result;
}

export async function translateGoogleFreeSegments(segments, options = {}) {
    const rows = Array.isArray(segments) ? segments : [];
    const concurrency = Math.max(1, Math.min(3, Number(options.concurrency) || 2));
    const result = new Map();
    let cursor = 0;

    const worker = async () => {
        while (cursor < rows.length) {
            const index = cursor;
            cursor += 1;
            const segment = rows[index];
            const translated = await translateGoogleFreeText(segment?.text || '', options);
            result.set(String(segment?.id || `seg_${index}`), translated);
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
    return result;
}

export const GOOGLE_FREE_LIMITS = Object.freeze({
    maxEncodedChars: DEFAULT_MAX_ENCODED_CHARS,
    concurrency: 2,
});
