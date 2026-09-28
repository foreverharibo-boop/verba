import assert from 'node:assert/strict';
import { buildTasteAuditPrompt,runTasteQualityAudit } from '../taste-audit.js';
import { args, settings } from './helpers/taste-fixtures.js';
const a=args();let calls=0;
const result=await runTasteQualityAudit({...a,requestSegments:async(p,rows)=>{calls++;assert.equal(rows.length,5);assert.match(p,/MAD CHECK/);assert.match(p,/HONGJIN SCOPE/);assert.match(p,/scope=target_dialogue/);assert.match(p,/PAIR SPEECH LOCK/);return new Map(a.translations);}});
assert.equal(calls,1,'both tastes share one source-grounded audit');assert.equal(result.changed,0);
for(const config of [{developerMode:true,chuseokGalbwaeScope:'all'},{translationEngine:'google-free'},{developerMode:true,developerMinimalPromptEnabled:true}]) {
 const a=args({...settings,...config});const r=await runTasteQualityAudit({...a,requestSegments:()=>{throw Error('excluded');}});assert.equal(r.skipped,'ineligible-mode');
}
console.log('PASS: combined MAD/Hongjin scopes and exclusive/minimal/free-engine exclusions.');
