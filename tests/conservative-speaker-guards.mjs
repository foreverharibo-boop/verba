import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, resolveOutputSpeakerIdentity, inferLocalTargetDialogueScopes, buildOutputPrompt } from '../core.js';
import { speakerGuardCases, speakerLockSets } from './fixtures/speaker-guards.js';

for (const locks of speakerLockSets) for (const { source, expected } of speakerGuardCases) {
    test(`${locks.length} name locks: ${source}`, () => {
        const identity = resolveOutputSpeakerIdentity({ characterName: 'Shin', userName: 'Dana', characterGender: 'male' }, locks);
        const segmented = segmentSource(source, locks, { speakerIdentity: identity });
        const scopes = inferLocalTargetDialogueScopes(segmented, identity);
        const actual = segmented.segments.filter(row => row.type === 'dialogue_candidate').map(row => scopes[row.id]);
        assert.deepEqual(actual, expected);
        const prompt = buildOutputPrompt(segmented, { dialoguePrompt: 'TARGET_SENTINEL', otherDialoguePrompt: 'OTHER_SENTINEL' }, '', identity, null, scopes);
        const payload = JSON.parse(prompt.split('\nSEGMENTS\n').at(-1));
        assert.deepEqual(payload.filter(row => row.type === 'dialogue_candidate').map(row => row.speaker_scope), expected);
        assert.ok(prompt.includes('TARGET_SENTINEL') && prompt.includes('OTHER_SENTINEL'));
    });
}

for (const characterName of ['Jean de la Fontaine', 'John Smith', 'shin', '김홍진']) {
    test(`known full name remains confirmed: ${characterName}`, () => {
        const identity = resolveOutputSpeakerIdentity({ characterName, userName: 'Dana' });
        const segmented = segmentSource(`${characterName} said, "Stay."`, [], { speakerIdentity: identity });
        assert.deepEqual(Object.values(inferLocalTargetDialogueScopes(segmented, identity)), ['target_dialogue']);
    });
}
