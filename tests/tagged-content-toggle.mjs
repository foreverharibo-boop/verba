import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assembleTranslation, segmentSource } from '../core.js';

const source = '<Info_panel>[Weather: Sunny]</Info_panel> Outside text.';
assert.equal(segmentSource(source, [], { translateTaggedContent: true }).segments.some(row => row.type === 'tagged_content'), true);

const disabled = segmentSource(source, [], { translateTaggedContent: false });
assert.equal(disabled.segments.some(row => row.type === 'tagged_content'), false);
assert.equal(disabled.segments.length, 1);
const translated = new Map(disabled.segments.map(row => [row.id, row.text.replace('Outside text.', '바깥 본문.') ]));
assert.equal(assembleTranslation(disabled, translated), '<Info_panel>[Weather: Sunny]</Info_panel> 바깥 본문.');

const tagOnly = segmentSource('<status>Hello.</status>', [], { translateTaggedContent: false });
assert.equal(tagOnly.segments.length, 0);
assert.equal(assembleTranslation(tagOnly, new Map()), '<status>Hello.</status>');

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert.match(index, /translateTaggedContent:\s*true/);
assert.match(index, /segmentSource\(source, characterNameLocks, segmentationOptions\)/);
assert.match(index, /id="verba-deep-translate-tagged-content"/);
assert.match(index, /data-verba-deep-visibility-key=/);
assert.match(index, /function applySettingsVisibility\(/);
assert.match(index, /function setAllSettingsVisibility\(/);
assert.match(style, /\[data-verba-deep-ui-hidden="true"\][\s\S]*?display:\s*none\s*!important/);

const visibilityBlock = index.slice(index.indexOf('const SETTINGS_VISIBILITY_DEFINITIONS = ['), index.indexOf('const DEFAULT_SETTINGS_VISIBILITY'));
assert.equal((visibilityBlock.match(/\{ key:/g) || []).length, 25);

console.log('PASS: 태그 내부 번역 토글과 25개 화면 표시 설정이 긴르바 저장/UI/분할 경로에 연결됨.');
