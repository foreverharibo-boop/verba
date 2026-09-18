
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const defs=index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'),index.indexOf('const baseContext ='));
const defaults=Function(defs+'\nreturn DEFAULT_SETTINGS;')();
const who={characterName:'홍진',userName:'담은',characterGender:'male'};
const segments=[{id:'seg_0000',type:'narration',text:'彼女は待った。'}];
for(const compression of [{},{developerCompressedPromptEnabled:true},{developerExtremeCompressedPromptEnabled:true}])for(const hongjin of [false,true]) {
 const s={...defaults,developerMode:true,...compression,developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:hongjin,developerMadKoreanTargetToUserRegister:'banmal',developerMadKoreanUserToTargetRegister:'jondaetmal'};
 for(const scope of ['mixed','narration','target_dialogue','other_dialogue','tagged_content']) {
  const p=core.buildScopedOutputPrompt({segments,sourceContext:'CONTEXT_SENTINEL',settings:s,scope,speakerIdentity:who});
  for(const rule of ['MANDATORY REAUTHORING','Discard source-language syntax/wording','within each id','TOP PRIORITY — NO MISOGYNY','.../…/……','0700시','50 yards→50미터','context-needed precision','TARGET→USER=반말','USER→TARGET=natural 해요체','playful honorifics','CONTEXT_SENTINEL'])assert.ok(p.includes(rule),rule);
  assert.ok(!p.includes('Discard English syntax/wording'));
  const off=core.buildScopedOutputPrompt({segments,sourceContext:'CONTEXT_SENTINEL',settings:{...s,developerMadKoreanOutputEnabled:false},scope,speakerIdentity:who});
  for(const removed of ['2026년/몇 년','Human pronouns→그/그녀','CLOSE-POV ROUGH DICTION','50 yards=45.72미터','네 부하들','compressed protein blocks','Intent example:']) assert.ok(!p.includes(removed),'removed from shortened prompt: '+removed);
  assert.ok(!off.includes('50 yards→50미터'));
  for(const result of [p,off]) assert.ok(result.includes('Name locks first; otherwise transliterate only human names to Hangul'));
  assert.equal(p.includes('KIM HONG-JIN VOICE'),hongjin&&['mixed','target_dialogue'].includes(scope));
  assert.equal(p.split('TOP PRIORITY — NO MISOGYNY').length,2);
  if(hongjin&&['mixed','target_dialogue'].includes(scope)) assert.ok(p.includes('USER-DIRECTED PROFANITY GUARD'));
 }
 const input=core.buildInputPrompt('안녕',s,'unknown',who);
 assert.ok(!input.includes('MANDATORY REAUTHORING')&&!input.includes('KIM HONG-JIN VOICE'));
}
const general=core.defaultBaseTranslationPrompt();
assert.ok(general.includes('replace source-language syntax with natural Korean'));
assert.ok(!general.includes('replace English syntax with natural Korean'));
console.log('PASS: User-approved MAD recomposition/punctuation/time/units/register/abuse guards across modes and scopes.');
