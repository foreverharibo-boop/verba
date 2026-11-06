import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as verba} from '../engines/verba.mjs';
import {createEngine as deep} from '../engines/verba-deep.mjs';
for(const [name,create] of [['verba',verba],['deep',deep]]) for(const enabled of [false,true]) {
 test(`${name}: long review after second translation respects general fluency toggle=${enabled}`,async()=>{
  const longStyle='STYLE_START '+ 'Use the established speaker register. '.repeat(3600)+' STYLE_END';
  const settings={profileId:'A',activeProfileSlot:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode:true,developerMode:true,
   developerDeepseekKoreanEnabled:true,developerSecondTranslationEnabled:true,
   customTranslatorEnabled:true,customTranslatorTemplates:{output:longStyle},customTranslatorModified:{output:true},
   aiPostReview:{meaning:true,voice:true,translationese:enabled,deepseekTranslationese:true}};
  const before=structuredClone(settings);let first=0,second=0,reviews=0;
  const engine=create({settings,profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
   const p=messages.map(m=>m.content).join('\n');
   if(p.startsWith('UNIFIED OUTPUT POST REVIEW')) {
    reviews++;assert.ok(p.length>120000);assert.ok(p.includes(longStyle));
    const rows=JSON.parse(p.split('\nREVIEW_UNITS\n')[1]);
    assert.ok(rows.every(r=>r.checks.includes('translationese')===enabled&&!r.checks.includes('deepseekTranslationese')));
    assert.equal(rows[0].CURRENT,'그녀가 기다리는 것을 했다.');
    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:enabled?'그녀는 기다렸다.':r.CURRENT}))})};
   }
   const rewrite=p.startsWith('SECOND TRANSLATION');if(rewrite)second++;else first++;
   const rows=JSON.parse(p.slice(p.lastIndexOf('\nSEGMENTS\n')+'\nSEGMENTS\n'.length));
   return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:rewrite?'그녀가 기다리는 것을 했다.':'그녀가 기다렸다.'}))})};
  });
  const result=await engine.output('She waited.');
  assert.equal(first,1);assert.equal(second,1);assert.equal(reviews,1);
  assert.equal(result.translation,enabled?'그녀는 기다렸다.':'그녀가 기다리는 것을 했다.');
  assert.equal(result.outputComparison.postReview.status,'completed');
  assert.deepEqual(settings,before);
 });
}
