import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

// Prompt-construction regression only: no API calls or live model output.
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const definitions = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(definitions + '\nreturn DEFAULT_SETTINGS;')();
const identity = {
    characterName: '김홍진',
    userName: '혜담은',
    characterGender: 'male',
    nameLocks: [],
};
const segments = [{
    id: 'seg_0000',
    type: 'dialogue_candidate',
    text: '"Don\'t look back! Keep moving! The door will not open. Are you hurt?"',
}];

const build = (flags = {}, scope = 'target_dialogue') => core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings: {
        ...defaults,
        developerMode: true,
        developerHongjinFlavorEnabled: true,
        developerHongjinProfanity: 'high',
        developerHongjinTeasing: 'natural',
        developerHongjinVulgarity: 'open',
        developerHongjinPlayfulness: 'natural',
        ...flags,
    },
    scope,
    speakerIdentity: identity,
});

const modes = {
    standard: {},
    compressed: { developerCompressedPromptEnabled: true },
    extreme: { developerExtremeCompressedPromptEnabled: true },
};

for (const [mode, flags] of Object.entries(modes)) {
    for (const mad of [false, true]) {
        const prompt = build({ ...flags, developerMadKoreanOutputEnabled: mad });
        assert.match(prompt, /USER-DIRECTED PROFANITY GUARD/, `${mode}/mad=${mad}: guard`);
        assert.match(prompt, /아, 씨발\. 뒤 보지 마\./, `${mode}/mad=${mad}: allowed urgency example`);
        assert.match(prompt, /존나 빨리 뛰어\./, `${mode}/mad=${mad}: allowed intensifier example`);
        assert.match(prompt, /씨발, 문이 안 열리잖아\./, `${mode}/mad=${mad}: allowed obstacle example`);
        assert.match(prompt, /하, 씨발\.\.\. 다친 데 없어\?/, `${mode}/mad=${mad}: allowed concern example`);
        assert.match(prompt, /야, 이 새끼야\./, `${mode}/mad=${mad}: forbidden USER-target example`);
        assert.match(prompt, /너 병신이냐\?/, `${mode}/mad=${mad}: forbidden USER-target question`);
        assert.match(prompt, /listener|addressee/i, `${mode}/mad=${mad}: listener separated from curse target`);
        assert.match(prompt, /serious[^\n]*(?:does not|does NOT|not)[^\n]*clean|Serious[^\n]*not[^\n]*swearing/i, `${mode}/mad=${mad}: serious scene does not sanitize`);
        assert.match(prompt, /positive frequency requirement|positive requirement/i, `${mode}/mad=${mad}: high is mandatory`);
        assert.match(prompt, /misogyny|NO MISOGYNY/i, `${mode}/mad=${mad}: higher safety remains`);
    }

    const low = build({ ...flags, developerHongjinProfanity: 'low' });
    const natural = build({ ...flags, developerHongjinProfanity: 'natural' });
    const high = build({ ...flags, developerHongjinProfanity: 'high' });
    assert.notEqual(low, natural, `${mode}: low/natural must differ`);
    assert.notEqual(natural, high, `${mode}: natural/high must differ`);
    assert.match(low, /preserve source swearing|Preserve explicit source profanity/i, `${mode}: low preserves source force`);
    assert.match(natural, /do not sanitize|Do not sanitize/i, `${mode}: natural resists sanitizing`);
    assert.match(high, /most eligible/i, `${mode}: high frequency floor`);
}

for (const scope of ['narration', 'other_dialogue', 'tagged_content']) {
    assert.doesNotMatch(build({}, scope), /USER-DIRECTED PROFANITY GUARD/, `${scope}: no Hongjin profanity voice leakage`);
}
assert.doesNotMatch(
    core.buildInputPrompt('안녕하세요.', {
        ...defaults,
        developerMode: true,
        developerHongjinFlavorEnabled: true,
        developerHongjinProfanity: 'high',
    }, 'male', identity),
    /USER-DIRECTED PROFANITY GUARD/,
    'Korean-to-English input must not receive Hongjin output voice',
);

console.log('PASS: Hongjin profanity distinguishes USER listener from curse target, preserves safety, enforces NATURAL/HIGH force, and stays scoped across all prompt modes.');
