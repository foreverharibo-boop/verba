import assert from 'node:assert/strict';
import { runTasteQualityAudit, buildTasteAuditPrompt } from '../taste-audit.js';
import { args, settings, scope } from './helpers/taste-fixtures.js';
const a=args({...settings,developerMadKoreanOutputEnabled:false});let calls=0;
const result=await runTasteQualityAudit({...a,requestSegments:async(p,rows)=>{calls++;assert.deepEqual(rows.map(r=>r.id),['t']);const data=JSON.parse(p.split('\nAUDIT_ROWS\n')[1]);assert.equal(data[0].scope,'target_dialogue');assert.match(p,/current_translation/);return new Map([['t','"이쪽으로 와."']]);}});
assert.equal(calls,1);assert.equal(result.changed,1);assert.equal(a.translations.get('n'),'그는 기다렸다.');assert.equal(a.translations.get('o'),'"싫어."');
assert.throws(()=>buildTasteAuditPrompt('hongjin',{...a,segments:a.segmented.segments}),/confirmed TARGET/);
const b=args(a.settings);const skipped=await runTasteQualityAudit({...b,speakerScopes:{},requestSegments:()=>{throw Error('unknown cannot get voice');}});assert.equal(skipped.skipped,'no-eligible-segments');
console.log('PASS: Hongjin review only receives confirmed target dialogue.');
