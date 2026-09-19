import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const index = fs.readFileSync(new URL('index.js', root), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));

delete globalThis.__verbaTranslationPairCoordinatorV1;
const first = await import(new URL(`pair-coordinator.js?first=${Date.now()}`, root));
const second = await import(new URL(`pair-coordinator.js?second=${Date.now()}`, root));

assert.equal(first.registerTranslationExtension('verba-deep'), 'verba-deep');
assert.equal(first.currentTranslationExtensionOwner(), 'verba-deep');
assert.equal(second.registerTranslationExtension('verba'), 'verba');
assert.equal(first.currentTranslationExtensionOwner(), 'verba');
assert.equal(first.isTranslationExtensionActive('verba'), true);
assert.equal(first.isTranslationExtensionActive('verba-deep'), false);

second.activateTranslationExtension('verba-deep');
assert.equal(first.currentTranslationExtensionOwner(), 'verba-deep');
assert.equal(first.isTranslationExtensionActive('verba'), false);
assert.equal(second.isTranslationExtensionActive('verba-deep'), true);

first.activateTranslationExtension('verba');
assert.equal(second.currentTranslationExtensionOwner(), 'verba');
assert.equal(second.isTranslationExtensionActive('verba'), true);
assert.equal(second.isTranslationExtensionActive('verba-deep'), false);

// The public package name changed, but the runtime coordination key stays
// legacy-compatible so existing settings and the peer extension still work.
const ownKey = 'verba-deep';
const peerStateKey = ownKey === 'verba'
    ? 'verba_deep_current_translation'
    : 'verba_current_translation';
const pairAbortCode = ownKey === 'verba' ? 'VERBA_PAIR_INACTIVE' : 'VERBA_DEEP_PAIR_INACTIVE';

assert.ok(index.includes("from './pair-coordinator.js';"));
assert.ok(index.includes(`const EXTENSION_KEY = '${ownKey}';`));
assert.ok(index.includes(`const PEER_STATE_KEY = '${peerStateKey}';`));
assert.ok(index.includes('peerRecord.translation === displayText'));
assert.ok(index.includes("status: 'pair-inactive'"));
assert.ok(index.includes('claimPairOwner: !options.automatic'));
assert.ok(index.includes(`'${pairAbortCode}'`));
assert.match(index, /if \(options\.automatic\) \{\s*if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);
assert.match(index, /function scheduleAutomaticTranslation[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);
assert.match(index, /function restoreSavedTranslationsAfterChatOpen[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);
assert.match(index, /function setupAutoInput[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);
assert.match(index, /const translated = await translateInputText\(source,[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);
assert.match(index, /function currentSelectionRecord[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return null;/);
assert.match(index, /function setupMessageCopyHold[\s\S]*?if \(!isTranslationExtensionActive\(EXTENSION_KEY\)\) return;/);

console.log(`PASS: ${ownKey} shares one display owner, defaults to Verba, switches manually, rejects peer display adoption, and gates automatic input/output work.`);
