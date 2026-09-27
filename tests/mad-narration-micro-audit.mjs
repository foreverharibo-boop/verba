import assert from 'node:assert/strict';
import { runTasteQualityAudit } from '../taste-audit.js';
import { args,settings } from './helpers/taste-fixtures.js';
const a=args({...settings,developerHongjinFlavorEnabled:false});
const r=await runTasteQualityAudit({...a,requestSegments:async(p,rows)=>{assert.match(p,/native Korean phrasing, calques, collocations/);assert.match(p,/damaged particles/);const map=new Map(a.translations);map.set('n','그는 잠자코 기다렸다.');return map;}});
assert.equal(r.changed,1);assert.equal(a.translations.get('t'),'"이리 와."');
const before=new Map(a.translations);const r2=await runTasteQualityAudit({...a,requestSegments:async()=>{throw Error('provider failure');}});assert.equal(r2.changed,0);assert.ok(r2.error);assert.deepEqual(a.translations,before);
console.log('PASS: source-grounded MAD review handles narration and retains draft on request failure.');
