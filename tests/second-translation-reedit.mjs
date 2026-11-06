import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestSecondTranslation, reeditDecision, acceptReedit } from '../second-translation.js';
import { cleanSecondTranslationDiagnostic, createSecondTranslationTrace, createSecondTranslationAttempt } from '../second-translation-diagnostics.js';

const draft = '그는 오래된 도서관의 창문 앞에 서서 비가 그치기를 기다렸다. 건너편 골목에는 우산을 든 사람들이 천천히 지나가고 있었으며 책상 위에 놓인 편지에는 아직 답장을 쓰지 못한 채였다. 그는 종이를 다시 펼쳐 마지막 문장을 읽었다. 저녁이 가까워지자 실내의 그림자가 조금씩 길어졌다.';
const edited = '비가 그치기를 기다리며 그는 오래된 도서관 창가에 서 있었다. 길 건너 골목으로 우산을 쓴 사람들이 천천히 지나갔다. 책상에 놓인 편지에는 아직 답하지 못했다. 그는 편지를 펼쳐 마지막 문장을 다시 읽었다. 어느새 저녁이 가까워져 실내에 드리운 그림자가 조금씩 길어지고 있었다.';
const segments = [{id:'long',type:'narration',text:'A visitor waited in the library.'},
    {id:'short',type:'narration',text:'Rain.'}, {id:'dialogue',type:'dialogue_candidate',text:'He spoke.'},
    {id:'panel',type:'tagged_content',text:'A panel.'}, {id:'code',type:'narration',codeKind:'inline',text:'A code string.'}];
const translations = new Map(segments.map(s => [s.id,s.id === 'short' ? '비.' : draft]));
const segmented = {source: 'A visitor waited in the library. He spoke.',segments};

test('reuse detector selects long narration and ignores punctuation/spacing edits, dialogues, tags, code and short lines', () => {
    assert.equal(reeditDecision(segments[0],draft,draft.replaceAll(' ', '').replaceAll('.', '!')).selected,true);
    assert.equal(reeditDecision(segments[0],draft,draft.replace('창문','창가').replace('골목','거리')).selected,true);
    assert.equal(reeditDecision(segments[0],draft,edited).selected,false);
    for (const s of segments.slice(1)) assert.equal(reeditDecision(s,translations.get(s.id),translations.get(s.id)).selected,false,s.id);
    assert.equal(reeditDecision({...segments[0],tagContext:['info_panel']},draft,draft).selected,false);
});

test('all targeted IDs share one extra request; non-target text and draft map remain intact', async () => {
    const before = [...translations]; let calls = 0, latest;
    const result = await requestSecondTranslation({segmented,translations,onDiagnostic:r=>latest=r,request:async(prompt,rows,options)=>{
        calls++;
        if (calls === 1) return new Map(translations);
        assert.equal(options.stage,'output-second-translation-reedit');
        assert.equal(options.previousUserSource,undefined);
        assert.deepEqual(rows.map(s=>s.id),['long']);
        assert.equal(JSON.parse(prompt.split('\nSEGMENTS\n')[1])[0].current_translation,draft);
        return new Map([['long',edited],['short','바꾸면 안 되는 구간']]);
    }});
    assert.equal(calls,2); assert.equal(result.get('long'),edited);
    for (const s of segments.slice(1)) assert.equal(result.get(s.id),translations.get(s.id));
    assert.deepEqual([...translations],before);
    assert.equal(latest.events.at(-1).data.reeditPasses,1);
    assert.equal(latest.events.find(e=>e.kind==='draft').data.segments[0].first_translation,draft);
    assert.equal(latest.events.find(e=>e.kind==='reedit-result').data.outcomes[0].status,'accepted');
});

test('unchanged, empty, damaged or failed optional rewrite preserves second result without looping', async () => {
    for (const answer of [new Map(translations),new Map(),new Map([['long',edited+' @@VERBA_0001@@']]),null]) {
        let calls=0, latest;
        const result = await requestSecondTranslation({segmented,translations,onDiagnostic:r=>latest=r,request:async()=>{
            calls++; if(calls===1)return new Map(translations);
            if(answer===null)throw Error('provider unavailable'); return answer;
        }});
        assert.equal(calls,2); assert.deepEqual([...result],[...translations]);
        assert.ok(latest.events.some(e=>e.kind===(answer===null?'reedit-failed':'reedit-result')));
    }
});

test('cancel during extra pass rejects; failing diagnostic callback cannot alter output', async () => {
    const controller=new AbortController(); let calls=0;
    await assert.rejects(requestSecondTranslation({segmented,translations,options:{signal:controller.signal},request:async()=>{
        if(++calls===2)controller.abort();return new Map(translations);
    }}),{name:'AbortError'});
    assert.equal(calls,2);
    const result=await requestSecondTranslation({segmented,translations,onDiagnostic:()=>{throw Error('log error');},request:async()=>new Map(translations)});
    assert.deepEqual([...result],[...translations]);
});

test('format gate prevents protected tokens, English, numeric facts and emphasis from changing',()=>{
    for(const [a,b] of [
        [draft+' @@VERBA_NAME_0000@@',edited], [draft+' *비*',edited+' 비'],
        [draft+' 13',edited+' 14'], [draft+' Dana',edited+' Dina'],
        [draft+' {{user}}',edited+' {{char}}'], [draft,edited+'\n'],
        [draft+' https://example.com/page',edited+' https://example.com/other'],
    ]) assert.equal(acceptReedit(a,b),'protected-structure-changed');
    assert.equal(acceptReedit(draft,draft.replaceAll('.','!')),'no-content-change');
    assert.equal(acceptReedit(draft,'기다렸다.'),'length-outlier');
    assert.equal(acceptReedit(draft,edited),'accepted');
});

test('wire trace preserves each request, profile, retry and unparsed assistant text while masking secrets',()=>{
    let latest;
    const trace=createSecondTranslationTrace({binding:{messageId:8,swipeId:2,sourceHash:'abc',route:'server-engine'},onUpdate:r=>latest=r});
    const attempt=createSecondTranslationAttempt({stage:'output-second-translation',segmentAttempt:1,retryAttempt:2,
        onSecondTranslationWire:e=>trace.add('transport',e)},'B','SOURCE_CONTEXT\n원문\napi_key=private-key');
    attempt.request();
    attempt.provider({boundary:'server-http-request',payload:{messages:[{role:'system',content:'system input'}],api_key:'private-key'}});
    attempt.response('not valid JSON yet'); attempt.error(Error('Authorization: Bearer hidden-bearer'));
    const serialized=JSON.stringify(latest);
    assert.ok(serialized.includes('system input')); assert.ok(serialized.includes('not valid JSON yet'));
    assert.ok(!serialized.includes('private-key')); assert.ok(!serialized.includes('hidden-bearer'));
    assert.equal(latest.events[0].data.profileSlot,'B'); assert.equal(latest.events[0].data.retryAttempt,2);
    assert.equal(new Set(latest.events.map(e=>e.data.attemptId)).size,1);
    assert.equal(createSecondTranslationAttempt({},'A','secret'),null);
    assert.equal(createSecondTranslationTrace().enabled,false);
});

test('trace bounds are explicit and snapshots cannot be mutated by later attempts',()=>{
    const records=[];const trace=createSecondTranslationTrace({onUpdate:r=>records.push(r)});
    trace.add('first',{text:'hello'});trace.add('second',{text:'world'});
    assert.equal(records[0].events.length,1);
    for(let i=0;i<70;i++)trace.add('more',{text:'z'.repeat(200000)});
    const latest=records.at(-1);
    assert.ok(latest.omittedEvents>0);assert.ok(JSON.stringify(latest).length<2100000);
    const safe=cleanSecondTranslationDiagnostic({headers:{Authorization:'hidden'},password:'hidden',messages:[{role:'user',content:'hello'}]});
    assert.ok(!JSON.stringify(safe).includes('hidden'));
});

test('browser diagnostic store ignores stale and disabled updates',()=>{
    const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
    const section=source.slice(source.indexOf('let lastSecondTranslationTrace = null;'),source.indexOf('let lastPromptConflicts = [];'));
    const settings={debugMode:true};
    const store=Function('settings',section+'; return {remember:rememberSecondTranslationTrace,get:()=>lastSecondTranslationTrace};')(settings);
    const record={version:1,capturedAt:'2026-11-06T12:00:00.000Z',revision:2,events:[]};
    store.remember(record);store.remember({...record,revision:1});assert.equal(store.get(),record);
    settings.debugMode=false;store.remember({...record,revision:3});assert.equal(store.get(),record);
});
