import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const segments = [{ id: 'seg_0000', type: 'dialogue_candidate', text: '"Move. Now."' }];
const settings = {
    ...defaults,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinTranscreation: 'maximum',
    developerHongjinProfanity: 'high',
    developerHongjinTeasing: 'active',
    developerHongjinVulgarity: 'open',
    developerHongjinPlayfulness: 'high',
};
const build = scope => core.buildScopedOutputPrompt({ segments, sourceContext: '', settings, scope, speakerIdentity: identity });
const prompt = build('target_dialogue');

assert.equal(prompt.split('TARGET DIALOGUE ONLY — KIM HONG-JIN').length - 1, 1);
assert.equal(prompt.split('MANDATORY AUTHORIZED VOICE OVERRIDE').length - 1, 1);
assert.match(prompt, /maximum re-authoring/);
assert.match(prompt, /most eligible TARGET lines/);
assert.match(prompt, /active cheeky needling/);
assert.match(prompt, /openly crude, brazen diction/);
assert.match(prompt, /highly visible playful audacity/);
assert.match(prompt, /not by attaching one curse to a neutral sentence/);
assert.match(prompt, /Serious or tactical lines stay short/);
assert.match(prompt, /USER-DIRECTED PROFANITY GUARD/);
assert.match(prompt, /Profanity diversity is mandatory/);
assert.match(prompt, /crude idioms and curse-free rawness/);

for (const scope of ['narration', 'other_dialogue', 'tagged_content']) {
    assert.doesNotMatch(build(scope), /TARGET DIALOGUE ONLY — KIM HONG-JIN/);
}

const off = core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings: { ...settings, developerHongjinFlavorEnabled: false },
    scope: 'target_dialogue',
    speakerIdentity: identity,
});
assert.doesNotMatch(off, /TARGET DIALOGUE ONLY — KIM HONG-JIN/);
assert.doesNotMatch(core.buildInputPrompt('안녕', settings, 'male', identity), /TARGET DIALOGUE ONLY — KIM HONG-JIN/);

console.log('PASS: Flash-optimized Kim Hong-jin voice is mandatory, varied, settings-aware, and restricted to confirmed target dialogue.');
