import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizedTranslationMaxTokens } from '../output-tokens.js';
const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const prefix = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url))).name;
test('positive whole tokens normalize without imposing a model-specific maximum', () => {
    for (const value of [undefined, null, '', 'bad', 0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(normalizedTranslationMaxTokens(value), 15000);
    assert.equal(normalizedTranslationMaxTokens('32000'), 32000);
    assert.equal(normalizedTranslationMaxTokens(50000.9), 50000);
});
test('token input appears after profile C and before retries and persists normalized changes', () => {
    const after = source.indexOf(`id="${prefix}-third-profile"`);
    const input = source.indexOf(`id="${prefix}-max-tokens"`);
    const before = source.indexOf(`id="${prefix}-server-retry-limit"`);
    assert.ok(after < input && input < before);
    const start = source.indexOf('    const maxTokensInput =');
    const end = source.indexOf('    const serverRetryLimitInput =', start);
    const settings = {};let handler, saved = 0;
    const panel = { querySelector: id => { assert.equal(id, `#${prefix}-max-tokens`);return { addEventListener: (name, fn) => { assert.equal(name, 'change');handler = fn; } }; } };
    Function('panel', 'settings', 'normalizedTranslationMaxTokens', 'saveSettings', source.slice(start, end))(panel, settings, normalizedTranslationMaxTokens, () => saved++);
    const event = {target: {value: '32000'}};handler(event);assert.equal(settings.maxTokens, 32000);assert.equal(event.target.value, '32000');
    event.target.value = '';handler(event);assert.equal(settings.maxTokens, 15000);assert.equal(event.target.value, '15000');assert.equal(saved, 2);
});
