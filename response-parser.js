// Conservative JSON recovery: no eval, guessed quotes/positions, or invented text.
// Segment ID recovery changes only leading-zero padding, with unique correspondence.
function segmentNumberKey(id) {
    const match = typeof id === 'string' && /^seg_([0-9]+)$/.exec(id);
    return match ? match[1].replace(/^0+(?=\d)/, '') : null;
}

// Source paragraph separators live outside these segments. A single-line prose
// target cannot acquire line breaks, even after a sentence or quote. Never align
// multi-line translations by character offsets: rewording makes that ambiguous.
export function repairUnexpectedProseBreaks(translation, segment) {
    if (typeof translation !== 'string'
        || !['narration', 'dialogue_candidate', 'target_dialogue', 'other_dialogue', 'selection', 'multi_selection'].includes(segment?.type)
        || typeof segment.text !== 'string' || !segment.text.trim()
        || /[\r\n\u0085\u2028\u2029]/u.test(segment.text)
        || /[`<>]|~{3}/u.test(segment.text)) return translation;

    // Real markup/code belongs to protected or tagged-content paths. Only a
    // newly invented bare <br> in otherwise plain prose is treated as a break.
    const text = translation.replace(/<br\s*\/?\s*>/giu, '\n');
    if (/[`<>]|~{3}/u.test(text) || !/[\r\n\u0085\u2028\u2029]/u.test(text)) return translation;
    return text.replace(/[\t ]*(?:(?:\r\n|[\r\n\u0085\u2028\u2029])[\t ]*)+/gu,
        (gap, offset) => {
            const before = text[offset - 1] || '';
            const after = text[offset + gap.length] || '';
            if (!before || !after) return '';
            // Keep the previous repair for blank lines inserted inside Hangul
            // words (그러 + 셨어요). Horizontal spaces remain a word boundary.
            const breaks = gap.match(/\r\n|[\r\n\u0085\u2028\u2029]/gu) || [];
            if (breaks.length > 1 && !/[\t ]/u.test(gap) && /[가-힣]/u.test(before) && /[가-힣]/u.test(after)) return '';
            if (/[(\[“‘「『]/u.test(before) || /[.,!?;:…\)\]”’」』]/u.test(after)) return '';
            return ' ';
        });
}


// Keep pause positions in the translation, restoring only source glyphs/length.
// Equal occurrence counts are required: never guess missing or added pauses.
export function repairSourceEllipses(translation, segment) {
    const source = segment?.ellipsisSource ?? segment?.text;
    if (typeof translation !== 'string' || typeof source !== 'string'
        || !['narration', 'dialogue_candidate', 'target_dialogue', 'other_dialogue', 'selection', 'multi_selection'].includes(segment?.type)
        || /[\x60<>]|~{3}/u.test(source) || /[\x60<>]|~{3}/u.test(translation)) return translation;
    const pauses = text => {
        // Mask opaque tokens, macros, URLs and paths without changing offsets.
        const masked = text.replace(/@@[\s\S]*?@@|\{\{[\s\S]*?\}\}|\b(?:https?:\/\/|www\.)[^\s<>"']+|(?:\.\.[/\\])+\S*/gu,
            token => ' '.repeat(token.length));
        return [...masked.matchAll(/[.…]+/gu)].filter(match =>
            (match[0].includes('…') || match[0].length >= 2)
            && !/[0-9/\\]/u.test(masked[match.index - 1] || '')
            && !/[0-9/\\]/u.test(masked[match.index + match[0].length] || ''));
    };
    const expected = pauses(source), received = pauses(translation);
    if (!expected.length || expected.length !== received.length) return translation;
    let repaired = '', offset = 0;
    for (let i = 0; i < received.length; i += 1) {
        const current = received[i];
        repaired += translation.slice(offset, current.index) + expected[i][0];
        offset = current.index + current[0].length;
    }
    return repaired + translation.slice(offset);
}

// Exact mapped spans can use original-source punctuation. A partial span has
// no reliable sub-sentence alignment, so preserve its existing selected form.
export function selectionEllipsisReference(snapshot = {}) {
    const { selected, source, translation, start, end } = snapshot;
    if (start === 0 && typeof translation === 'string' && end === translation.length
        && typeof source === 'string' && source.trim()) return source;
    const rows = Array.isArray(snapshot.sourceMap) ? snapshot.sourceMap.filter(row =>
        Number.isFinite(row.start) && Number.isFinite(row.end) && row.start < row.end
        && start < row.end && end > row.start) : [];
    if (rows.length && rows.every(row => start <= row.start && end >= row.end && typeof row.source === 'string')) {
        return rows.slice().sort((a, b) => a.start - b.start).map(row => row.source).join('\n\n');
    }
    return selected;
}

function normalizeSyntax(text) {
    let result = '', quoted = false, escaped = false;
    const fixes = new Set();
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (escaped) { result += ch; escaped = false; continue; }
            if (ch === '\\') { result += ch; escaped = true; continue; }
            if (ch === '"') quoted = false;
            if (ch.charCodeAt(0) < 32) {
                result += JSON.stringify(ch).slice(1, -1);
                fixes.add('문자열 안의 줄바꿈·제어문자 이스케이프');
            } else result += ch;
        } else {
            if (ch === '"') quoted = true;
            let next = i + 1;
            if (ch === ',') while (next < text.length && /\s/.test(text[next])) next += 1;
            if (ch === ',' && (text[next] === '}' || text[next] === ']')) {
                fixes.add('닫는 괄호 앞 불필요한 쉼표 제거');
            } else result += ch;
        }
    }
    return { text: result, fixes: [...fixes] };
}

// Recover only complete row objects from an interrupted {"segments":[... response.
// Stop at the first damaged/incomplete row. Never search inside translation strings.
function completedRows(text) {
    const prefix = /^\s*\{\s*"segments"\s*:\s*\[/.exec(text);
    if (!prefix) return [];
    const rows = [];
    let pos = prefix[0].length;
    while (pos < text.length) {
        while (/\s/.test(text[pos] || '') && pos < text.length) pos += 1;
        if (pos === text.length) return rows;
        if (text[pos] === ']') return /^\s*}?\s*$/.test(text.slice(pos + 1)) ? rows : [];
        if (text[pos] !== '{') return [];
        const start = pos;
        let depth = 0, quoted = false, escaped = false;
        for (; pos < text.length; pos += 1) {
            const ch = text[pos];
            if (quoted) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') quoted = false;
            } else if (ch === '"') quoted = true;
            else if (ch === '{' || ch === '[') depth += 1;
            else if (ch === '}' || ch === ']') {
                depth -= 1;
                if (depth === 0) { pos += 1; break; }
            }
        }
        if (depth !== 0 || quoted) return rows;
        try { rows.push(JSON.parse(text.slice(start, pos))); } catch { return rows; }
        while (pos < text.length && /\s/.test(text[pos])) pos += 1;
        if (pos === text.length) return rows;
        if (text[pos] === ',') { pos += 1; continue; }
        if (text[pos] === ']') return /^\s*}?\s*$/.test(text.slice(pos + 1)) ? rows : [];
        return [];
    }
    return rows;
}

export function collectSegmentResponse(raw, expectedSegments = []) {
    const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const partial = new Map();
    const repairs = [];
    const issues = [];
    let rows = [], parsed = false, syntaxError;
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    const candidates = [cleaned];
    if (start >= 0 && end > start && (start !== 0 || end !== cleaned.length - 1)) candidates.push(cleaned.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate);
            parsed = true;
            if (Array.isArray(value?.segments)) rows = value.segments;
            else issues.push('segments 배열 없음');
            break;
        } catch (error) { syntaxError = error; }
    }
    if (!parsed) {
        for (const candidate of candidates) {
            const normalized = normalizeSyntax(candidate);
            if (!normalized.fixes.length) continue;
            try {
                const value = JSON.parse(normalized.text);
                if (!Array.isArray(value?.segments)) continue;
                rows = value.segments;
                repairs.push(...normalized.fixes);
                parsed = true;
                break;
            } catch { /* Try only the next bounded candidate. */ }
        }
    }
    if (!parsed) {
        // Keep the whole suffix: cutting at the last } can conceal a truncated row.
        const normalized = normalizeSyntax(start >= 0 ? cleaned.slice(start) : cleaned);
        rows = completedRows(normalized.text);
        if (rows.length) repairs.push(...normalized.fixes, '완성된 구간만 추출');
        issues.push('JSON 문법 오류·응답 잘림');
    }
    const expected = new Set(expectedSegments.map(segment => segment.id));
    const conflicts = new Set();
    const expectedNumbers = new Map(), responseNumbers = new Map();
    for (const id of expected) {
        const key = segmentNumberKey(id);
        if (key === null) continue;
        if (!expectedNumbers.has(key)) expectedNumbers.set(key, []);
        expectedNumbers.get(key).push(id);
    }
    for (const row of rows) {
        const key = segmentNumberKey(row?.id);
        if (key === null) continue;
        if (!responseNumbers.has(key)) responseNumbers.set(key, []);
        responseNumbers.get(key).push(row.id);
    }
    // An exact ID plus a padding variant is ambiguous too: request this target again.
    for (const [key, ids] of responseNumbers) {
        const targets = expectedNumbers.get(key);
        if (targets?.length === 1 && ids.length > 1 && ids.some(id => id !== targets[0])) {
            conflicts.add(targets[0]);
            issues.push('앞자리 0 보정 대상 구간 ID 중복');
        }
    }
    for (const row of rows) {
        if (!row || typeof row.id !== 'string') continue;
        let id = row.id;
        if (!expected.has(id)) {
            const key = segmentNumberKey(id);
            const targets = expectedNumbers.get(key);
            if (targets?.length !== 1 || responseNumbers.get(key)?.length !== 1) continue;
            id = targets[0];
        }
        if (typeof row.translation !== 'string' || !row.translation.trim()) {
            issues.push('비어 있거나 문자열이 아닌 번역');
            continue;
        }
        if (partial.has(id) && partial.get(id) !== row.translation) conflicts.add(id);
        else partial.set(id, row.translation);
        if (id !== row.id) repairs.push(`구간 ID 앞자리 0 보정: ${row.id} → ${id}`);
    }
    for (const id of conflicts) partial.delete(id);
    if (conflicts.size) issues.push('동일 구간 ID의 서로 다른 번역');
    for (const segment of expectedSegments) {
        const original = partial.get(segment.id);
        if (typeof original !== 'string') continue;
        const repaired = repairUnexpectedProseBreaks(original, segment);
        if (repaired !== original) {
            partial.set(segment.id, repaired);
            repairs.push(`원문 한 줄 구간의 추가 줄바꿈 제거: ${segment.id}`);
        }
    }
    for (const segment of expectedSegments) {
        const original = partial.get(segment.id);
        const repaired = repairSourceEllipses(original, segment);
        if (repaired !== original) {
            partial.set(segment.id, repaired);
            repairs.push('원문 말줄임표 문자·길이 복구: ' + segment.id);
        }
    }
    const missingIds = [...expected].filter(id => !partial.has(id));
    if (missingIds.length) issues.push('요청 구간 누락·불일치');
    const parseError = missingIds.length ? new Error(
        `${[...new Set(issues)].join(' / ')}; 번역 결과 누락: ${missingIds.join(', ')}`,
        syntaxError ? { cause: syntaxError } : undefined,
    ) : null;
    if (parseError) parseError.code = 'VERBA_RESPONSE_FORMAT';
    return { partial, parseError, missingIds, repairs: [...new Set(repairs)], issues: [...new Set(issues)] };
}
