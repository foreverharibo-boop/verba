import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';
const source = '*Stay quiet.*\n<div class="card"><div>Weather: Clear</div><div><span>Location: Home</span><br>Door locked.</div></div>';
const tags = text => text.match(/<[^>]+>/g) || [];
for (const [variant, create] of [['verba',verba],['deep',deep]]) {
    for (const [mode, extra] of [['normal',{}],['minimal',{developerMode:true,developerMinimalPromptEnabled:true}],['split',{developerMode:true,developerOutputSplitCount:2}],['compressed',{developerMode:true,developerCompressedPromptEnabled:true}]]) {
        test(`${variant}/${mode}: nested HTML survives a token-dropping provider and bilingual review`, async () => {
            let reviews = 0;
            const engine = create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode:true,
                globalPrompt:'Inside italics, preserve original English and add Korean in brackets. Everything outside italics must be Korean only.',...extra},profiles:{A:{}},nameLocks:[],character:{},context:{}}, async (_id, messages) => {
                const text = messages.map(m=>m.content).join('\n');
                if (text.includes('\nBILINGUAL_TARGETS\n')) {
                    reviews++;
                    const rows=JSON.parse(text.split('\nBILINGUAL_TARGETS\n')[1]);
                    assert.equal(rows.length,1);
                    return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:'*Stay quiet. [조용히 있어.]*'}))})};
                }
                const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));
                assert.ok(marker,'unexpected auxiliary AI request');
                const rows=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
                return {content:JSON.stringify({segments:rows.map(r=>{
                    const src=r.text??r.source;
                    assert.doesNotMatch(src,/<\/?div|@@VERBA_(?:DEEP_)?\d{4}@@/);
                    return {id:r.id,translation:src.includes('*')?'*조용히 있어. [조용히 있어.]*':'번역문'};
                })})};
            });
            const result=await engine.output(source,{});
            assert.equal(reviews,1);
            assert.deepEqual(tags(result.translation),tags(source));
            assert.match(result.translation,/<div class="card"><div>번역문<\/div><div><span>번역문<\/span><br>번역문<\/div><\/div>/);
            assert.match(result.translation,/\*Stay quiet\. \[조용히 있어\.\]\*/);
            assert.equal(result.outputComparison.stages.find(s=>s.stage==='markup-integrity').changedRows,0);
        });
    }
    test(`${variant}: invented closing tag falls back only the damaged text and is diagnosed`, async () => {
        const engine=create({settings:{profileId:'A',autoProfileFallback:false,serverRetryLimit:1,debugMode:true},profiles:{A:{}},nameLocks:[],character:{},context:{}},async(_id,messages)=>{
            const text=messages.map(m=>m.content).join('\n');
            const marker=['\nTARGETS\n','\nSEGMENTS\n','\nTRANSLATION TARGETS\n'].find(x=>text.includes(x));
            assert.ok(marker);
            const rows=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length));
            return {content:JSON.stringify({segments:rows.map(r=>({id:r.id,translation:(r.text??r.source)==='Hello'?'안녕</div>':'바깥.'}))})};
        });
        const result=await engine.output('<div>Hello</div> Outside.',{});
        assert.equal(result.translation,'<div>Hello</div> 바깥.');
        assert.equal(result.outputComparison.stages.find(s=>s.stage==='markup-integrity').changedRows,1);
    });
}
