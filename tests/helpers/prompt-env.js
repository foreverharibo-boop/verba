import { customTranslationDefaults } from '../../core.js';
// Extracted index.js functions need the same imported prompt-default provider
// as the real extension. Inject it without changing the assertions or globals.
export function promptTestFunction(...args) {
    return globalThis.Function('customTranslationDefaults', ...args).bind(null, customTranslationDefaults);
}
