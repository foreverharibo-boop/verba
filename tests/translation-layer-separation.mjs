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
assert.match(voicePrompt, /KOREAN-ONLY CHARACTER REAUTHORING/);
assert.match(voicePrompt, /No foreign source text is supplied/);
assert.match(voicePrompt, /write from blank/i);
assert.match(voicePrompt, /ACROSS THE FULL DIALOGUE SET/);
assert.match(voicePrompt, /ONLY CONTENT BOUNDARY/);
assert.match(voicePrompt, /generic serious man/i);
assert.doesNotMatch(voicePrompt, /You really thought that would work/);
assert.doesNotMatch(voicePrompt, /SCENE CONTEXT/);
assert.match(voicePrompt, /"reauthoring":"maximum"/);
assert.match(voicePrompt, /"teasing":"active"/);

const translateStart = index.indexOf('async function translateOutputText(');
const translateEnd = index.indexOf('function inputIdentitySpellingContext(', translateStart);
const translateBody = index.slice(translateStart, translateEnd);
assert.doesNotMatch(translateBody, /await runHongjinVoiceRewrite\(/);
assert.match(translateBody, /source-less voice rewrite is deliberately not called/);
assert.match(translateBody, /noModelFollowups: singlePassFlavorMode\(\) \? true/);

console.log('PASS: ordinary E→K stays neutral; flavor modes use primary authoring lanes and exclude the source-less Hongjin follow-up rewrite.');
