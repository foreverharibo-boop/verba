import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';

const snapshot = settings => ({
  settings: { profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false, serverRetryLimit: 1, developerMinimalPromptEnabled: false, developerMode: false, dialogueEndingRepetitionReduction: false, ...settings },
  profiles: { A: {} },
  nameLocks: [{ source: 'Dana', target: '다나' }],
  character: { name: 'Chris' },
  context: { name1: 'Dana', name2: 'Chris' },
});

function transportFor({ verdict = null } = {}) {
  const calls = [];
  const transport = async (_id, messages, maxTokens) => {
    const prompt = String(messages?.[0]?.content || '');
    calls.push({ prompt, maxTokens });
    if (prompt.includes('bilingual_0000')) {
      assert.equal(maxTokens, 512);
      return { content: JSON.stringify({ segments: [{ id: 'bilingual_0000', translation: verdict === true ? 'true' : 'false' }] }) };
    }
    const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"(seg_\d+)"/g)].map(match => match[1]))];
    const name = prompt.match(/@@VERBA_(?:DEEP_)?NAME_\d+@@/)?.[0] || '다나';
    return { content: JSON.stringify({ segments: ids.map(id => ({ id, translation: `안녕, ${name}.` })) }) };
  };
  return { calls, transport };
}

for (const [name, createEngine] of [['verba', verba], ['deep', deep]]) {
  test(name + ' keeps explicit bilingual denial Korean-only', async () => {
    const { calls, transport } = transportFor();
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'Bilingual dialogue should not be used. Korean translation only.' }), transport);
    const result = await engine.output('"Hi, Dana."', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), false);
    assert.equal(calls.some(call => call.maxTokens === 512), false);
  });

  test(name + ' preserves explicit bilingual output', async () => {
    const { transport } = transportFor();
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'For dialogue, always output both the original English and its Korean translation.' }), transport);
    const result = await engine.output('"Hi, Dana."', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), true);
    assert.equal(result.translation.includes('다나'), true);
  });

  test(name + ' uses one bounded verdict request for uncertain bilingual wording', async () => {
    const { calls, transport } = transportFor({ verdict: true });
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'Bilingual.' }), transport);
    const result = await engine.output('"Hi, Dana."', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), true);
    assert.equal(calls.filter(call => call.maxTokens === 512).length, 1);
  });
}
