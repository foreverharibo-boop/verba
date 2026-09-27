import assert from 'node:assert/strict';
import { buildTasteAuditPrompt,runTasteQualityAudit } from '../taste-audit.js';
import { args } from './helpers/taste-fixtures.js';
const a=args();a.segmented.segments=[{id:'n',type:'narration',text:'The road ramp rose ahead.'},{id:'t',type:'dialogue_candidate',text:'"Keep your voice down."'}];a.translations=new Map([['n','도로 램프가 앞에 솟았다.'],['t','"목소리 낮춰."']]);
const r=await runTasteQualityAudit({...a,requestSegments:async(p,rows)=>{const data=JSON.parse(p.split('\nAUDIT_ROWS\n')[1]);assert.equal(data[0].source,'The road ramp rose ahead.');assert.equal(data[0].current_translation,'도로 램프가 앞에 솟았다.');assert.match(p,/Resolve ambiguous words from source context/);assert.match(p,/serious emotion/i);return new Map([['n','도로 경사로가 앞에 솟았다.'],['t','"목소리 낮춰."']]);}});
assert.equal(r.changed,1);assert.equal(a.translations.get('n'),'도로 경사로가 앞에 솟았다.');
console.log('PASS: recorded-style defect is sent with source/draft evidence and mock correction applied; no live AI quality claim.');
