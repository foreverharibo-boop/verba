import assert from 'node:assert/strict';
import { buildScopedOutputPrompt } from '../core.js';
import { buildTasteAuditPrompt } from '../taste-audit.js';
import { args,segments,settings,identity } from './helpers/taste-fixtures.js';
const prompts=['low','natural','high'].map(level=>buildScopedOutputPrompt({segments,settings:{...settings,developerHongjinProfanity:level},scope:'target_dialogue',speakerIdentity:identity}));
assert.equal(new Set(prompts).size,3);
for(const p of prompts){assert.match(p,/no profanity directed at USER/);assert.match(p,/situation\/self\/NPC swearing allowed/);assert.match(p,/NO MISOGYNY/);}
const a=args();const audit=buildTasteAuditPrompt('mad',{...a,segments});assert.match(audit,/distinguish the listener from the target of a curse/);assert.match(audit,/Do not rewrite merely for variety or enforce profanity quotas/);
console.log('PASS: current profanity strengths, user-target guard and source-grounded review.');
