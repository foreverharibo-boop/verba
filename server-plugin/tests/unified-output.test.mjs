import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
for (const [name, create] of [['verba', verba], ['deep', deep]]) {
 test(`${name}: voice rules do not split narration, dialogue and code requests`, async () => {
  let calls = 0;
  const engine = create({settings: {profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,translateTaggedContent:true,dialoguePromptEnabled:true,dialoguePrompt:'Use terse speech.',otherDialoguePromptEnabled:true,otherDialoguePrompt:'Use polite speech.',dialogueEndingRepetitionReduction:true},profiles:{A:{}},nameLocks:[],character:{},context:{}}, async (_id,messages) => {
   calls++;
   const prompt=messages.map(x=>x.content).join('\n');
   const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>prompt.includes(x));
   assert.ok(marker,'no preliminary classification request');
   const rows=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));
   for (const type of ['narration','dialogue_candidate','code_content']) assert.ok(rows.some(x=>x.type===type),type);
   assert.ok(rows.filter(x=>x.type==='dialogue_candidate').every(x=>x.speaker_scope));
   return {content:JSON.stringify({segments:rows.map(x=>({id:x.id,translation:'여기에 있어.'}))})};
  });
  const result=await engine.output('He waited. "Stay here."\n\n`Wait here.`',{});
  assert.equal(calls,1);
  assert.match(result.translation,/`여기에 있어\.`/);
  assert.doesNotMatch(result.translation,/@@VERBA/);
 });
}
