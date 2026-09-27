import assert from 'node:assert/strict';
import { buildTasteAuditPrompt,runTasteQualityAudit } from '../taste-audit.js';
import { args, settings, segments } from './helpers/taste-fixtures.js';
const a=args({...settings,customTranslatorEnabled:true,customTranslatorModified:{mad:true,hongjin:true},customTranslatorTemplates:{mad:'MY_MAD',hongjin:'MY_HONGJIN'}});
const p=buildTasteAuditPrompt('mad',{...a,segments,sourceContext:a.segmented.protectedText});
for(const text of ['MY_MAD','MY_HONGJIN','PAIR SPEECH LOCK','NAME LOCK','홍진','담은','He waited.','그는 기다렸다.'])assert.ok(p.includes(text),text);
assert.match(p,/not a source-less rewrite/);assert.equal(JSON.parse(p.split('\nAUDIT_ROWS\n')[1]).length,5);
console.log('PASS: audit reuses active custom taste prose, current settings, identity and original source.');
