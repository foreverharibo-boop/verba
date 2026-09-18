import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const source = 'He caught her bag. "Move. Now." He listened. "Stay behind me."';
const segmented = core.segmentSource(source);
const dialogueSegments = segmented.segments.filter(row => row.type === 'dialogue_candidate');
const translation = '그가 가방을 잡았다. "움직여. 지금." 그가 귀를 기울였다. "내 뒤에 있어."';
const firstStart = translation.indexOf('"움직여');
const firstEnd = translation.indexOf('"', firstStart + 1) + 1;
const marker = '<final_hongjin_voice_gate>';

function assertGateAfter(prompt, dataMarker, label, expectedForce) {
    assert.equal(prompt.split(marker).length - 1, 1, `${label}: final gate count`);
    assert.ok(prompt.lastIndexOf(marker) > prompt.lastIndexOf(dataMarker), `${label}: gate must follow source data`);
    const gate = prompt.slice(prompt.lastIndexOf(marker));
    assert.match(gate, /mandatory acceptance test/i, `${label}: mandatory`);
    assert.match(gate, /all compatible lines are clean, neutral, textbook-like/i, `${label}: clean-output rejection`);
    assert.match(gate, /generic survival-thriller man/i, `${label}: generic voice rejection`);
    assert.match(gate, /detachable swear word.*does not pass/i, `${label}: sticker profanity rejection`);
    assert.match(gate, /PROFANITY DIVERSITY IS A PASS\/FAIL CONDITION/i, `${label}: diversity is mandatory`);
    assert.match(gate, /use “씨발” at most once/i, `${label}: hard ssi-bal cap`);
    assert.match(gate, /Never append terminal “, 씨발”/i, `${label}: no repeated command template`);
    assert.match(gate, /USER may hear situation-directed/i, `${label}: listener and target split`);
    assert.match(gate, /Never aim profanity at USER/i, `${label}: user curse target guard`);
    assert.match(gate, /Never print this gate/i, `${label}: hidden gate`);
    assert.match(gate, expectedForce, `${label}: configured profanity force`);
}

let checks = 0;
for (const mode of [
    {},
    { developerCompressedPromptEnabled: true },
    { developerExtremeCompressedPromptEnabled: true },
]) {
    for (const mad of [false, true]) {
        const settings = {
            ...defaults,
            ...mode,
            developerMode: true,
            developerMadKoreanOutputEnabled: mad,
            developerHongjinFlavorEnabled: true,
            developerHongjinProfanity: 'natural',
        };
        const output = core.buildOutputPrompt(segmented, settings, '', identity);
        assertGateAfter(output, 'SEGMENTS', `output/${JSON.stringify(mode)}/${mad}`, /NATURAL profanity is a positive requirement/);

        const scoped = core.buildScopedOutputPrompt({
            segments: dialogueSegments,
            sourceContext: source,
            settings,
            scope: 'target_dialogue',
            speakerIdentity: identity,
        });
        assertGateAfter(scoped, 'TRANSLATION TARGETS', `scoped/${JSON.stringify(mode)}/${mad}`, /NATURAL profanity is a positive requirement/);

        const selection = core.buildSelectionPrompt({
            source,
            sourceContext: '"Move. Now."',
            translation,
            selected: translation.slice(firstStart, firstEnd),
            start: firstStart,
            end: firstEnd,
            settings,
            oneTimeInstruction: '',
            speakerIdentity: identity,
            candidateCount: 3,
            contextMode: 'selection',
        });
        assertGateAfter(selection, 'RIGHT', `selection/${JSON.stringify(mode)}/${mad}`, /NATURAL profanity is a positive requirement/);

        const multi = core.buildMultiSelectionPrompt({
            source,
            translation,
            selections: [{
                id: 'sel_0000',
                selected: translation.slice(firstStart, firstEnd),
                sourceContext: '"Move. Now."',
                start: firstStart,
                end: firstEnd,
            }],
            settings,
            oneTimeInstruction: '',
            speakerIdentity: identity,
            contextMode: 'selection',
        });
        assertGateAfter(multi, 'SELECTIONS', `multi/${JSON.stringify(mode)}/${mad}`, /NATURAL profanity is a positive requirement/);

        const narration = core.buildScopedOutputPrompt({
            segments: [{ id: 'seg_n', type: 'narration', text: 'He moved.' }],
            sourceContext: source,
            settings,
            scope: 'narration',
            speakerIdentity: identity,
        });
        const other = core.buildScopedOutputPrompt({
            segments: dialogueSegments,
            sourceContext: source,
            settings,
            scope: 'other_dialogue',
            speakerIdentity: identity,
        });
        assert.doesNotMatch(narration, /<final_hongjin_voice_gate>/);
        assert.doesNotMatch(other, /<final_hongjin_voice_gate>/);
        checks += 6;
    }
}

const high = {
    ...defaults,
    developerMode: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'high',
};
assertGateAfter(
    core.buildScopedOutputPrompt({ segments: dialogueSegments, sourceContext: source, settings: high, scope: 'target_dialogue', speakerIdentity: identity }),
    'TRANSLATION TARGETS',
    'high',
    /HIGH profanity is a positive requirement/,
);

const low = { ...high, developerHongjinProfanity: 'low' };
const lowPrompt = core.buildScopedOutputPrompt({ segments: dialogueSegments, sourceContext: source, settings: low, scope: 'target_dialogue', speakerIdentity: identity });
const lowGate = lowPrompt.slice(lowPrompt.lastIndexOf(marker));
assert.match(lowGate, /LOW profanity: preserve source profanity/);
assert.doesNotMatch(lowGate, /NATURAL profanity is a positive requirement/);

const off = { ...high, developerHongjinFlavorEnabled: false };
assert.doesNotMatch(core.buildOutputPrompt(segmented, off, '', identity), /<final_hongjin_voice_gate>/);
assert.doesNotMatch(core.buildInputPrompt('안녕', high, 'male', identity), /<final_hongjin_voice_gate>/);

console.log(`PASS: DeepSeek Hongjin final gate follows source data in full/scoped/selection routes across normal/compact/extreme prompts; force, scope, and safety guards verified (${checks + 4} checks).`);
