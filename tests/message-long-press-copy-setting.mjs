import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

assert.match(index, /messageLongPressCopyEnabled:\s*true/);
assert.match(index, /settings\.messageLongPressCopyEnabled\s*=\s*settings\.messageLongPressCopyEnabled !== false/);
assert.match(index, /id="verba-message-long-press-copy-enabled"[\s\S]*?아웃풋 여백 길게 눌러 복사/);
assert.match(index, /function showMessageCopyMenu[\s\S]*?if \(settings\.messageLongPressCopyEnabled === false\) return;/);
assert.match(index, /function setupMessageCopyHold[\s\S]*?pointerdown[\s\S]*?if \(settings\.messageLongPressCopyEnabled === false\)/);
assert.match(index, /messageCopyHoldTimer = setTimeout[\s\S]*?if \(settings\.messageLongPressCopyEnabled === false\) return;/);
assert.match(index, /#verba-message-long-press-copy-enabled[\s\S]*?cancelMessageCopyHold\(\)[\s\S]*?\.verba-copy-modal/);

console.log('PASS: output blank-area long-press copy is enabled by default, user-toggleable, race-gated, and immediately cleaned up when disabled.');
