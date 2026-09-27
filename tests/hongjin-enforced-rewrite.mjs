import assert from 'node:assert/strict';
import { runTasteQualityAudit } from '../taste-audit.js';
import { POST_TRANSLATION_AI_REPAIR_ENABLED } from '../minimal-output.js';
import { args, settings } from './helpers/taste-fixtures.js';
assert.equal(POST_TRANSLATION_AI_REPAIR_ENABLED,false);
for(const config of [{},{...settings,developerMadKoreanOutputEnabled:false},settings]) {
 const a=args(config);const before=new Map(a.translations);let calls=0;
 const result=await runTasteQualityAudit({...a,enabled:POST_TRANSLATION_AI_REPAIR_ENABLED,requestSegments:async()=>{calls++;throw Error('Must not call');}});
 assert.equal(calls,0);assert.deepEqual(a.translations,before);assert.equal(result.skipped,'disabled');
}
const a=args({...settings,developerMadKoreanOutputEnabled:false});let calls=0;
const result=await runTasteQualityAudit({...a,requestSegments:async(_p,rows)=>{calls++;return new Map(rows.map(r=>[r.id,a.translations.get(r.id)]));}});
assert.equal(calls,1);assert.equal(result.changed,0,'compliant text does not trigger forced rewrites or retries');
console.log('PASS: common OFF gate makes zero requests; unchanged compliant voice is accepted.');
