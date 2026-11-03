import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, assembleTranslation } from '../core.js';
import { reviewOutputOnce } from '../post-review.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';

const fixture = (source, drafts) => {
    const segmented = segmentSource(source);
    assert.equal(segmented.segments.length, drafts.length);
    return { segmented, translations: new Map(segmented.segments.map((s, i) => [s.id, drafts[i]])) };
};
const cfg = { debugMode:true, developerMode:true, developerDeepseekKoreanEnabled:true,
    aiPostReview:{ deepseekTranslationese:true, english:true, tokens:true, banned:true } };
const serialized = (data, stats) => {
    const report = createOutputComparison(data.segmented, true);
    report.postReview(stats);
    return sanitizeOutputComparison(report.finish(''), {summaryOnly:true}).postReview;
};

test('44-unit review: an invalid general edit cannot discard other valid narration and dialogue edits', async () => {
    const source = [...Array.from({length:26}, () => 'He waited.'), ...Array.from({length:18}, () => '"Stay quiet."')].join('\n\n');
    const drafts = [...Array(26).fill('그는 기다리는 것을 했다.'), ...Array(18).fill('"Stay quiet. (조용함을 유지해.)"')];
    const data = fixture(source, drafts);
    let calls = 0;
    const stats = await reviewOutputOnce({...data, settings:{...cfg, allDialoguePrompt:'All dialogue must preserve the original English and add the Korean translation in parentheses.'}, request:async (_prompt, rows) => {
        calls++;
        assert.equal(rows.length, 44);
        return new Map(rows.map((row, i) => [row.id, i === 0 ? '그는\n기다렸다.' : row.CURRENT.replace('기다리는 것을 했다', '기다렸다').replace('조용함을 유지해', '조용히 있어')]));
    }});
    assert.equal(calls, 1);
    assert.equal(stats.status, 'partial');
    assert.equal(stats.changed, 43);
    assert.equal(stats.rejected, 1);
    assert.equal([...data.translations.values()][0], drafts[0]);
    assert.ok([...data.translations.values()].slice(26).every(text => text === '"Stay quiet. (조용히 있어.)"'));
    const safe = serialized(data, stats);
    assert.equal(safe.status, 'partial');
    assert.equal(safe.reviewReason, 'partial-rejection');
    assert.deepEqual(safe.failures, [{segmentIndex:0, unitIndex:0, type:'general', reason:'invalid-general', detail:'protected-structure'}]);
    assert.doesNotMatch(JSON.stringify(safe), /Stay quiet|기다렸다|REVIEW_LOCK/);
});

test('general guard failures retain exact original segment and report only structural reasons', async () => {
    for (const [draft, replacement, checks, detail] of [
        ['기다렸다.', null, {}, 'not-string'],
        ['기다렸다.', ' ', {}, 'empty'],
        ['기다렸다.', '가'.repeat(1001), {}, 'length-limit'],
        ['기다렸다.', '"기다렸다."', {}, 'protected-structure'],
        ['기다렸다.', '기다렸다.</div>', {}, 'protected-structure'],
        ['@@VERBA_NAME_0000@@ 기다렸다.', '기다렸다.', {}, 'protected-tokens'],
        ['기다렸다.', '기다렸다. Hello', {}, 'added-latin'],
        ['기다렸다.', '기다렸다. @@VERBA_0000@@', {tokens:true}, 'protected-tokens'],
    ]) {
        const data = fixture('He waited.\n\nHe rested.', [draft, '그는 쉬는 것을 했다.']);
        const stats = await reviewOutputOnce({...data, settings:{debugMode:true, aiPostReview:{translationese:true, ...checks}},
            request:async (_p, rows) => new Map(rows.map((r,i) => [r.id, i === 0 ? replacement : '그는 쉬었다.']))});
        assert.equal(stats.status, 'partial', detail);
        assert.equal(stats.failures[0].detail, detail);
        assert.deepEqual([...data.translations.values()], [draft, '그는 쉬었다.']);
    }
});

test('prose and multiple bilingual spans in one segment remain atomic when a later span is damaged', async () => {
    const data = fixture('He waited. *Stay quiet.* Then he said *Go now.*\n\nHe rested.',
        ['그는 기다리는 것을 했다. *Stay quiet. [조용함을 유지해.]* 그리고 말했다. *Go now. [지금 가.]*', '그는 쉬는 것을 했다.']);
    const before = [...data.translations.values()];
    const stats = await reviewOutputOnce({...data, settings:{...cfg, globalPrompt:'Inside italics, preserve the original English and add Korean in brackets. Everything outside italics is Korean only.'}, request:async (_p, rows) => {
        assert.equal(rows.length, 4);
        return new Map(rows.map(row => [row.id, row.CURRENT.replace('기다리는 것을 했다','기다렸다').replace('조용함을 유지해','조용히 있어').replace('Go now.', 'Leave now.').replace('쉬는 것을 했다','쉬었다')]));
    }});
    assert.equal(stats.status, 'partial');
    assert.equal(stats.changed, 1);
    assert.equal([...data.translations.values()][0], before[0]);
    assert.equal([...data.translations.values()][1], '그는 쉬었다.');
    assert.equal(stats.failures[0].reason, 'invalid-bilingual');
});

test('missing or duplicate locks never leak into output or block independent segments', async () => {
    for (const replacement of ['', '@@REVIEW_LOCK_0000@@@@REVIEW_LOCK_0000@@']) {
        const data = fixture('He waited. *Stay quiet.*\n\nHe rested.', ['그는 기다렸다. *Stay quiet. [조용히 있어.]*','그는 쉬는 것을 했다.']);
        const before = [...data.translations.values()][0];
        const stats = await reviewOutputOnce({...data, settings:{debugMode:true, aiPostReview:{translationese:true}, globalPrompt:'Inside italics, preserve the original English and add Korean in brackets.'}, request:async (_p, rows) => new Map(rows.map(r => [r.id, r.CURRENT.replace('@@REVIEW_LOCK_0000@@',replacement).replace('쉬는 것을 했다','쉬었다')]))});
        assert.equal(stats.status,'partial');
        assert.equal(stats.failures[0].detail,'protected-tokens');
        assert.equal([...data.translations.values()][0],before);
        assert.doesNotMatch(assembleTranslation(data.segmented,data.translations), /@@REVIEW_LOCK_/);
    }
});

test('all rejected, or rejected plus unchanged units, remain failed rather than completed', async () => {
    for (const all of [false,true]) {
        const data=fixture('He waited.\n\nHe rested.',['그는 기다렸다.','그는 쉬었다.']);
        const before=[...data.translations];
        const stats=await reviewOutputOnce({...data, settings:cfg, request:async (_p,rows)=>new Map(rows.map((r,i)=>[r.id, all||i===0?r.CURRENT+'\n':r.CURRENT]))});
        assert.equal(stats.status,'failed');assert.equal(stats.changed,0);assert.equal(stats.rejected,all?2:1);
        assert.deepEqual([...data.translations],before);
    }
});

test('request failure, incomplete map, and abort never apply a partial response or retry', async () => {
    for (const mode of ['network','missing','extra','abort']) {
        const data=fixture('He waited.\n\nHe rested.',['그는 기다리는 것을 했다.','그는 쉬는 것을 했다.']);
        const before=[...data.translations];const controller=new AbortController();let calls=0;
        const run=()=>reviewOutputOnce({...data,settings:cfg,options:{signal:controller.signal},request:async (_p,rows)=>{
            calls++;if(mode==='network')throw Error('PRIVATE RESPONSE');
            if(mode==='abort')controller.abort();
            const result=new Map(rows.map(r=>[r.id,'고쳐진 문장.']));
            if(mode==='missing')result.delete(rows[0].id);
            if(mode==='extra')result.set('unexpected','추가');
            return result;
        }});
        if(mode==='abort')await assert.rejects(run(),{name:'AbortError'});
        else assert.equal((await run()).status,'failed');
        assert.equal(calls,1);assert.deepEqual([...data.translations],before);
    }
});

test('failure diagnostics are bounded and sanitized again in server summaries', async () => {
    const data=fixture(Array(40).fill('He waited.').join('\n\n'),Array(40).fill('그는 기다렸다.'));
    const stats=await reviewOutputOnce({...data,settings:cfg,request:async (_p,rows)=>new Map(rows.map(r=>[r.id,r.CURRENT+'\n']))});
    assert.equal(stats.rejected,40);assert.equal(stats.failures.length,32);assert.equal(stats.failuresOmitted,8);
    assert.equal(serialized(data,stats).failuresOmitted,8);
    const safe=serialized(data,{...stats,failures:Array(40).fill({segmentIndex:0,unitIndex:0,type:'SECRET',reason:'SECRET',detail:'SECRET',text:'SECRET'}),failuresOmitted:0});
    assert.equal(safe.failures.length,32);assert.equal(safe.failuresOmitted,8);
    assert.doesNotMatch(JSON.stringify(safe),/SECRET/);
    const noDebug=await reviewOutputOnce({...fixture('He waited.',['그는 기다렸다.']),settings:{aiPostReview:{translationese:true}},request:async (_p,rows)=>new Map(rows.map(r=>[r.id,r.CURRENT+'\n']))});
    assert.equal(noDebug.status,'failed');assert.equal(noDebug.failures,undefined);
});
