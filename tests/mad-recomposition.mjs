import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male', nameLocks: [] };
const segmented = core.segmentSource('He looked behind them. "Move. Now."');
const translations = new Map(segmented.segments.map(row => [row.id, '번역']));
const settings = {
    ...defaults,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'high',
};

const builders = {
    output: () => core.buildOutputPrompt(segmented, settings, '', identity),
    narration: () => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings, scope: 'narration', speakerIdentity: identity }),
    targetDialogue: () => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings, scope: 'target_dialogue', speakerIdentity: identity }),
    otherDialogue: () => core.buildScopedOutputPrompt({ segments: segmented.segments, sourceContext: '', settings, scope: 'other_dialogue', speakerIdentity: identity }),
    selection: () => core.buildSelectionPrompt({ source: '', translation: '"번역"', selected: '"번역"', start: 0, end: 4, settings, speakerIdentity: identity }),
    multiSelection: () => core.buildMultiSelectionPrompt({ source: '', translation: '"번역"', selections: [{ id: 'm0', selected: '"번역"', start: 0, end: 4 }], settings, speakerIdentity: identity }),
    qualityAudit: () => core.buildQualityAuditPrompt({ segments: segmented.segments, currentTranslations: translations, sourceContext: '', settings, speakerIdentity: identity, enabledChecks: ['meaning', 'voice', 'translationese'] }),
    bannedRepair: () => core.buildBannedRepairPrompt(segmented.segments, translations, settings, identity),
    tokenRepair: () => core.buildProtectedTokenRepairPrompt(segmented.segments, translations, settings, identity),
    untranslatedRepair: () => core.buildUntranslatedRepairPrompt(segmented.segments, translations, settings, identity),
};

let checks = 0;
for (const [name, build] of Object.entries(builders)) {
    const prompt = build();
    assert.equal(prompt.split('DEEPSEEK V4.1 FLASH — KOREAN RECOMPOSITION').length - 1, 1, `${name}: one contract`);
    assert.match(prompt, /originally been written in contemporary Korean/);
    assert.match(prompt, /Preserve who did what to whom/);
    assert.match(prompt, /Never copy source-language clause order/);
    assert.match(prompt, /missing particle\/syllable/);
    assert.match(prompt, /physical attachment and direction/);
    assert.match(prompt, /Dialogue must sound spoken/);
    assert.match(prompt, /공기가 얇다/);
    assert.match(prompt, /작은 숨 헐떡임/);
    assert.match(prompt, /담은이 몸집/);
    assert.match(prompt, /Road\/overpass “ramp” is 경사로\/진입로/);
    assert.match(prompt, /BANNED KOREAN WORDS/);
    checks += 11;
}

const narration = builders.narration();
const target = builders.targetDialogue();
const other = builders.otherDialogue();
assert.doesNotMatch(narration, /DIVERSE VOICE MODELS/);
assert.match(target, /TARGET DIALOGUE ONLY — KIM HONG-JIN/);
assert.doesNotMatch(other, /TARGET DIALOGUE ONLY — KIM HONG-JIN/);
assert.match(target, /sly confidence/);
assert.match(target, /Serious or tactical lines stay short/);

const off = core.buildOutputPrompt(segmented, { ...settings, developerMadKoreanOutputEnabled: false }, '', identity);
assert.doesNotMatch(off, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);
assert.doesNotMatch(core.buildInputPrompt('안녕', settings, 'male', identity), /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);

console.log(`PASS: Flash-optimized Mad Korean recomposition contract, corruption audit, scoped narration/dialogue rules, and diverse Hongjin examples (${checks + 14} checks).`);
