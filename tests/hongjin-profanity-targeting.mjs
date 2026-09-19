import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '혜담은', characterGender: 'male', nameLocks: [] };
const segments = [{ id: 'seg_0000', type: 'dialogue_candidate', text: '"Do not look back. Keep moving. Are you hurt?"' }];

const build = (profanity = 'high', scope = 'target_dialogue') => core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings: {
        ...defaults,
        developerMadKoreanOutputEnabled: true,
        developerHongjinFlavorEnabled: true,
        developerHongjinProfanity: profanity,
    },
    scope,
    speakerIdentity: identity,
});

const prompt = build();
assert.match(prompt, /USER-DIRECTED PROFANITY GUARD/);
assert.match(prompt, /never curse at USER as a person/);
assert.match(prompt, /USER may hear profanity aimed at the situation, urgency, pain, self, obstacle, enemy, NPC\/third party/);
assert.match(prompt, /rough non-profane rebuke/);
assert.match(prompt, /Never use misogynistic or gender-degrading abuse/);
assert.match(prompt, /most eligible TARGET lines/);
assert.match(prompt, /Profanity diversity is mandatory/);
assert.match(prompt, /free expletive/);
assert.match(prompt, /intensifiers/);
assert.match(prompt, /개-\/좆-\/지랄\/처-/);
assert.match(prompt, /curse-free rawness/);

const low = build('low');
const natural = build('natural');
const high = build('high');
assert.notEqual(low, natural);
assert.notEqual(natural, high);
assert.match(low, /preserve source swearing/);
assert.match(natural, /must not remain uniformly clean/);
assert.match(high, /most eligible TARGET lines/);

for (const scope of ['narration', 'other_dialogue', 'tagged_content']) {
    assert.doesNotMatch(build('high', scope), /USER-DIRECTED PROFANITY GUARD/);
}
assert.doesNotMatch(core.buildInputPrompt('안녕하세요.', {
    ...defaults,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'high',
}, 'male', identity), /USER-DIRECTED PROFANITY GUARD/);

console.log('PASS: Hongjin profanity varies by strength, distinguishes USER listener from curse target, preserves misogyny safety, and stays scoped.');
