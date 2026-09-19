import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildHongjinVoiceRewritePrompt,
    buildOutputPrompt,
    segmentSource,
} from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = { characterName: '김홍진', userName: '담은', characterGender: 'male' };
const source = 'He gave her a dry look. "You really thought that would work?"';
const segmented = segmentSource(source);

const ordinary = buildOutputPrompt(segmented, {
    ...defaults,
    narrationLocalizationLevel: 'preserve',
    dialogueLocalizationLevel: 'preserve',
}, '', identity);
assert.match(ordinary, /NATURAL E→K BASELINE — NEUTRAL FOUNDATION/);
assert.match(ordinary, /does NOT choose source-faithful versus strongly localized writing/);
assert.match(ordinary, /preserve the character as an English-speaking person/i);
assert.match(ordinary, /SOURCE-FAITHFUL KOREAN/);
assert.doesNotMatch(ordinary, /FINAL MAD KOREAN PASS\/FAIL GATE/);

const englishTaste = buildOutputPrompt(segmented, {
    ...defaults,
    englishFlavorEnabled: true,
    englishFlavorConversationNaturalization: 'active',
    englishFlavorSlangDensity: 'active',
}, '', identity);
assert.match(englishTaste, /ENGLISH-SPEAKING CHARACTER TASTE/);
assert.match(englishTaste, /ACTIVE \/ MAXIMUM SOURCE FLAVOR/);

const dialogue = segmented.segments.filter(row => row.type === 'dialogue_candidate');
const voicePrompt = buildHongjinVoiceRewritePrompt({
    segments: dialogue,
    currentTranslations: new Map(dialogue.map(row => [row.id, '"그게 될 거라고 정말 생각했어?"'])),
    sourceContext: source,
    speakerIdentity: identity,
    settings: {
        ...defaults,
        developerHongjinFlavorEnabled: true,
        developerHongjinTranscreation: 'maximum',
        developerHongjinTeasing: 'active',
    },
});
assert.match(voicePrompt, /DEDICATED SECOND-PASS VOICE REWRITE/);
assert.match(voicePrompt, /not a generic shouting tough guy/i);
assert.match(voicePrompt, /Quoted retort/);
assert.match(voicePrompt, /Tactical refusal/);
assert.match(voicePrompt, /Reluctant care/);
assert.match(voicePrompt, /Fake courtesy/);
assert.match(voicePrompt, /Deflection/);
assert.match(voicePrompt, /"reauthoring":"maximum"/);
assert.match(voicePrompt, /"teasing":"active"/);

const translateStart = index.indexOf('async function translateOutputText(');
const translateEnd = index.indexOf('function inputIdentitySpellingContext(', translateStart);
const translateBody = index.slice(translateStart, translateEnd);
assert.ok(translateBody.indexOf('await runHongjinVoiceRewrite(') >= 0);
assert.ok(translateBody.indexOf('await runHongjinVoiceRewrite(') < translateBody.indexOf('await runMadKoreanTargetedAudit('));

console.log('PASS: ordinary E→K stays neutral and delegates localization; English-character taste remains separate; Hongjin uses a dedicated second-pass rewrite.');
