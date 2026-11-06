import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestSecondTranslation } from '../second-translation.js';
import { cleanSecondTranslationDiagnostic, createSecondTranslationTrace, createSecondTranslationAttempt } from '../second-translation-diagnostics.js';

const draft = '그는 오래된 도서관의 창문 앞에 서서 비가 그치기를 기다렸다. 건너편 골목에는 우산을 든 사람들이 천천히 지나가고 있었으며 책상 위에 놓인 편지에는 아직 답장을 쓰지 못한 채였다. 그는 종이를 다시 펼쳐 마지막 문장을 읽었다. 저녁이 가까워지자 실내의 그림자가 조금씩 길어졌다.';
const edited = '비가 그치기를 기다리며 그는 오래된 도서관 창가에 서 있었다. 길 건너 골목으로 우산을 쓴 사람들이 천천히 지나갔다. 책상에 놓인 편지에는 아직 답하지 못했다. 그는 편지를 펼쳐 마지막 문장을 다시 읽었다. 어느새 저녁이 가까워져 실내에 드리운 그림자가 조금씩 길어지고 있었다.';
const segments = [{id:'long',type:'narration',text:'A visitor waited in the library.'},
    {id:'short',type:'narration',text:'Rain.'}, {id:'dialogue',type:'dialogue_candidate',text:'He spoke.'},
    {id:'panel',type:'tagged_content',text:'A panel.'}, {id:'code',type:'narration',codeKind:'inline',text:'A code string.'}];
const translations = new Map(segments.map(s => [s.id,s.id === 'short' ? '비.' : draft]));
const segmented = {source: 'A visitor waited in the library. He spoke.',segments};

test('unchanged long narration returns after one second-pass request, with full diagnostics and no extra edit', async () => {
    const before = [...translations]; let calls = 0, latest;
    const result = await requestSecondTranslation({segmented,translations,onDiagnostic:r=>latest=r,request:async(prompt,rows,options)=>{
        calls++;
        assert.equal(options.stage,'output-second-translation');
        assert.deepEqual(rows,segments);
        assert.doesNotMatch(prompt,/SECOND TRANSLATION REEDIT/);
        return new Map(translations);
    }});
    assert.equal(calls,1); assert.deepEqual([...result],before); assert.deepEqual([...translations],before);
    assert.equal(latest.outcome.summary.reeditEnabled,false);
    assert.equal(latest.outcome.summary.reeditPasses,0);
    assert.ok(!latest.events.some(e=>e.kind.startsWith('reedit-')));
    assert.equal(latest.events.find(e=>e.kind==='draft').data.segments[0].first_translation,draft);
    assert.deepEqual(latest.events.find(e=>e.kind==='second-result').data.segments,latest.events.at(-1).data.segments);
});

test('small and substantial second-pass changes are both used without another request',async()=>{
    for(const text of [draft.replaceAll('.', '!'),draft.replace('창문','창가'),edited]){
        let calls=0;
        const result=await requestSecondTranslation({segmented,translations,request:async()=>{
            calls++;return new Map([...translations].map(([id,value])=>[id,id==='long'?text:value]));
        }});
        assert.equal(calls,1);assert.equal(result.get('long'),text);
    }
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
