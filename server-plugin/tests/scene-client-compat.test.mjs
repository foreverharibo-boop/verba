import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSourceChange, compatibleCompletedSource, reconcileCompletedResult, hasVerifiedSceneReport } from '../../server-result-compat.js';

test('matching Ttotto removal is the only eligible scene cleanup',()=>{
 const block='<scene_state>{"_v":2,"scene":{"location":"sofa"},"heat":7}</scene_state>';
 const source='Narrative.\n\n'+block+'\n\n<Info_panel>Keep</Info_panel>';
 const final='Narrative.\n\n\n\n<Info_panel>Keep</Info_panel>';
 assert.equal(hasVerifiedSceneReport(source),true);
 assert.equal(hasVerifiedSceneReport(final),false);
 assert.equal(compatibleCompletedSource(source,final),true);
 assert.equal(describeSourceChange(source,final).relation,'closed-scene-report-removed');
 const translated='번역.\n\n'+block+'\n\n<Info_panel>Keep</Info_panel>';
 const result=reconcileCompletedResult(source,final,{translation:translated,sourceMap:[]});
 assert.equal(result.translation,'번역.\n\n\n\n<Info_panel>Keep</Info_panel>');
 assert.equal(reconcileCompletedResult(source,final,result),null,
     'do not guess cleanup when translated tag is already missing');
 for(const invalid of [
  'Narrative altered.\n\n\n\n<Info_panel>Keep</Info_panel>',
  'Narrative.\n\n\n\n<Info_panel>Other</Info_panel>',
  'Narrative.',
 ])assert.equal(compatibleCompletedSource(source,invalid),false);
});
test('partial tags, arbitrary markup and real deletions are never automatically trusted',()=>{
 const invalid='Narrative <scene_state>not JSON</scene_state> still here';
 const incomplete='Narrative <scene_state>{"scene":{}}';
 assert.equal(hasVerifiedSceneReport(invalid),false);
 assert.equal(hasVerifiedSceneReport(incomplete),false);
 assert.equal(compatibleCompletedSource(invalid,'Narrative  still here'),false);
 assert.equal(compatibleCompletedSource(incomplete,'Narrative'),false);
});
