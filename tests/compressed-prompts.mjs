import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as core from '../core.js';

// Prompt-construction regression only: no API calls, credentials, browser state, or settings writes.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const baseline = process.argv[2] ? await import(pathToFileURL(path.resolve(process.argv[2])).href) : null;
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const segmented = core.segmentSource('He opened the door. "Move. Now."');

const build = (module, settings) => module.buildOutputPrompt(segmented, settings, '', identity);
const ordinary = { ...defaults, developerMode: true };
const ordinaryCompact = { ...ordinary, developerCompressedPromptEnabled: true };
const mad = { ...ordinary, developerMadKoreanOutputEnabled: true, developerHongjinFlavorEnabled: true };
const madCompact = { ...mad, developerCompressedPromptEnabled: true };
const madExtreme = { ...mad, developerExtremeCompressedPromptEnabled: true };

const ordinaryFullPrompt = build(core, ordinary);
const ordinaryCompactPrompt = build(core, ordinaryCompact);
assert.ok(ordinaryCompactPrompt.length < ordinaryFullPrompt.length, 'ordinary compact mode must remain shorter');
assert.doesNotMatch(ordinaryFullPrompt, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);
assert.doesNotMatch(ordinaryCompactPrompt, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);

const madPrompt = build(core, mad);
const compactPrompt = build(core, madCompact);
const extremePrompt = build(core, madExtreme);
assert.match(madPrompt, /DEEPSEEK V4\.1 FLASH — KOREAN RECOMPOSITION/);
assert.match(madPrompt, /TARGET DIALOGUE ONLY — KIM HONG-JIN/);
assert.match(compactPrompt, /MAD KOREAN EXCLUSIVE — COMPACT EXPERIMENT/);
assert.match(extremePrompt, /MAD KOREAN — ULTRA-COMPACT/);
assert.doesNotMatch(compactPrompt, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);
assert.doesNotMatch(extremePrompt, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);
assert.ok(madPrompt.length < compactPrompt.length, 'the new Flash-first standard path should be shorter than the legacy compact experiment');
assert.ok(madPrompt.length < extremePrompt.length, 'the new Flash-first standard path should be shorter than the legacy ultra-compact path including their shared gates');

for (const prompt of [madPrompt, compactPrompt, extremePrompt]) {
    assert.equal(prompt.split('TOP PRIORITY — NO MISOGYNY').length - 1, 1);
    assert.match(prompt, /KIM HONG-JIN|Kim Hong-jin/);
    assert.match(prompt, /BANNED KOREAN WORDS/);
    assert.match(prompt, /김홍진/);
    assert.match(prompt, /담은/);
}

// Developer compression remains gated, while the two user-facing flavor switches remain effective.
assert.equal(
    build(core, { ...madCompact, developerMode: false }),
    build(core, { ...mad, developerMode: false }),
);

if (baseline) {
    // This release intentionally changes only the normal Mad-Korean path. Ordinary translation remains byte-identical.
    assert.equal(ordinaryFullPrompt, build(baseline, ordinary));
    assert.equal(ordinaryCompactPrompt, build(baseline, ordinaryCompact));
}

console.log(JSON.stringify({
    pass: true,
    ordinary: { full: ordinaryFullPrompt.length, compact: ordinaryCompactPrompt.length },
    madHongjin: { flashOptimized: madPrompt.length, legacyCompact: compactPrompt.length, legacyExtreme: extremePrompt.length },
}));
