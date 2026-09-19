import assert from 'node:assert/strict';
import fs from 'node:fs';
import { protectedRecoverySnapshot, sanitizeDebugValue } from '../diagnostics.js';
import { findProtectedTokenIntegrityProblems, repairProtectedTokenIntegrityLocally } from '../core.js';
const a = '@@VERBA_DEEP_NAME_0000@@', c = '@@VERBA_DEEP_NAME_0001@@', b = '@@VERBA_DEEP_0000@@';
const segmented = { segments: [{ id: 's1', type: 'narration', text: `${a} opened ${b}` }],
    nameTokens: [{ token: a, source: 'Alex', value: '알렉스' }], tokens: [{ token: b, value: '<tag>' }] };
let translations = new Map([['s1', `${b}${b} 그녀는 문을 열었다. api_key=private-secret`]]);
const invalid = findProtectedTokenIntegrityProblems(segmented.segments, translations);
const snap = protectedRecoverySnapshot(invalid, segmented, translations);
assert.equal(snap.segments[0].marks[0].missing, 1);
assert.equal(snap.segments[0].marks[1].excess, 1);
assert.equal(snap.segments[0].marks[0].restoredValue, '알렉스');
assert.ok(!JSON.stringify(snap).includes('private-secret'));
assert.equal(translations.get('s1').includes('private-secret'), true, 'never modify output');
const many = protectedRecoverySnapshot(Array(20).fill({...invalid[0], text: 'x'.repeat(9000)}), segmented, translations);
assert.equal(many.omittedSegments, 8);
assert.match(many.segments[0].sourceWithMarkers, /생략/);
const moved = {segments: [{id:'a',text:a}, {id:'b',text:'none'}],nameTokens:segmented.nameTokens};
assert.equal(protectedRecoverySnapshot(findProtectedTokenIntegrityProblems(moved.segments, new Map([['a','none'],['b',a]])),moved,new Map([['a','none'],['b',a]])).problemSegmentCount,2);
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (a,b) => index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
const settings = {debugMode:true}; const button = {disabled:true}; let now=0;
const env={settings, document:{querySelector:()=>button}, sanitizeDebugValue, protectedRecoverySnapshot,
    performance:{now:()=>now}, console:{info(){},warn(){},error(){}},
    createDebugDiagnostic:(stage,error,displayMessage)=>({stage,displayMessage}),
};
const logs=Function(...Object.keys(env),'let lastDebugDiagnostic=null;\n'+slice('function storeDebugDiagnostic(', 'function createDebugDiagnostic(')+ '\nreturn {recordProtectedRecovery,finishProtectedRecovery,clear:()=>{lastDebugDiagnostic=null;},latest:()=>lastDebugDiagnostic,replace:storeDebugDiagnostic};')(...Object.values(env));
let calls=0, action=()=>{translations.set('s1',`${a} opened ${b}`);now+=4900;};
const deps={...env,...logs,findProtectedTokenIntegrityProblems,repairProtectedTokenIntegrityLocally,buildProtectedTokenRepairPrompt:()=>{},isAbort:e=>e.name==='AbortError',
    madKoreanExclusiveMode:()=>false,
    repairSegmentsByOutputScope:async opts=>{calls++;assert.equal(opts.stage,'protected-token-repair');await action();}};
const repair=Function(...Object.keys(deps),slice('async function repairProtectedTokenIntegrity(', 'function normalizedNumberTokens(')+'\nreturn repairProtectedTokenIntegrity;')(...Object.values(deps));
await repair(segmented,translations,{stage:'output-retranslation'});
assert.equal(calls,1);assert.equal(button.disabled,false);
assert.equal(logs.latest().protectedRecovery.status,'복구 완료');
assert.equal(logs.latest().protectedRecovery.elapsedSeconds,4.9);
assert.equal(logs.latest().protectedRecovery.remaining.problemSegmentCount,0);
assert.match(logs.latest().protectedRecovery.before.segments[0].translationBeforeRepair,/그녀/);
assert.equal(JSON.parse(JSON.stringify(logs.latest())).protectedRecovery.before.segments[0].marks[0].missing,1);
await repair(segmented,translations);assert.equal(calls,1,'valid tokens need no request');
settings.debugMode=false;logs.clear();translations.set('s1','bad');await repair(segmented,translations);assert.equal(logs.latest(),null);
settings.debugMode=true;translations.set('s1','bad');action=()=>{settings.debugMode=false;logs.clear();settings.debugMode=true;translations.set('s1',`${a}${b}`);};
await repair(segmented,translations);assert.equal(logs.latest(),null,'OFF/on cannot resurrect log');
translations.set('s1','bad');action=()=>{logs.replace({newer:true});translations.set('s1',`${a}${b}`);};
await repair(segmented,translations);assert.deepEqual(logs.latest(),{newer:true});
translations.set('s1','bad');calls=0;action=()=>{now+=100;};
await assert.rejects(repair(segmented,translations),e=>e.verbaDeepProtectedRecovery.status==='복구 실패');
assert.equal(calls,5);assert.equal(logs.latest().protectedRecovery.attempts,5);
action=()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});};
await assert.rejects(repair(segmented,translations),e=>e.verbaDeepProtectedRecovery.status==='취소됨');

// The real v0.5.120 failure mode: the model removed NAME placeholders but
// already wrote each exact locked Korean name. This must be restored locally
// with zero AI calls and without changing any surrounding Korean wording.
const localSegmented = {
    segments: [
        { id: 'n1', type: 'narration', text: `${a} followed him.` },
        { id: 'n2', type: 'narration', text: `${c} was still there.` },
    ],
    nameTokens: [
        { token: a, source: 'Dam-eun', value: '담은' },
        { token: c, source: 'Dam-eun', value: '담은' },
    ],
    tokens: [],
};
const localTranslations = new Map([
    ['n1', '담은이 그를 따라왔다.'],
    ['n2', '담은은 아직 거기 있었다.'],
]);
const localResult = repairProtectedTokenIntegrityLocally(localSegmented, localTranslations);
assert.equal(localResult.restoredNameTokens, 2);
assert.deepEqual(localResult.remaining, []);
assert.equal(localTranslations.get('n1'), `${a}이 그를 따라왔다.`);
assert.equal(localTranslations.get('n2'), `${c}은 아직 거기 있었다.`);
settings.debugMode=true; calls=0;
await repair(localSegmented,localTranslations);
assert.equal(calls,0,'locally restored names require no AI request');

const localMissing = new Map([
    ['n1', '담은이 그를 따라왔다.'],
    ['n2', '담은은 아직 거기 있었다.'],
]);
await repair(localSegmented, localMissing, {stage:'output-retranslation'});
assert.equal(calls,0,'repair entry path performs local NAME recovery before AI');
assert.equal(logs.latest().protectedRecovery.status,'내부 복구 완료');
assert.equal(logs.latest().protectedRecovery.attempts,0);

// Ambiguous duplicate visible names are deliberately left to the existing
// source-aware fallback instead of guessing which occurrence gets the token.
const ambiguous = new Map([['n1', '담은이 담은을 따라왔다.'], ['n2', `${c}은 아직 거기 있었다.`]]);
const ambiguousResult = repairProtectedTokenIntegrityLocally(localSegmented, ambiguous);
assert.equal(ambiguousResult.restoredNameTokens,0);
assert.equal(ambiguousResult.remaining.length,1);

// Mad-Korean single-pass mode resolves even ambiguous/missing name and
// structure markers locally instead of issuing a repair request.
const forced = new Map([['s1', '알렉스가 문을 열었다.']]);
const forcedResult = repairProtectedTokenIntegrityLocally(segmented, forced, {force:true});
assert.deepEqual(forcedResult.remaining, []);
assert.match(forced.get('s1'), /@@VERBA_DEEP_NAME_0000@@/);
assert.match(forced.get('s1'), /@@VERBA_DEEP_0000@@/);
// Diagnostic failures cannot alter the existing recovery path.
const broken={...deps,recordProtectedRecovery:logs.recordProtectedRecovery,protectedRecoverySnapshot:()=>{throw Error('diagnostic failed');}};
const badLogs=Function(...Object.keys(broken),'let lastDebugDiagnostic=null;\n'+slice('function recordProtectedRecovery(', 'function createDebugDiagnostic(')+'\nreturn recordProtectedRecovery;')(...Object.values(broken));
assert.equal(badLogs(invalid,segmented,translations,{}),null);
console.log('PASS protected recovery: exact missing/excess counts, moved marks, mappings, redaction/limits, successful log/copy data, no-op, OFF/reset, newer-log guard, 5-attempt failure, cancellation, diagnostic isolation (mock requests).');
