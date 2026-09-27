import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const segments = [{ id: 'seg_0000', type: 'dialogue_candidate', text: '"Move. Now."' }];
const build = (settings, scope = 'target_dialogue') => core.buildScopedOutputPrompt({
    segments,
    sourceContext: '',
    settings,
    scope,
    speakerIdentity: identity,
});

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
            developerHongjinTranscreation: 'maximum',
            developerHongjinProfanity: 'high',
            developerHongjinTeasing: 'active',
            developerHongjinVulgarity: 'open',
            developerHongjinPlayfulness: 'high',
        };
        const prompt = build(settings);
        assert.equal(prompt.split('KIM HONG-JIN RAW VOICE — MANDATORY EXECUTION').length - 1, 1);
        assert.equal(prompt.split('END KIM HONG-JIN RAW VOICE').length - 1, 1);
        assert.equal(prompt.split('MANDATORY TRANSLATION CONTRACT').length - 1, 1);
        assert.match(prompt, /non-optional acceptance condition/i);
        assert.match(prompt, /REQUIRED OUTPUT ELEMENTS/);
        assert.match(prompt, /Merely .*not compliance/i);
        assert.match(prompt, /clean, polite, neutral, textbook-like/i);
        assert.match(prompt, /Do not (?:first )?produce a neutral translation|Do not translate neutrally/);
        assert.match(prompt, /voice must remain recognizable|personality disappears after removing one detachable swear word/i);
        assert.match(prompt, /USER-directed profanity(?: bans)? restrict only|bans on misogyny and USER-directed profanity restrict only|Misogyny and USER-directed profanity bans restrict only/i);
        assert.match(prompt, /Seriousness (?:suppresses|blocks) forced (?:comedy|jokes), not raw(?:ness| diction)/i);
        assert.match(prompt, /most eligible lines/);
        assert.ok(prompt.indexOf('MANDATORY TRANSLATION CONTRACT') < prompt.indexOf('USER-DIRECTED PROFANITY GUARD'));
        if (!mode.developerCompressedPromptEnabled && !mode.developerExtremeCompressedPromptEnabled) {
            assert.ok(prompt.indexOf('MANDATORY TRANSLATION CONTRACT') < prompt.indexOf('Fixed personality premise'));
            assert.match(prompt, /VOICE TRANSFORMATION MODELS/);
            assert.match(prompt, /WEAK FAILURE: “움직여\. 지금\.”/);
            assert.match(prompt, /KIM HONG-JIN: “씨발, 당장 움직여\.”/);
            assert.match(prompt, /KIM HONG-JIN: “하, 씨발\. 어디 다친 데 없어\?”/);
            assert.match(prompt, /examples demonstrate transformation strength/);
        }
        assert.ok(!build(settings, 'narration').includes('KIM HONG-JIN RAW VOICE'));
        assert.ok(!build(settings, 'other_dialogue').includes('KIM HONG-JIN RAW VOICE'));
        checks += 20;
    }
}

const off = {
    ...defaults,
    developerMode: true,
    developerHongjinFlavorEnabled: false,
};
assert.ok(!build(off).includes('KIM HONG-JIN RAW VOICE'));
assert.ok(!core.buildInputPrompt('안녕', {
    ...defaults,
    developerMode: true,
    developerHongjinFlavorEnabled: true,
}, 'male', identity).includes('KIM HONG-JIN RAW VOICE'));
console.log('PASS: raw Kim Hong-jin voice mandate and examples across full/compact/extreme and Mad ON/OFF routes (' + checks + ' checks); narration/OTHER/input isolation preserved.');
