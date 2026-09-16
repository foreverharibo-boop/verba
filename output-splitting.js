// Splitting changes scheduling only; prompt selection remains independent.
export function outputSplitCount(settings = {}) {
    const count = Number(settings.developerOutputSplitCount);
    return [2, 3].includes(count) ? count : 1;
}

// Keep complete targets in contiguous groups. Prefer nearby paragraph breaks.
export function splitOutputSegments(segmented, requestedCount = 1) {
    const segments = segmented.segments;
    if (!segments.length) return [];
    const count = Math.min(segments.length, [2, 3].includes(requestedCount) ? requestedCount : 1);
    if (count === 1) return [segments];
    const paragraphStarts = new Set();
    let gap = '';
    for (const part of segmented.parts || []) {
        if (part.id) {
            if (/\n[ \t\r]*\n/.test(gap)) paragraphStarts.add(part.id);
            gap = '';
        } else gap += part.text || '';
    }
    const prefix = [0];
    for (const segment of segments) prefix.push(prefix.at(-1) + segment.text.length + 40);
    const batches = [];
    let start = 0;
    for (let remaining = count; remaining > 1; remaining--) {
        const target = (prefix.at(-1) - prefix[start]) / remaining;
        const boundaries = [];
        for (let i = start + 1; i <= segments.length - remaining + 1; i++) {
            const weight = prefix[i] - prefix[start];
            boundaries.push({ index: i, distance: Math.abs(target - weight),
                paragraph: paragraphStarts.has(segments[i].id) && weight >= target / 2 && weight <= target * 1.5 });
        }
        const paragraphs = boundaries.filter(boundary => boundary.paragraph);
        const candidates = paragraphs.length ? paragraphs : boundaries;
        const best = candidates.reduce((a, b) => b.distance < a.distance ? b : a);
        batches.push(segments.slice(start, best.index));
        start = best.index;
    }
    batches.push(segments.slice(start));
    return batches;
}

export async function runOutputBatches(segmented, count, options, worker) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (options.signal?.aborted) forwardAbort();
    try {
        controller.signal.throwIfAborted();
        const batches = splitOutputSegments(segmented, count);
        const jobs = batches.map(async (segments, index) => {
            controller.signal.throwIfAborted();
            return worker(segments, {
                ...options,
                signal: controller.signal,
                splitRequest: batches.length > 1,
                parallelRequest: batches.length > 1,
                splitBatchIndex: index + 1,
                splitBatchCount: batches.length,
            });
        });
        let results;
        try {
            results = await Promise.all(jobs);
        } catch (error) {
            controller.abort();
            await Promise.allSettled(jobs);
            throw error;
        }
        controller.signal.throwIfAborted();
        return new Map(results.flatMap(result => [...result]));
    } finally {
        options.signal?.removeEventListener('abort', forwardAbort);
    }
}

// A separate, bounded queue leaves the existing non-split scheduler unchanged.
// Cancelled queued tasks are rejected by sendProfileRequest before transmission.
export function createSplitRequestQueue(limit = 3) {
    let active = 0;
    const queue = [];
    const drain = () => {
        while (active < limit && queue.length) {
            const item = queue.shift();
            active++;
            Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
                active--;
                drain();
            });
        }
    };
    return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain(); });
}
