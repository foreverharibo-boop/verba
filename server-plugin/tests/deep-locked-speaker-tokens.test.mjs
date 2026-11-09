import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engines/verba-deep.mjs';

const cases = [
    ['Shin smiled. "Hello."', 'target_dialogue'],
    ['Dana smiled. "Hello."', 'other_dialogue'],
    ['"Hello," Shin said.', 'target_dialogue'],
    ['"Hello," Dana said.', 'other_dialogue'],
    ['"Hello," said Shin.', 'target_dialogue'],
    ['"Hello," said Dana.', 'other_dialogue'],
    ['"Hello."', 'unknown_dialogue'],
];

for (const locked of [false, true]) for (const [source, expected] of cases) {
    test(`deep engine name locks ${locked}: ${source}`, async () => {
        let requests = 0;
        const engine = createEngine({
            settings: { profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false,
                serverRetryLimit: 1, dialoguePrompt: 'TARGET_VOICE_SENTINEL', aiPostReview: {} },
            profiles: { A: {} },
            nameLocks: locked ? [{ source: 'Shin', target: '신' }, { source: 'Dana', target: '다나' }] : [],
            character: { name: 'Shin' }, context: { name1: 'Dana', name2: 'Shin' },
        }, async (_id, messages) => {
            requests++;
            const prompt = messages[0].content;
            const rows = JSON.parse(prompt.split('\nSEGMENTS\n').at(-1));
            assert.equal(rows.find(row => row.type === 'dialogue_candidate').speaker_scope, expected);
            assert.ok(prompt.includes('TARGET_VOICE_SENTINEL'));
            return { content: JSON.stringify({ segments: rows.map(row => ({ id: row.id,
                translation: row.type === 'dialogue_candidate' ? '"안녕."'
                    : `${(row.text.match(/@@VERBA_DEEP_NAME_\d{4}@@/g) || []).join(' ')} 미소를 지었다.`.trim(),
            })) }) };
        });
        const output = await engine.output(source, { speakerIdentity: {
            characterName: '신', sourceCharacterName: 'Shin', userName: '다나', sourceUserName: 'Dana', characterGender: 'male',
        } });
        assert.equal(requests, 1, 'speaker recognition must not introduce a separate AI call');
        assert.ok(output.translation.includes('안녕'));
        assert.ok(!output.translation.includes('@@'));
    });
}
