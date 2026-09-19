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
assert.match(prompt, /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
assert.match(prompt, /Never turn USER/);
assert.match(prompt, /situation, urgency, obstacle, enemy, self or free emotion/);
assert.match(prompt, /rough teasing and blunt criticism remain allowed/);
assert.match(prompt, /Never use misogynistic, gender-degrading or identity-based abuse/);
assert.match(prompt, /most compatible lines/);
assert.match(prompt, /Vary coarse mechanisms/);
assert.match(prompt, /situation-directed profanity/);
assert.match(prompt, /rough verbs/);
assert.match(prompt, /profanity-shaped rhythm/);

const low = build('low');
const natural = build('natural');
const high = build('high');
assert.notEqual(low, natural);
assert.notEqual(natural, high);
assert.match(low, /preserve source curses/i);
assert.match(natural, /must not stay uniformly clean/);
assert.match(high, /most compatible lines/);

for (const scope of ['narration', 'other_dialogue', 'tagged_content']) {
    assert.doesNotMatch(build('high', scope), /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
}
assert.doesNotMatch(core.buildInputPrompt('안녕하세요.', {
    ...defaults,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'high',
}, 'male', identity), /USER-DIRECTED PROFANITY GUARD/);

console.log('PASS: Hongjin profanity varies by strength, distinguishes USER listener from curse target, preserves misogyny safety, and stays scoped.');
