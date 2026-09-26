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
const namespaceSources = sources.replace("const PEER_STATE_KEY = 'verba_deep_current_translation';", '');
assert.equal(manifest.name, 'verba');
assert.equal(manifest.display_name, '베르바');
assert.equal(manifest.version, '0.6.10');
assert.ok(index.includes("const EXTENSION_KEY = 'verba';"));
assert.ok(index.includes("const STATE_KEY = 'verba_current_translation';"));
assert.ok(index.includes("const SOURCE_VIEW_KEY = 'verba_source_view';"));
assert.ok(index.includes("const CHARACTER_FIELD_KEY = 'verba';"));
assert.ok(index.includes("name: 'verba'"));
assert.ok(index.includes("name: 'verba-profile'"));
assert.ok(index.includes('globalThis.__verbaTranslatorVersion'));
assert.doesNotMatch(namespaceSources, /verba-deep|verba_deep|VERBA_DEEP|__verbaDeep|베에르으바아/);

console.log('PASS: 베르바 uses its expected extension, DOM, storage, command, token, and global namespaces.');
