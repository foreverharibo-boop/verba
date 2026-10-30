// Structural diagnostics only: never serialize source, prompts, or responses.
// Each trace belongs to one output request, including split/batched requests.
const STAGES = new Set(['initial-parsed', 'tag-normalization', 'repairs', 'dialogue-format', 'english-review', 'bilingual-review', 'markup-integrity', 'assembled', 'received', 'locked-segments', 'display-normalization']);
const TYPES = new Set(['narration', 'dialogue_candidate', 'tagged_content', 'code_content']);
const METRICS = ['length', 'latinLetters', 'hangulLetters', 'mixedLines', 'koreanBracketPairs', 'duplicateKoreanPairs'];
const MAX_ROWS = 32;
const number = value => Number.isFinite(value) ? Math.min(10000000, Math.max(0, Math.floor(value))) : 0;
const withoutTokens = value => String(value ?? '').replace(/@@VERBA_(?:[A-Z]+_)*\d+@@/gu, '');
const koreanKey = value => value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/gu, '');

export function summarizeOutputText(value) {
    const text = withoutTokens(value);
    let koreanBracketPairs = 0, duplicateKoreanPairs = 0;
    // A hint for the reported "Korean [Korean]" shape, not a semantic verdict.
    for (const line of text.split(/\r?\n/u)) {
        for (const match of line.matchAll(/([^\[\]\n]+)\[([^\[\]\n]+)\]/gu)) {
            const left = koreanKey(match[1]), right = koreanKey(match[2]);
            if (/[가-힣]/u.test(left) && /[가-힣]/u.test(right) && !/[A-Za-z]/u.test(left + right)) {
                koreanBracketPairs++;
                if (left === right) duplicateKoreanPairs++;
            }
        }
    }
    return {
        length: text.length,
        latinLetters: (text.match(/[A-Za-z]/gu) || []).length,
        hangulLetters: (text.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/gu) || []).length,
        mixedLines: text.split(/\r?\n/u).filter(line => /[A-Za-z]/u.test(line) && /[가-힣]/u.test(line)).length,
        koreanBracketPairs,
        duplicateKoreanPairs,
    };
}

function cleanBilingualReview(value) {
    return { checked: number(value?.checked), changed: number(value?.changed),
        rejected: number(value?.rejected), skipped: number(value?.skipped),
        status: ['not-needed', 'completed', 'failed', 'limit'].includes(value?.status) ? value.status : 'not-needed' };
}
function cleanMetrics(value) {
    return Object.fromEntries(METRICS.map(key => [key, number(value?.[key])]));
}
function cleanStage(value) {
    return {
        stage: value.stage,
        totals: cleanMetrics(value.totals),
        comparedRows: number(value.comparedRows),
        changedRows: number(value.changedRows),
        lostLatinRows: number(value.lostLatinRows),
        newDuplicateRows: number(value.newDuplicateRows),
        rowsOmitted: number(value.rowsOmitted),
        rows: (Array.isArray(value.rows) ? value.rows : []).slice(0, MAX_ROWS).map(row => ({
            index: number(row.index),
            type: TYPES.has(row.type) ? row.type : 'unknown',
            codeKind: ['inline', 'fenced'].includes(row.codeKind) ? row.codeKind : '',
            changed: row.changed === true,
            sourceHasLatin: row.sourceHasLatin === true,
            exactSourcePresent: row.exactSourcePresent === true,
            ...cleanMetrics(row),
        })),
    };
}

// Whitelist even local/server reports so a provider cannot inject text into logs.
export function sanitizeOutputComparison(value, { summaryOnly = false } = {}) {
    if (value?.version !== 1) return null;
    const stages = (Array.isArray(value.stages) ? value.stages : []).filter(row => STAGES.has(row?.stage)).slice(0, 12).map(cleanStage);
    if (summaryOnly) for (const stage of stages) {
        stage.rowsOmitted += stage.rows.length;
        stage.rows = [];
    }
    return {
        version: 1,
        contentIncluded: false,
        ...(value.bilingualReview ? { bilingualReview: cleanBilingualReview(value.bilingualReview) } : {}),
        firstResponseMeaning: 'first-successfully-parsed-value-per-segment',
        limitation: 'Counts are hints, not proof of bilingual correctness. First means first parsed value per segment, possibly after a parse retry. Assembled totals include restored markup/code. Rendering and user regex are not inspected.',
        segmentCount: number(value.segmentCount),
        initialResponseBatches: number(value.initialResponseBatches),
        parseRetryResponses: number(value.parseRetryResponses),
        firstDuplicateHintStage: stages.find(stage => stage.totals.duplicateKoreanPairs > 0)?.stage || null,
        firstLatinLossStage: stages.find(stage => stage.lostLatinRows > 0)?.stage || null,
        stages,
    };
}

export function createOutputComparison(segmented, enabled) {
    const segments = segmented?.segments || [];
    const initial = new Map();
    let previous = new Map();
    const report = { version: 1, segmentCount: segments.length, initialResponseBatches: 0, parseRetryResponses: 0, stages: [] };
    function capture(stage, values) {
        if (!enabled || !STAGES.has(stage)) return;
        const totals = cleanMetrics({});
        let comparedRows = 0, changedRows = 0, lostLatinRows = 0, newDuplicateRows = 0;
        const rows = [];
        for (const [index, segment] of segments.entries()) {
            if (!values.has(segment.id)) continue;
            const text = String(values.get(segment.id) ?? '');
            const metrics = summarizeOutputText(text);
            const hadPrevious = previous.has(segment.id);
            const before = hadPrevious ? summarizeOutputText(previous.get(segment.id)) : null;
            const changed = hadPrevious && text !== previous.get(segment.id);
            comparedRows += Number(hadPrevious);
            changedRows += Number(changed);
            lostLatinRows += Number(!!before?.latinLetters && !metrics.latinLetters);
            newDuplicateRows += Number(!!before && metrics.duplicateKoreanPairs > before.duplicateKoreanPairs);
            for (const key of METRICS) totals[key] += metrics[key];
            const source = withoutTokens(segment.text).trim();
            rows.push({ index, type: segment.type, codeKind: segment.codeKind || '', changed,
                sourceHasLatin: /[A-Za-z]/u.test(source),
                exactSourcePresent: !!source && withoutTokens(text).includes(source), ...metrics });
        }
        // Prioritize suspicious/changed rows when a long message exceeds the cap.
        rows.sort((a, b) => Number(b.duplicateKoreanPairs > 0) - Number(a.duplicateKoreanPairs > 0) || Number(b.changed) - Number(a.changed) || a.index - b.index);
        report.stages.push({ stage, totals, comparedRows, changedRows, lostLatinRows, newDuplicateRows,
            rowsOmitted: Math.max(0, rows.length - MAX_ROWS), rows: rows.slice(0, MAX_ROWS) });
        previous = new Map(values);
    }
    return {
        // Called only by the initial translation requests, never a repair request.
        response(partial, attempt = 0) {
            if (!enabled) return;
            report.initialResponseBatches++;
            report.parseRetryResponses += Number(attempt > 0);
            for (const [id, text] of partial) if (!initial.has(id)) initial.set(id, text);
        },
        initial(values) {
            if (!enabled) return;
            for (const [id, text] of values) if (!initial.has(id)) initial.set(id, text);
            capture('initial-parsed', initial);
        },
        capture,
        bilingualReview(result) {
            if (enabled) report.bilingualReview = cleanBilingualReview(result);
        },
        finish(translation) {
            if (!enabled) return null;
            const safe = sanitizeOutputComparison(report);
            safe.stages.push(cleanStage({ stage: 'assembled', totals: summarizeOutputText(translation), rows: [] }));
            return sanitizeOutputComparison(safe);
        },
    };
}

export function appendOutputComparison(value, stage, before, after) {
    const report = sanitizeOutputComparison(value);
    if (!report || !STAGES.has(stage)) return report;
    const a = summarizeOutputText(before), b = summarizeOutputText(after);
    const comparable = typeof before === 'string';
    report.stages.push(cleanStage({ stage, totals: b, comparedRows: Number(comparable),
        changedRows: Number(comparable && before !== after), lostLatinRows: Number(!!a.latinLetters && !b.latinLetters),
        newDuplicateRows: Number(b.duplicateKoreanPairs > a.duplicateKoreanPairs), rows: [] }));
    return sanitizeOutputComparison(report);
}

// In-memory only. A different chat object, swipe, or source cannot reuse a trace.
export function createOutputComparisonStore() {
    const records = new WeakMap();
    return {
        set(message, sourceHash, swipeId, comparison) {
            const safe = sanitizeOutputComparison(comparison);
            if (safe) records.set(message, { sourceHash, swipeId, capturedAt: new Date().toISOString(), ...safe });
            else records.delete(message);
        },
        get(message, sourceHash, swipeId) {
            const record = message && records.get(message);
            return record?.sourceHash === sourceHash && record?.swipeId === swipeId ? record : null;
        },
    };
}
