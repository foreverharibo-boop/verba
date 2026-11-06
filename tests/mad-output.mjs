import assert from 'node:assert/strict';
import { segmentSource,assembleTranslation } from '../core.js';
import { enforceMadKoreanOnly } from '../mad-output.js';
import { planPostReview,buildPostReviewPrompt } from '../post-review.js';
const settings={developerMadKoreanOutputEnabled:true,allDialoguePromptEnabled:false,allDialoguePrompt:'대사 한영병기',globalPromptEnabled:false,globalPrompt:'GLOBAL_BILINGUAL_SENTINEL'};
const cases=[
 ['He waited.','He waited.\n그는 기다렸다.','그는 기다렸다.'],
 ['He waited.','그는 기다렸다.\nHe waited.','그는 기다렸다.'],
 ['"Stay quiet."','"Stay quiet." [조용히 있어.]','"조용히 있어."'],
 ['*Stay quiet.*','*Stay quiet.* [조용히 있어.]','*조용히 있어.*'],
 ['"Stay quiet."','"Stay quiet. [조용히 있어.]"','"조용히 있어."'],
 ['"Stay quiet."','"조용히 있어. [Stay quiet.]"','"조용히 있어."'],
 ['*Stay quiet.*','*Stay quiet. (조용히 있어.)*','*조용히 있어.*'],
 ['**Stay quiet.**','**조용히 있어. (Stay quiet.)**','**조용히 있어.**'],
 ['[Stay quiet.]','[Stay quiet. 조용히 있어.]','[조용히 있어.]'],
 ['[Stay quiet.]','[조용히 있어. Stay quiet.]','[조용히 있어.]'],
 ['`Stay quiet.`','Stay quiet. [조용히 있어.]','조용히 있어.'],
 ['```text\nStay quiet.\n```','Stay quiet. [조용히 있어.]','조용히 있어.'],
 ['He waited.','He waited. [그는 기다렸다.]','그는 기다렸다.'],
 ['He waited.','그는 기다렸다. (He waited.)','그는 기다렸다.'],
 ['He waited.','그는 NASA에서 기다렸다.','그는 NASA에서 기다렸다.'],
 ['He waited.','He waited.','He waited.'],
 ['He waited.','He waited. [123]','He waited. [123]'],
 ['He waited.','다른 문장 [He waited.]','다른 문장'],
 ['He waited.','그는 기다렸다. [참고 사항]','그는 기다렸다. [참고 사항]'],
 ['He waited.','"Wait here." [기다려.]','"Wait here." [기다려.]'],
];
for(const [src,value,expected] of cases){
 const seg=segmentSource(src);const row=seg.segments[0];
 const map=new Map([[row.id,value]]);
 enforceMadKoreanOnly(seg,map,{});assert.equal(map.get(row.id),value,'disabled');
 enforceMadKoreanOnly(seg,map,settings);assert.equal(map.get(row.id),expected,src);
 enforceMadKoreanOnly(seg,map,settings);assert.equal(map.get(row.id),expected,'idempotent');
}
const source='<div class="card"><span>Stay quiet.</span></div>\n```js\nconst label = "Door locked.";\n```';
const seg=segmentSource(source);
const map=new Map(seg.segments.map(r=>[r.id,r.text.replace('Stay quiet.','Stay quiet. [조용히 있어.]').replace('Door locked.','Door locked. [문이 잠겼다.]')]));
enforceMadKoreanOnly(seg,map,settings);
const html=assembleTranslation(seg,map,{settings});
assert.match(html,/<div class="card"><span>조용히 있어\.<\/span><\/div>/);
assert.match(html,/const label = "문이 잠겼다\.";/);
const plan=planPostReview(seg,map,settings);

const prompt=buildPostReviewPrompt(plan,seg,settings);
assert.ok(!prompt.includes('대사 한영병기')&&!prompt.includes('GLOBAL_BILINGUAL_SENTINEL'));
assert.doesNotMatch(prompt,/MAD KOREAN-ONLY/);
console.log('PASS MAD output: pair orders, markers, off mode, idempotence, HTML/code safety, review authority');
