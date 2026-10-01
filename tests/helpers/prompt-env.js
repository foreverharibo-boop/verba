import { POST_TRANSLATION_AI_REPAIR_ENABLED } from '../../minimal-output.js';
import { customTranslationDefaults } from '../../core.js';
import { normalizedServerRetryLimit } from '../../retry-policy.js';
// Extracted index.js functions need the same imported prompt-default provider
// as the real extension. Inject it without changing the assertions or globals.
export function promptTestFunction(...args) {
    return globalThis.Function('customTranslationDefaults', 'POST_TRANSLATION_AI_REPAIR_ENABLED', 'normalizedServerRetryLimit', ...args).bind(null, customTranslationDefaults, POST_TRANSLATION_AI_REPAIR_ENABLED, normalizedServerRetryLimit);
}
