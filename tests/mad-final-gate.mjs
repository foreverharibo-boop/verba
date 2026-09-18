import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const source = 'He crossed the landing. "Move. Now."';
const segmented = core.segmentSource(source);
const marker = '<final_mad_korean_gate>';
const hongjinMarker = '<final_hongjin_voice_gate>';

function assertMadGate(prompt, dataMarker, label, { hongjin = false } = {}) {
    assert.equal(prompt.split(marker).length - 1, 1, `${label}: Mad gate count`);
    assert.ok(prompt.lastIndexOf(marker) > prompt.lastIndexOf(dataMarker), `${label}: Mad gate must follow source data`);
    const gate = prompt.slice(prompt.lastIndexOf(marker), hongjin && prompt.includes(hongjinMarker) ? prompt.lastIndexOf(hongjinMarker) : undefined);
    assert.match(gate, /FINAL KOREAN CHECK/i, `${label}: mandatory`);
    assert.match(gate, /source-language clause order/i, `${label}: source structure audit`);
    assert.match(gate, /sounds translated/i, `${label}: translationese audit`);
    assert.match(gate, /unnatural collocation/i, `${label}: collocation audit`);
    assert.match(gate, /particle\/syllable/i, `${label}: corruption audit`);
    assert.match(gate, /actor\/action\/target/i, `${label}: fact roles`);
    assert.match(gate, /Add no event or bodily reaction/i, `${label}: factual invention guard`);
    assert.match(gate, /Return only the requested JSON/i, `${label}: hidden audit`);
    if (hongjin) {
        assert.equal(prompt.split(hongjinMarker).length - 1, 1, `${label}: Hongjin gate count`);
        assert.ok(prompt.lastIndexOf(marker) < prompt.lastIndexOf(hongjinMarker), `${label}: Mad gate precedes Hongjin gate`);
    } else {
        assert.doesNotMatch(prompt, /<final_hongjin_voice_gate>/, `${label}: no Hongjin gate`);
    }
}

let routeChecks = 0;
for (const mode of [
    {},
    { developerCompressedPromptEnabled: true },
    { developerExtremeCompressedPromptEnabled: true },
]) {
    for (const hongjin of [false, true]) {
        const settings = {
            ...defaults,
            ...mode,
            developerMode: true,
            developerMadKoreanOutputEnabled: true,
            developerHongjinFlavorEnabled: hongjin,
            developerHongjinProfanity: 'natural',
        };

        assertMadGate(core.buildOutputPrompt(segmented, settings, '', identity), 'SEGMENTS', `output/${JSON.stringify(mode)}/${hongjin}`, { hongjin });

        for (const scope of ['narration', 'target_dialogue', 'other_dialogue', 'tagged_content']) {
            const scoped = core.buildScopedOutputPrompt({
                segments: segmented.segments,
                sourceContext: source,
                settings,
                scope,
                speakerIdentity: identity,
            });
            assertMadGate(scoped, 'TRANSLATION TARGETS', `scoped-${scope}/${JSON.stringify(mode)}/${hongjin}`, {
                hongjin: hongjin && scope === 'target_dialogue',
            });
            const gate = scoped.slice(scoped.lastIndexOf(marker), scoped.includes(hongjinMarker) ? scoped.lastIndexOf(hongjinMarker) : undefined);
            if (scope === 'narration') assert.match(gate, /keep it narration/i);
            if (scope === 'target_dialogue') assert.match(gate, /confirmed TARGET CHARACTER dialogue/i);
            if (scope === 'other_dialogue') assert.match(gate, /USER\/NPC\/OTHER dialogue/i);
            if (scope === 'tagged_content') assert.match(gate, /visible tagged content/i);
        }

        const narrationTranslation = '그는 계단참을 건넜다.';
        const narrationSelection = core.buildSelectionPrompt({
            source: 'He crossed the landing.',
            sourceContext: 'He crossed the landing.',
            translation: narrationTranslation,
            selected: narrationTranslation,
            start: 0,
            end: narrationTranslation.length,
            settings,
            oneTimeInstruction: '',
            speakerIdentity: identity,
            candidateCount: 3,
            contextMode: 'selection',
        });
        assertMadGate(narrationSelection, 'RIGHT', `selection-narration/${JSON.stringify(mode)}/${hongjin}`);

        const dialogueTranslation = '"움직여. 지금."';
        const dialogueSelection = core.buildSelectionPrompt({
            source: '"Move. Now."',
            sourceContext: '"Move. Now."',
            translation: dialogueTranslation,
            selected: dialogueTranslation,
            start: 0,
            end: dialogueTranslation.length,
            settings,
            oneTimeInstruction: '',
            speakerIdentity: identity,
            candidateCount: 3,
            contextMode: 'selection',
        });
        assertMadGate(dialogueSelection, 'RIGHT', `selection-dialogue/${JSON.stringify(mode)}/${hongjin}`, { hongjin });

        const multi = core.buildMultiSelectionPrompt({
            source,
            translation: dialogueTranslation,
            selections: [{ id: 'sel_0', selected: dialogueTranslation, sourceContext: '"Move. Now."', start: 0, end: dialogueTranslation.length }],
            settings,
            oneTimeInstruction: '',
            speakerIdentity: identity,
            contextMode: 'selection',
        });
        assertMadGate(multi, 'SELECTIONS', `multi/${JSON.stringify(mode)}/${hongjin}`, { hongjin });
        routeChecks += 8;
    }
}

const ordinary = {
    ...defaults,
    developerMode: true,
    developerMadKoreanOutputEnabled: false,
    developerHongjinFlavorEnabled: false,
};
assert.doesNotMatch(core.buildOutputPrompt(segmented, ordinary, '', identity), /<final_mad_korean_gate>/);

const hongjinOnly = { ...ordinary, developerHongjinFlavorEnabled: true };
const hongjinOnlyPrompt = core.buildOutputPrompt(segmented, hongjinOnly, '', identity);
assert.doesNotMatch(hongjinOnlyPrompt, /<final_mad_korean_gate>/);
assert.match(hongjinOnlyPrompt, /<final_hongjin_voice_gate>/);

const madOnly = { ...ordinary, developerMadKoreanOutputEnabled: true };
assert.doesNotMatch(core.buildInputPrompt('안녕', madOnly, 'male', identity), /<final_mad_korean_gate>/);

console.log(`PASS: Mad Korean final gate follows source data across full/scoped/selection routes in normal/compact/extreme prompts; scope, Hongjin order, ordinary output, and input isolation verified (${routeChecks + 3} route checks).`);
