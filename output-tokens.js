export const DEFAULT_TRANSLATION_MAX_TOKENS = 15000;

export function normalizedTranslationMaxTokens(value) {
    const tokens = Math.floor(Number(value));
    return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : DEFAULT_TRANSLATION_MAX_TOKENS;
}
