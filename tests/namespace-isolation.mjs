import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const index = read('index.js');
const style = read('style.css');
const sources = [
    index,
    style,
    read('base-editor.js'),
    read('core.js'),
    read('diagnostics.js'),
    read('minimal-output.js'),
    read('output-splitting.js'),
    read('prompt-editor.js'),
    read('response-parser.js'),
    read('timing.js'),
].join('\n');
const namespaceSources = sources.replace("const PEER_STATE_KEY = 'verba_current_translation';", '');

assert.equal(manifest.name, 'ginrba-lab');
assert.equal(manifest.display_name, '긴르바 실험실');
assert.equal(manifest.version, '0.5.126');
assert.ok(index.includes("const EXTENSION_KEY = 'verba-deep';"));
assert.ok(index.includes("const STATE_KEY = 'verba_deep_current_translation';"));
assert.ok(index.includes("const SOURCE_VIEW_KEY = 'verba_deep_source_view';"));
assert.ok(index.includes("const CHARACTER_FIELD_KEY = 'verba-deep';"));
assert.ok(index.includes("name: 'verba-deep'"));
assert.ok(index.includes("name: 'verba-deep-profile'"));
assert.ok(index.includes('globalThis.__verbaDeepTranslatorVersion'));

assert.doesNotMatch(namespaceSources, new RegExp('(?:#|\\.|--)' + 'verba-' + '(?!deep-)'));
assert.doesNotMatch(namespaceSources, new RegExp('data-' + 'verba-' + '(?!deep-)'));
assert.doesNotMatch(namespaceSources, new RegExp('VERBA' + '_(?!DEEP_)'));
assert.doesNotMatch(namespaceSources, new RegExp('\\bverba' + '_(?!deep_)'));
assert.doesNotMatch(namespaceSources, new RegExp('__verba' + '(?:Cleanup|TranslatorVersion)'));
assert.doesNotMatch(namespaceSources, new RegExp('베' + '르바'));

console.log('PASS: 긴르바 실험실 keeps its legacy verba-deep technical namespace for saved-setting compatibility.');
