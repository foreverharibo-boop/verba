import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildHongjinVoiceRewritePrompt,
    buildMadKoreanTargetedAuditPrompt,
    buildOutputPrompt,
    segmentSource,
} from '../core.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const identity = {
    characterName: '김홍진',
    userName: '담은',
    characterGender: 'male',
    nameLocks: [{ source: 'Dam-eun', target: '담은' }],
};
const settings = {
    ...defaults,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'natural',
};

const source = 'The overpass ramp rose ahead. "Keep your voice down," he said.';
const segmented = segmentSource(source);
const outputPrompt = buildOutputPrompt(segmented, settings, '', identity);
assert.match(outputPrompt, /MANDATORY BLANK-PAGE REWRITING/);
assert.match(outputPrompt, /Destroy and discard every source word choice/);
assert.match(outputPrompt, /write the passage again from a blank page/);
assert.match(outputPrompt, /only content boundary/i);

const targetRows = segmented.segments.filter(row => row.type === 'dialogue_candidate');
const voicePrompt = buildHongjinVoiceRewritePrompt({
    segments: targetRows,
    currentTranslations: new Map(targetRows.map(row => [row.id, '"목소리 낮춰."'])),
    sourceContext: source,
    speakerIdentity: identity,
    settings,
});
assert.match(voicePrompt, /BLANK-PAGE DIALOGUE REWRITING/i);
assert.match(voicePrompt, /Never aim a person-directed curse at USER/);
assert.match(voicePrompt, /Never aim a person-directed curse at USER/);
assert.match(voicePrompt, /ACROSS THE FULL DIALOGUE SET/i);

const auditSegments = [
    { id: 'd0', type: 'dialogue_candidate', outputScope: 'target_dialogue', text: '"Keep your voice down."' },
    { id: 'n0', type: 'narration', outputScope: 'narration', text: 'A long gray ramp rose ahead.' },
    { id: 'n1', type: 'narration', outputScope: 'narration', text: 'The strap was too long for Dam-eun\'s frame.' },
];
const auditPrompt = buildMadKoreanTargetedAuditPrompt({
    segments: auditSegments,
    currentTranslations: new Map([
        ['d0', '"말 조용히 해, 새끼야."'],
        ['n0', '길다란 회색 램프가 앞에 솟았다.'],
        ['n1', '어깨끈이 담은이 몸집에 비해 너무 길었다.'],
    ]),
    sourceContext: auditSegments.map(row => row.text).join('\n'),
    speakerIdentity: identity,
    settings,
});
assert.match(auditPrompt, /VERIFY_USER_DIRECTED_PROFANITY/);
assert.match(auditPrompt, /ROAD_RAMP_MISTRANSLATED_AS_LAMP/);
assert.match(auditPrompt, /POSSIBLE_NAME_PARTICLE_OR_POSSESSIVE_DAMAGE/);
assert.match(auditPrompt, /never return an unchanged flagged USER-directed insult/i);

console.log('PASS: live-output regressions cover translationese, ramp polysemy, name possessive damage, serious-line profanity quotas and USER-directed insults.');
