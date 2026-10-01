// Local request policy; this module never sends a request or changes ST globals.
export function normalizedServerRetryLimit(value = 5) {
    if (value === null || String(value).trim() === '') return 5;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 5;
    const integer = number === 0 ? 0 : Math.max(1, Math.floor(number));
    return Number.isSafeInteger(integer) ? integer : 5;
}

export function serverRetryBackoffMs(attempt, random = Math.random) {
    const delays = [3000, 5000, 8000, 12000, 20000];
    const base = delays[Math.min(delays.length - 1, Math.max(0, Math.floor(attempt)))];
    // Small jitter keeps even unlimited retries from synchronizing at the cap.
    // Every fallback delay stays at or below 20 seconds.
    return Math.round(base * (0.95 + Math.max(0, Math.min(1, random())) * 0.05));
}

export function googleRetryHintSeconds(error) {
    const details = error?.error?.details ?? error?.details ?? error?.response?.data?.error?.details;
    if (!Array.isArray(details)) return null;
    const info = details.find(detail => String(detail?.['@type'] || '').endsWith('/google.rpc.RetryInfo'));
    const duration = info?.retryDelay;
    if (typeof duration === 'string' && /^\d+(?:\.\d+)?s$/.test(duration)) return Number(duration.slice(0, -1));
    if (duration && typeof duration === 'object') {
        const seconds = Number(duration.seconds ?? 0) + Number(duration.nanos ?? 0) / 1e9;
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    }
    return null;
}
