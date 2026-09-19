import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { repairUnexpectedProseBreaks, repairSourceEllipses } from '../response-parser.js';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const defs = index.slice(index.indexOf('const RELATION_TEMPERATURE_OPTIONS'), index.indexOf('const baseContext ='));
const defaults = Function(defs + '\nreturn DEFAULT_SETTINGS;')();
const matrix = fs.readFileSync(new URL('./compressed-prompts.mjs', import.meta.url), 'utf8');
const {builders, identity} = Function(matrix.slice(matrix.indexOf('const identity ='), matrix.indexOf('const baseline =')) + '\nreturn {builders,identity};')();
let routes = 0;
for (const flags of [{}, {developerCompressedPromptEnabled:true}, {developerExtremeCompressedPromptEnabled:true}]) {
 for (const mad of [false,true]) for (const hongjin of [false,true]) {
  const settings = {...defaults, ...flags, developerMode:true, developerMadKoreanOutputEnabled:mad, developerHongjinFlavorEnabled:hongjin};
  for (const [name, build] of Object.entries(builders)) {
   const prompt = build(core, settings);
   if (name !== 'input') assert.doesNotMatch(prompt, /English-to-Korean|source English|source-English|English (?:wording|syntax|sentence|modifier|source|role\/title)|English-shaped|\ban source/);
   assert.doesNotMatch(prompt, /USER-DIRECTED INSULT FIREWALL|45\.72미터, never 50미터/);
   if (prompt.includes('USER-DIRECTED PROFANITY GUARD')) {
    assert.ok(hongjin);
    assert.match(prompt, /Applies only to TARGET CHARACTER dialogue/);
    assert.match(prompt, /Non-abusive rebukes and teasing/);
    assert.match(prompt, /not all criticism or teasing/);
    assert.match(prompt, /NO MISOGYNY|misogyny/i);
   }
   if (prompt.includes('KOREAN METRIC UNITS:')) {
    assert.ok(mad);
    assert.match(prompt,/50 yards → 50미터/);
    assert.match(prompt,/exact value matters.*convert accurately/);
    assert.match(prompt,/do not replace feet\/inches with meters while keeping their numbers/);
    assert.match(prompt,/uncertainty and ranges/);
   }
   routes++;
  }
  for (const source of ['彼は待っていた。「おいで。」','他等着。“过来。”','Il attendait. « Viens ici. »']) {
   const prompt = core.buildOutputPrompt(core.segmentSource(source), settings, '', identity);
   assert.doesNotMatch(prompt,/English-to-Korean|source English|English syntax|English wording/);
   assert.match(prompt,/Korean|한국어/);
  }
 }
}
const expression=index.match(/\.map\(candidate => (repairSourceEllipses\([^\n]+)\);/)[1];
const clean=Function('candidate','repairUnexpectedProseBreaks','repairKoreanParticleAlternatives','repairIndivisibleIdentityNames','speakerIdentity','expected','repairSourceEllipses','return '+expression);
const candidates=['첫째.\n다음.','둘째.<br>다음.','셋째.\n\n다음.'];
for (const source of ['one line','two\nlines','<div>protected</div>',String.fromCharCode(96,99,111,100,101,96)]) {
 const target=[{id:'seg_0000',type:'selection',text:source}];
 const actual=candidates.map(c=>clean(c,repairUnexpectedProseBreaks,x=>x,x=>x,{},target,repairSourceEllipses));
 assert.deepEqual(actual,source==='one line'?['첫째. 다음.','둘째. 다음.','셋째. 다음.']:candidates);
}
assert.doesNotMatch(index,/developerRegisterShiftMonitor|runDeveloperRegisterShiftMonitor|register-shift-monitor/);
console.log('PASS: '+routes+' prompt routes, multilingual source policies, profanity/metric scope, three-candidate local cleanup and removed register monitor. No live AI calls.');
