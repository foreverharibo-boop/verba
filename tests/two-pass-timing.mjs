import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputTiming, outputTimingText, runTimedOutput, sanitizeOutputTiming } from '../timing.js';

function fixture() {
    let t = 0;
    const clock = createOutputTiming({ now: () => t }); clock.setEnabled(true);
    return { clock, advance: n => t += n };
}
test('two phases and parallel first batches have separate, non-overlapping durations', () => {
    const { clock, advance } = fixture(); const job = clock.begin();
    const a = clock.enqueue(job, {stage: 'output-translation'}), b = clock.enqueue(job, {stage: 'output-translation'});
    clock.sent(job, a); clock.sent(job, b); advance(2000); clock.received(job, a); advance(1000); clock.received(job, b);
    const c = clock.enqueue(job, {stage: 'output-second-translation'}); clock.sent(job, c); advance(4000); clock.received(job, c);
    clock.finish(job, '완료'); const record = clock.latest();
    assert.equal(record.counts.total, 3);
    assert.equal(record.durations.primary, 3000); assert.equal(record.durations.secondary, 4000);
    assert.equal(Object.values(record.durations).reduce((a,b) => a+b), 7000);
    assert.match(outputTimingText(record), /1차 번역 응답 대기: 3.0초/);
    assert.match(outputTimingText(record), /2차 번역 응답 대기: 4.0초/);
});
test('server runner reports both requests, and browser displays server timings rather than zero AI calls', async () => {
    const { clock, advance } = fixture(); const events = [];
    const result = await runTimedOutput(clock, {debugMode:true,developerDeepseekKoreanEnabled:true}, 'PRIVATE_SOURCE', {}, async (_, options) => {
        for (const [stage, ms] of [['output-translation', 2000], ['output-second-translation', 3000]]) {
            const row = clock.enqueue(options.timing, {stage}); clock.sent(options.timing, row); advance(ms); clock.received(options.timing, row);
        }
        return {translation:'PRIVATE_RESULT'};
    }, e => events.push(e));
    assert.equal(result.translation, 'PRIVATE_RESULT'); assert.equal(events.length, 1);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
    const browser = fixture(); const job = browser.clock.begin();
    browser.advance(5100); browser.clock.attachServer(job, events[0].record); browser.clock.applying(job); browser.advance(100); browser.clock.finish(job, '완료');
    const text = outputTimingText(browser.clock.latest());
    assert.match(text, /화면 작업 5.2초/); assert.match(text, /서버 실행 기록/);
    assert.match(text, /1차 번역 응답 대기: 2.0초/); assert.match(text, /2차 번역 응답 대기: 3.0초/); assert.match(text, /AI 요청: 2회/);
    assert.doesNotMatch(text, /AI 요청: 0회/);
    const reused = browser.clock.begin(); browser.clock.attachServer(reused, events[0].record, true); browser.clock.finish(reused, '완료');
    assert.match(outputTimingText(browser.clock.latest()), /기존 서버 작업 결과 수신/);
});
test('missing server diagnostics, failure, cancellation and debug OFF are represented honestly', async () => {
    const {clock} = fixture(); const job=clock.begin(); clock.attachServer(job,null);clock.finish(job,'실패');
    assert.match(outputTimingText(clock.latest()), /실행 여부와 AI 요청 횟수는 확인할 수 없습니다/);
    assert.doesNotMatch(outputTimingText(clock.latest()), /AI 요청: 0회/);
    for (const [error,status] of [[Error('failed'),'실패'],[Object.assign(Error('cancel'),{name:'AbortError'}),'취소·전환']]) {
        let event;
        await assert.rejects(runTimedOutput(clock,{debugMode:true},'',{},async()=>{throw error;},e=>event=e), error);
        assert.equal(event.record.status,status);
    }
    await runTimedOutput(clock,{debugMode:false},'',{},async()=>({}),()=>assert.fail('debug off must not report'));
    assert.equal(sanitizeOutputTiming({}),null);
    assert.equal(sanitizeOutputTiming({totalMs:1,durations:{},counts:{},rows:[{label:'SECRET',reason:'SECRET',status:'SECRET'}],source:'SECRET'}).rows[0].label,'보조 요청');
});
