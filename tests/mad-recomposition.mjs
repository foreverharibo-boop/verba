
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const defs=index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'),index.indexOf('const baseContext ='));
const defaults=Function(defs+'\nreturn DEFAULT_SETTINGS;')();
const who={characterName:'홍진',userName:'담은',characterGender:'male'};
const segments=[{id:'seg_0000',type:'narration',text:'She waited.'}];
for(const compression of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}])for(const hongjin of [false,true]) {
 const s={...defaults,developerMode:true,...compression,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:hongjin,developerMadKoreanTargetToUserRegister:'banmal',developerMadKoreanUserToTargetRegister:'jondaetmal'};
 for(const scope of ['mixed','narration','target_dialogue','other_dialogue','tagged_content']) {
  const p=core.buildScopedOutputPrompt({segments,sourceContext:'CONTEXT_SENTINEL',settings:s,scope,speakerIdentity:who});
  for(const rule of ['MANDATORY REAUTHORING','within each id','TOP PRIORITY — NO MISOGYNY','2026년/몇 년','he/him=그','she/her=그녀','Omit only when genuinely more natural','.../…/……','0700시','50 yards=45.72미터','네 부하들','CLOSE-POV ROUGH DICTION','TARGET→USER=반말','USER→TARGET=natural 해요체','playful honorifics','CONTEXT_SENTINEL'])assert.ok(p.includes(rule),rule);
  assert.equal(p.includes('KIM HONG-JIN VOICE'),hongjin&&['mixed','target_dialogue'].includes(scope));
  assert.equal(p.split('TOP PRIORITY — NO MISOGYNY').length,2);
  if(hongjin&&['mixed','target_dialogue'].includes(scope)) assert.ok(p.includes('USER-DIRECTED INSULT FIREWALL'));
 }
 const input=core.buildInputPrompt('안녕',s,'unknown',who);
 assert.ok(!input.includes('MANDATORY REAUTHORING')&&!input.includes('KIM HONG-JIN VOICE'));
}
console.log('PASS: MAD facts/recomposition/pronouns/punctuation/time/units/register/abuse guards across modes and scopes.');
