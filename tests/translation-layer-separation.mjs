import assert from 'node:assert/strict';
import { buildOutputPrompt } from '../core.js';
import { runTasteQualityAudit } from '../taste-audit.js';
import { args,settings } from './helpers/taste-fixtures.js';
const a=args();const segmented=a.segmented;
const plain=buildOutputPrompt(segmented,{globalPrompt:'GLOBAL'},'',a.speakerIdentity);assert.match(plain,/GLOBAL/);assert.doesNotMatch(plain,/MAD KOREAN|KIM HONG-JIN VOICE/);
const mad=buildOutputPrompt(segmented,{...settings,globalPrompt:'GLOBAL_SENTINEL'},'',a.speakerIdentity);assert.match(mad,/MAD KOREAN/);assert.doesNotMatch(mad,/GLOBAL_SENTINEL/);
for(const config of [{},{...settings,developerMadKoreanOutputEnabled:false,developerHongjinFlavorEnabled:false}]){const r=await runTasteQualityAudit({...args(config),requestSegments:()=>{throw Error('no flavor');}});assert.equal(r.skipped,'taste-off');}
console.log('PASS: ordinary translation, active flavor composition and optional review remain separate.');
