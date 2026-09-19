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

assert.equal(prompt.split('CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT').length - 1, 1);
assert.equal(prompt.split('MAD FLASH V2 — SINGLE-PASS KOREAN COMPOSITION').length - 1, 1);
assert.match(prompt, /Discard source-language wording, clause order and sentence rhythm/);
assert.match(prompt, /original contemporary Korean speech/);
assert.match(prompt, /Reauthoring=maximum/);
assert.match(prompt, /most compatible lines/);
assert.match(prompt, /teasing=active/);
assert.match(prompt, /vulgarity=openly crude/);
assert.match(prompt, /playfulness=high/);
assert.match(prompt, /A neutral sentence plus a detachable curse fails/);
assert.match(prompt, /Vary coarse mechanisms/);
assert.match(prompt, /Never turn USER/);
assert.match(prompt, /situation-directed profanity/);
assert.match(prompt, /generic macho man/);
assert.match(prompt, /REFERENCE-CORPUS RHYTHM PROFILE/);
assert.match(prompt, /ORDINARY CONFLICT/);
assert.match(prompt, /ACTIVE DANGER/);
assert.match(prompt, /CONCEALED CARE/);
assert.ok(prompt.length >= 12000);
assert.match(prompt, /Do NOT impose an artificial one-use cap/);
assert.match(prompt, /identical curse roots and identical placement in adjacent TARGET utterances/);

const mixedPrompt = core.buildOutputPrompt(
    { segments, nameTokens: [] }, settings, '', identity, null,
    { seg_0000: 'target_dialogue' },
);
assert.match(mixedPrompt, /do not impose a numeric one-use cap/i);
assert.match(mixedPrompt, /never repeat the same curse root in adjacent TARGET utterances/i);
assert.match(mixedPrompt, /speaker_scope is an absolute row-level firewall/);

for (const scope of ['narration', 'other_dialogue', 'tagged_content']) {
    assert.doesNotMatch(build(scope), /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
}

const off = core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings: { ...settings, developerHongjinFlavorEnabled: false },
    scope: 'target_dialogue',
    speakerIdentity: identity,
});
assert.doesNotMatch(off, /CURRENT TARGET CHARACTER VOICE — PRIMARY WRITING REQUIREMENT/);
assert.doesNotMatch(core.buildInputPrompt('안녕', settings, 'male', identity), /TARGET DIALOGUE ONLY — CURRENT TARGET CHARACTER/);

console.log('PASS: Flash-optimized Kim Hong-jin voice is mandatory, varied, settings-aware, and restricted to confirmed target dialogue.');
