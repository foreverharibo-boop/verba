import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
import { speakerGuardCases, speakerLockSets } from '../../tests/fixtures/speaker-guards.js';

for (const [variant, create] of [['verba', verba], ['deep', deep]]) {
    for (const locks of speakerLockSets) for (const { source, expected } of speakerGuardCases) {
        test(`${variant}, ${locks.length} name locks: ${source}`, async () => {
            let requests = 0;
            const engine = create({
                settings: { profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false,
                    serverRetryLimit: 1, dialoguePrompt: 'TARGET_SENTINEL', otherDialoguePrompt: 'OTHER_SENTINEL', aiPostReview: {} },
                profiles: { A: {} }, nameLocks: locks,
                character: { name: 'Shin' }, context: { name1: 'Dana', name2: 'Shin' },
            }, async (_id, messages) => {
                requests++;
                const prompt = messages[0].content;
                const rows = JSON.parse(prompt.split('\nSEGMENTS\n').at(-1));
                assert.deepEqual(rows.filter(row => row.type === 'dialogue_candidate').map(row => row.speaker_scope), expected);
                assert.ok(prompt.includes('TARGET_SENTINEL') && prompt.includes('OTHER_SENTINEL'));
                return { content: JSON.stringify({ segments: rows.map(row => ({ id: row.id,
                    translation: row.type === 'dialogue_candidate' ? '"안녕."'
                        : `${(row.text.match(/@@VERBA_(?:DEEP_)?NAME_\d{4}@@/g) || []).join(' ')} 미소를 지었다.`.trim(),
                })) }) };
            });
            const result = await engine.output(source, { speakerIdentity: {
                characterName: '신', sourceCharacterName: 'Shin', userName: '다나', sourceUserName: 'Dana', characterGender: 'male', nameLocks: locks,
            } });
            assert.equal(requests, 1, 'guard must use the existing translation request');
            assert.ok(result.translation.includes('안녕'));
            assert.ok(!result.translation.includes('@@'));
        });
    }
}
