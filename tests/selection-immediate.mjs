import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function harness(pointerEvents = true) {
    const handlers = new Map(), timers = new Map(), shown = [];
    let tick = 0, serial = 0;
    const snapshot = { selected: '선택한 글' };
    const context = vm.createContext({
        ...(pointerEvents ? { PointerEvent: function() {} } : {}),
        document: { addEventListener(name, cb) { const a=handlers.get(name)||[]; a.push(cb);handlers.set(name,a); }, querySelector(){return null;} },
        window: {addEventListener(){}},
        setTimeout(cb, delay){const id=++serial;timers.set(id,{cb,at:tick+delay});return id;},
        clearTimeout(id){timers.delete(id);},
        resolveSelection: () => snapshot,
        captureSelectionState: () => snapshot,
        selectionStillCurrent: () => true,
        showSelectionButton: value => shown.push(value),
        hideSelectionButton(){}, selectionHasText:()=>true,
        touchSelectionRecentlyActive:()=>true,
        desktopSelectionPlacement:()=>({x:10,y:10}),
    });
    vm.runInContext(`let selectionTimer=null, selectionGestureActive=false, selectionTouchActive=false,
        selectionNeedsCapture=false, selectionPointerType='', preservedGestureSelection=null,
        lastTouchSelectionAt=0, lastDesktopSelectionAt=0, lastDesktopSelectionPlacement=null,
        selectionSnapshot=null, selectionBusy=false, suppressMessageCopyClickUntil=0;
        ${index.match(/const TOUCH_SELECTION_CAPTURE_MS = \d+;/)[0]}
        ${index.slice(index.indexOf('function scheduleSelectionCapture('),index.indexOf('function selectionStillCurrent('))}
        ${index.slice(index.indexOf('function setupSelection()'),index.indexOf('function showMessageCopyMenu('))}
        setupSelection();`,context);
    const target = {closest: selector=>selector.includes('.mes[mesid]')?{}:null};
    return {shown,snapshot,
        event(name,props={}){for(const cb of handlers.get(name)||[])cb({target,pointerType:'touch',button:0,touches:[],...props});},
        flush(){ for(let n=0;n<20;n++){const due=[...timers].filter(([,t])=>t.at<=tick);if(!due.length)return;for(const [id,t] of due){timers.delete(id);t.cb();}}throw Error('timer loop');},
    };
}
for(const pointer of [true,false]) test(`touch release shows menu with no elapsed wait (PointerEvent=${pointer})`,()=>{
    const h=harness(pointer);h.event('touchstart',{touches:[{}]});
    if(pointer)h.event('pointerdown');
    h.event('selectionchange');h.flush();assert.equal(h.shown.length,0);
    if(pointer)h.event('pointerup');h.flush();assert.equal(h.shown.length,0);
    h.event('touchend');h.flush();assert.equal(h.shown.at(-1),h.snapshot);
});
for(const ending of ['touchend','touchcancel']) test(`native pointer cancellation retains selection until ${ending}`,()=>{
    const h=harness();h.event('touchstart',{touches:[{}]});h.event('pointerdown');h.event('selectionchange');
    h.event('pointercancel');h.flush();assert.equal(h.shown.length,0);
    h.event('selectionchange');h.flush();assert.equal(h.shown.length,0);
    h.event(ending);h.flush();assert.equal(h.shown.at(-1),h.snapshot);
});
for(const pointerType of ['mouse','pen']) test(`${pointerType} release opens without touch delay`,()=>{
    const h=harness();h.event('pointerdown',{pointerType});h.event('selectionchange');h.flush();assert.equal(h.shown.length,0);
    h.event('pointerup',{pointerType});if(pointerType==='mouse')h.event('mouseup',{pointerType});
    h.flush();assert.equal(h.shown.at(-1),h.snapshot);
});
