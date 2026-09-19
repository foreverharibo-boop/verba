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
    if (['narration', 'targetDialogue', 'otherDialogue'].includes(name)) {
        assert.equal(prompt.split('MAD FLASH V2 — SINGLE-PASS KOREAN COMPOSITION').length - 1, 1, `${name}: one V2 contract`);
        assert.match(prompt, /EXECUTE IN THIS ORDER/);
        assert.match(prompt, /Discard source-language wording, clause order and sentence rhythm/);
        assert.match(prompt, /Natural Korean is not literal Korean and not free invention/);
        assert.match(prompt, /add or remove no event or proposition/);
        assert.match(prompt, /BANNED KOREAN WORDS/);
        checks += 6;
    } else {
        assert.equal(prompt.split('TARGET CHARACTER AUTHORING PATH').length - 1, 1, `${name}: one restored 0.5.84 contract`);
        assert.doesNotMatch(prompt, /generate three|three different Kim Hong-jin utterances/iu);
        checks += 2;
    }
}

const outputPrompt = builders.output();
assert.equal(outputPrompt.split('DEEPSEEK V4.1 FLASH — CURRENT TARGET CHARACTER DIALOGUE VOICE PASS').length - 1, 1);
assert.match(outputPrompt, /speaker_scope is an absolute row-level firewall/);

const narration = builders.narration();
const target = builders.targetDialogue();
const other = builders.otherDialogue();
assert.doesNotMatch(narration, /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
assert.match(target, /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
assert.doesNotMatch(other, /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
assert.match(target, /sly, shameless, playful/);
assert.match(target, /original contemporary Korean speech/);
assert.match(target, /FINAL EXECUTION GATE — THIS OVERRIDES ANY BLAND DEFAULT/);
assert.match(target, /These are functions, never fixed lines/);
assert.match(target, /Do not import medical, survival, injury, enemy, romance or care-taking content/);
assert.doesNotMatch(target, /어깨 빠진 거 도로 처맞췄고/);
assert.match(target, /generic clean survival-fiction man/);
assert.match(other, /FINAL NON-TARGET FIREWALL — THIS OVERRIDES TARGET VOICE/);
assert.match(other, /Preserve every source swear or coarse idiom/);
assert.match(other, /A clean source does not receive added TARGET profanity/);
assert.doesNotMatch(other, /좆됐네, 꼴이|좆같이 생겼네/);
assert.match(narration, /FINAL KOREAN-PROSE GATE — REJECT CALQUES BEFORE OUTPUT/);
assert.match(narration, /피로가 뼛속까지 내려앉다/);
assert.doesNotMatch(narration, /깊고 갈리는 피로|눈이 어둠에 적응하도록 두었다/);
for (const [prompt, gate] of [
    [narration, 'FINAL KOREAN-PROSE GATE'],
    [target, 'FINAL EXECUTION GATE'],
    [other, 'FINAL NON-TARGET FIREWALL'],
]) {
    assert.ok(prompt.indexOf('SOURCE CONTEXT — reference only') < prompt.indexOf(gate));
    assert.ok(prompt.indexOf(gate) < prompt.indexOf('TARGETS'));
}

const off = core.buildOutputPrompt(segmented, { ...settings, developerMadKoreanOutputEnabled: false }, '', identity);
assert.doesNotMatch(off, /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);
assert.doesNotMatch(core.buildInputPrompt('안녕', settings, 'male', identity), /SHORT MANDATORY KOREAN REAUTHORING CONTRACT/);

console.log(`PASS: Flash-optimized Mad Korean recomposition contract, corruption audit, scoped narration/dialogue rules, and near-data execution gates (${checks + 23} checks).`);
