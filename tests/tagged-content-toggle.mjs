import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assembleTranslation, segmentSource } from '../core.js';

const source = '<Info_panel>[Weather: Sunny]</Info_panel> Outside text.';

const enabled = segmentSource(source, [], { translateTaggedContent: true });
assert.equal(enabled.segments.filter(row => row.type === 'tagged_content').length, 1);

const disabled = segmentSource(source, [], { translateTaggedContent: false });
assert.equal(disabled.segments.some(row => row.type === 'tagged_content'), false);
assert.equal(disabled.segments.length, 1);
const translatedOutside = new Map(disabled.segments.map(row => [
    row.id,
    row.text.replace('Outside text.', '바깥 본문.'),
]));
assert.equal(
    assembleTranslation(disabled, translatedOutside),
    '<Info_panel>[Weather: Sunny]</Info_panel> 바깥 본문.',
);

const tagOnly = segmentSource('<status>Hello, world.</status>', [], { translateTaggedContent: false });
assert.equal(tagOnly.segments.length, 0);
assert.equal(assembleTranslation(tagOnly, new Map()), '<status>Hello, world.</status>');

const nested = segmentSource('<outer>Before <inner>Inside</inner> After</outer>', [], {
    translateTaggedContent: false,
});
assert.equal(nested.segments.length, 0);
assert.equal(
    assembleTranslation(nested, new Map()),
    '<outer>Before <inner>Inside</inner> After</outer>',
);

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert.match(index, /translateTaggedContent:\s*true/);
assert.match(index, /settings\.translateTaggedContent\s*=\s*settings\.translateTaggedContent\s*!==\s*false/);
assert.match(index, /segmentSource\(source, characterNameLocks, segmentationOptions\)/);
assert.match(index, /id="verba-translate-tagged-content"/);
assert.match(index, /data-verba-visibility-key=/);
assert.match(index, /function applySettingsVisibility\(/);
assert.match(index, /function setAllSettingsVisibility\(/);
assert.match(style, /\[data-verba-ui-hidden="true"\][\s\S]*?display:\s*none\s*!important/);

const visibilityBlock = index.slice(
    index.indexOf('const SETTINGS_VISIBILITY_DEFINITIONS = ['),
    index.indexOf('const DEFAULT_SETTINGS_VISIBILITY'),
);
assert.equal((visibilityBlock.match(/\{ key:/g) || []).length, 25);

console.log('PASS: tagged natural-language translation defaults ON, can be disabled without touching outside text or tag structure, and 25 settings groups support persistent UI-only visibility.');
