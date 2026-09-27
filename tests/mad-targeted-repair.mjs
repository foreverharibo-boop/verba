import assert from 'node:assert/strict';
import { runTasteQualityAudit } from '../taste-audit.js';
import { args } from './helpers/taste-fixtures.js';
for(const broken of ['missing','extra','empty','newline','banned','token']) {
 const a=args();a.settings={...a.settings,bannedWords:'금지어'};
 if(broken==='token'){a.segmented.segments=a.segmented.segments.map(r=>r.id==='n'?{...r,text:'He waited. @@VERBA_0000@@'}:r);a.translations.set('n','기다렸다. @@VERBA_0000@@');}
 const before=new Map(a.translations);
 const result=await runTasteQualityAudit({...a,requestSegments:async()=>{const m=new Map(a.translations);m.set('t','"이쪽으로 와."');if(broken==='missing')m.delete('o');if(broken==='extra')m.set('extra','추가');if(broken==='empty')m.set('o','');if(broken==='newline')m.set('o','싫어.\n싫다고.');if(broken==='banned')m.set('o','금지어');if(broken==='token')m.set('n','기다렸다.');return m;}});
 assert.ok(result.error,broken);assert.deepEqual(a.translations,before,broken+' rejects every edit atomically');
}
const a=args();const controller=new AbortController();a.options.signal=controller.signal;const before=new Map(a.translations);
await assert.rejects(()=>runTasteQualityAudit({...a,requestSegments:async()=>{controller.abort();return new Map(a.translations);}}),{name:'AbortError'});assert.deepEqual(a.translations,before);
console.log('PASS: invalid ids/empty/layout/banned/token results and cancellation never commit partial edits.');
