import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceChangeTracer} from '../source-change-tracer.js';
import {createBrowserExecutionDiagnostics} from '../browser-execution-diagnostics.js';

function readSource(msg) {
    if(msg?.swipes && msg.swipe_id !== undefined) {
        const raw=msg.swipes[msg.swipe_id];
        return typeof raw==='string' ? raw : String(raw?.mes??'');
    }
    return msg?.mes || '';
}

test('diagnostic source watcher is opt-in and restores original property descriptor',()=>{
    let active=false,detailed=false;
    const secret='<scene_state>{"scene":{"location":"SECRET PRIVATE"}}</scene_state>';
    const source='Narrative.\n'+secret+'\n<Info_panel>Other</Info_panel>';
    const msg={mes:source}, original=Object.getOwnPropertyDescriptor(msg,'mes');
    const tracer=createSourceChangeTracer({enabled:()=>active,fullTextEnabled:()=>detailed,readSource});
    tracer.observe(2,msg,'received');
    assert.deepEqual(tracer.diagnostics().events,[]);
    assert.equal(typeof Object.getOwnPropertyDescriptor(msg,'mes').set,'undefined');
    active=true;
    tracer.observe(2,msg,'received');
    assert.equal(typeof Object.getOwnPropertyDescriptor(msg,'mes').set,'function');
    msg.mes='Narrative.\n\n<Info_panel>Other</Info_panel>';
    const logged=tracer.diagnostics().events.at(-1);
    assert.equal(logged.method,'property-write');
    assert.ok(logged.removedTagHints.includes('scene_state'));
    assert.equal(logged.effectiveSourceChanged,true);
    assert.ok(!JSON.stringify(tracer.diagnostics()).includes('SECRET PRIVATE'));
    assert.equal(logged.beforeText,undefined);
    tracer.reset();
    assert.deepEqual(tracer.diagnostics().events,[]);
    assert.equal(Object.getOwnPropertyDescriptor(msg,'mes').writable,original.writable);
    assert.ok('value' in Object.getOwnPropertyDescriptor(msg,'mes'));
    assert.equal(msg.mes,'Narrative.\n\n<Info_panel>Other</Info_panel>');
});
test('full text needs explicit switch, never truncates first three entries, then expires',()=>{
    let detailed=true;
    const msg={mes:'A'.repeat(12000)}, tracer=createSourceChangeTracer({
        enabled:()=>true,fullTextEnabled:()=>detailed,readSource
    });
    tracer.observe(3,msg,'received');
    msg.mes='B'.repeat(8000);
    const first=tracer.diagnostics().events[0];
    assert.equal(first.beforeText.length,12000);
    assert.equal(first.afterText.length,8000);
    assert.equal(first.removedText.length,12000);
    assert.equal(first.insertedText.length,8000);
    tracer.compare(3,'old','new');
    for(let i=0;i<5;i++)msg.mes='changed '+i;
    assert.equal(tracer.diagnostics().events.filter(row=>typeof row.beforeText==='string').length,7);
    for(let i=5;i<10;i++)msg.mes='changed '+i;
    assert.equal(tracer.diagnostics().events.filter(row=>typeof row.beforeText==='string').length,8);
    assert.ok(tracer.diagnostics().events.some(row=>row.fullTextExpired===true));
    detailed=false;
    tracer.reset();
    assert.equal(tracer.diagnostics().events.length,0);
    msg.mes='New message';
    assert.equal(tracer.diagnostics().events.length,0);
});
test('swipe and message mes changes can both be detected without changing translation values',()=>{
    const msg={mes:'Long message <scene_state>{"scene":{}}</scene_state>',swipe_id:0,
        swipes:['SWIPE ORIGINAL']};
    const tracer=createSourceChangeTracer({enabled:()=>true,readSource});
    tracer.observe(3,msg);
    msg.mes='Long message';
    assert.equal(tracer.diagnostics().events.at(-1).field,'message.mes');
    assert.equal(tracer.diagnostics().events.at(-1).effectiveSourceChanged,false);
    msg.swipes[0]='SWIPE FINAL';
    assert.equal(tracer.diagnostics().events.at(-1).field,'swipes[0]');
    assert.equal(tracer.diagnostics().events.at(-1).effectiveSourceChanged,true);
    assert.equal(readSource(msg),'SWIPE FINAL');
    tracer.reset();
    assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(msg.swipes,'0'),'value'));
});
test('browser hidden is not labeled frozen; freeze event is distinct from timer throttling',()=>{
    let clock=1000,visibility='visible',callback,unset=false;
    const diag=createBrowserExecutionDiagnostics({
        enabled:()=>true,now:()=>clock,visibility:()=>visibility,
        schedule:fn=>(callback=fn,1),unschedule:()=>{unset=true;}
    });
    diag.start();
    visibility='hidden';diag.page('hidden');
    clock+=5000;visibility='visible';diag.page('visible');
    assert.equal(diag.diagnostics().assessment,'background-excursion-seen-no-freeze-proof');
    visibility='hidden';diag.page('hidden');
    clock+=15000;callback();diag.page('freeze');
    clock+=4000;visibility='visible';diag.page('visible');
    assert.equal(diag.diagnostics().assessment,'freeze-event-seen');
    assert.equal(diag.diagnostics().freezeEventCount,1);
    assert.ok(diag.diagnostics().delayedTimerCount>=1);
    diag.trace('output-started',6);
    diag.trace('translation-requested',6);
    diag.trace('translation-stale',6,{sourceChanged:true,beforeLength:5000,afterLength:3200,retryScheduled:true});
    assert.equal(diag.diagnostics().latestJobs.at(-1).lastStage,'translation-stale');
    diag.clear({dropTimer:true});
    assert.equal(diag.diagnostics().events.length,0);
    assert.equal(unset,true);
});
