import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindPromptExpandEditors } from '../prompt-editor.js';

// DOM/event model tests. This does not render CSS or emulate a real phone IME.
class Events extends EventTarget {
    handlers = new Map();
    addEventListener(type, callback, options) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set());
        this.handlers.get(type).add(callback);
        super.addEventListener(type, callback, options);
    }
    removeEventListener(type, callback, options) {
        this.handlers.get(type)?.delete(callback);
        super.removeEventListener(type, callback, options);
    }
}
class Element extends Events {
    constructor(tag, doc) {
        super(); this.tagName=tag; this.ownerDocument=doc; this.children=[];
        this.parentElement=null; this.attributes={}; this.className=''; this.id='';
        this.value=''; this.placeholder=''; this.textContent=''; this.open=false;
        this.selectionStart=0; this.selectionEnd=0; this.selectionDirection='none'; this.scrollTop=0;
        this.styles=new Map(); this.style={setProperty:(k,v)=>this.styles.set(k,v)};
    }
    get isConnected() { return this===this.ownerDocument.documentElement || Boolean(this.parentElement?.isConnected); }
    setAttribute(k,v) { this.attributes[k]=v; }
    append(...children) { children.forEach(x=>{ x.parentElement=this; this.children.push(x); }); }
    insertBefore(child, before) { child.parentElement=this; const at=this.children.indexOf(before); this.children.splice(at<0?this.children.length:at,0,child); }
    remove() { if (this.parentElement) this.parentElement.children=this.parentElement.children.filter(x=>x!==this); this.parentElement=null; }
    matches(selector) { return selector.startsWith('#')?this.id===selector.slice(1):selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector; }
    querySelectorAll(selector) {
        const [ancestor,child]=selector.split(' > ');
        return this.children.flatMap(el=>[
            ...(child ? (el.matches(ancestor)?el.children.filter(x=>x.matches(child)):[]) : (el.matches(selector)?[el]:[])),
            ...el.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
    focus() { this.ownerDocument.activeElement=this; }
    blur() { if (this.ownerDocument.activeElement===this) this.ownerDocument.activeElement=null; }
    setSelectionRange(start,end,direction) { this.selectionStart=start; this.selectionEnd=end; this.selectionDirection=direction; }
    showModal() { this.open=true; }
    close() { this.open=false; this.dispatchEvent(new Event('close')); }
}
const viewport=new Events(); Object.assign(viewport,{width:390,height:844,offsetLeft:0,offsetTop:0});
const win=new Events(); Object.assign(win,{Event,visualViewport:viewport,innerWidth:1280,innerHeight:900});
const doc={defaultView:win,activeElement:null,createElement:tag=>new Element(tag,doc),createElementNS:(ns,tag)=>{const el=new Element(tag,doc);el.namespaceURI=ns;return el;},getElementById:id=>doc.documentElement.querySelector('#'+id)};
doc.documentElement=new Element('html',doc);
const panel=doc.createElement('div');doc.documentElement.append(panel);
const rows=[['global','globalPrompt'],['all-dialogue','allDialoguePrompt'],['dialogue','dialoguePrompt'],['other-dialogue','otherDialoguePrompt']];
const settings={globalPromptEnabled:false};
for (const [slug,key] of rows) {
    const slot=doc.createElement('div');slot.className='verba-prompt-slot';
    const header=doc.createElement('div');header.className='verba-prompt-slot-head';
    const label=doc.createElement('label');label.textContent=key+' 프롬프트';
    const toggle=doc.createElement('label');toggle.className='verba-prompt-slot-toggle';
    header.append(label,toggle);
    const source=doc.createElement('textarea');source.id=`verba-${slug}-prompt`;source.value=key+' 원본';source.placeholder='입력';
    settings[key]=source.value;slot.append(header,source);panel.append(slot);
}
let saves=0,backups=0,inspections=0,persisted='';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const start=index.indexOf("panel.querySelector('#verba-global-prompt').addEventListener('input'");
const handlers=index.slice(start,index.indexOf("panel.querySelector('#verba-banned-words').addEventListener",start));
Function('panel','settings','saveSettings','renderPromptConflictInspector','schedulePromptEditorBackup','bindPromptExpandEditors','syncCustomTranslatorControls',handlers)(
    panel,settings,()=>{saves++;persisted=JSON.stringify(settings);},()=>inspections++,()=>backups++,bindPromptExpandEditors,()=>{});
bindPromptExpandEditors(panel);
const buttons=panel.querySelectorAll('.verba-prompt-expand');
assert.equal(buttons.length,4,'idempotent binding');
assert.ok(buttons.every(button=>button.textContent==='' && button.attributes['aria-label'].includes('크게 편집')),'icon retains accessible label without a font glyph');
for(const button of buttons) {
    const icon=button.querySelector('svg');
    assert.equal(icon.namespaceURI,'http://www.w3.org/2000/svg');
    assert.equal(icon.attributes.viewBox,'0 0 24 24');
    assert.equal(icon.attributes['aria-hidden'],'true');
    assert.equal(icon.attributes.width,'12');
    assert.equal(icon.querySelector('path').attributes.stroke,'currentColor');
}
let checks=1;
for (const [i,[slug,key]] of rows.entries()) {
    const button=buttons[i],source=panel.querySelector(`#verba-${slug}-prompt`);
    source.setSelectionRange(2,4,'forward');source.scrollTop=32;
    button.dispatchEvent(new Event('click'));
    let dialog=doc.getElementById('verba-prompt-editor');
    let editor=dialog.querySelector('textarea');
    assert.equal(dialog.open,true);
    assert.equal(dialog.querySelectorAll('button').length,1,'only close button');
    assert.equal(editor.value,key+' 원본');
    assert.deepEqual([editor.selectionStart,editor.selectionEnd,editor.scrollTop],[2,4,32]);
    button.dispatchEvent(new Event('click'));
    assert.equal(doc.documentElement.querySelectorAll('dialog').length,1,'one dialog at a time');
    const value='  새 지침 “안녕” {{char}}\n\n<script>literal</script>\n끝  ';
    editor.value=value;editor.dispatchEvent(new Event('input'));
    assert.equal(source.value,value);
    assert.equal(settings[key],value);
    assert.equal(JSON.parse(persisted)[key],value,'save occurs before close');
    const saveCount=saves;
    dialog.querySelector('button').dispatchEvent(new Event('click'));
    assert.equal(saves,saveCount,'unchanged close does not duplicate save or backup');
    assert.equal(doc.getElementById('verba-prompt-editor'),null);
    assert.equal(doc.activeElement,button);
    assert.equal(viewport.handlers.get('resize').size,0,'resize cleanup');
    assert.equal(viewport.handlers.get('scroll').size,0,'scroll cleanup');
    button.dispatchEvent(new Event('click'));
    dialog=doc.getElementById('verba-prompt-editor');editor=dialog.querySelector('textarea');
    assert.equal(editor.value,value,'reopen retains exact content');
    editor.value='';editor.dispatchEvent(new Event('input'));
    const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented,true);
    assert.equal(JSON.parse(persisted)[key],'','empty prompt remains saved');
    checks+=16;
}
assert.equal(settings.globalPromptEnabled,false,'editing does not enable the prompt');
assert.deepEqual([saves,inspections,backups],[8,8,8],'existing save/conflict/backup handlers run once per edit');
buttons[0].dispatchEvent(new Event('click'));
let dialog=doc.getElementById('verba-prompt-editor'),editor=dialog.querySelector('textarea');
editor.value='마지막 한글 조합'; // IME/change may precede the final input notification.
dialog.querySelector('button').dispatchEvent(new Event('click'));
assert.equal(JSON.parse(persisted).globalPrompt,'마지막 한글 조합','close commits final value');
buttons[0].dispatchEvent(new Event('click'));
dialog=doc.getElementById('verba-prompt-editor');editor=dialog.querySelector('textarea');
editor.value='조합 완료';editor.dispatchEvent(new Event('compositionend'));
assert.equal(JSON.parse(persisted).globalPrompt,'조합 완료');
viewport.height=300;viewport.offsetTop=80;viewport.dispatchEvent(new Event('resize'));
assert.equal(dialog.styles.get('--verba-editor-height'),'300px');
assert.equal(dialog.styles.get('--verba-editor-top'),'80px');
viewport.offsetTop=90;viewport.dispatchEvent(new Event('scroll'));
assert.equal(dialog.styles.get('--verba-editor-top'),'90px');
editor.value='외부 닫기';dialog.close();
assert.equal(JSON.parse(persisted).globalPrompt,'외부 닫기');
assert.equal(win.handlers.get('resize').size,0);
win.visualViewport=null;
buttons[0].dispatchEvent(new Event('click'));
dialog=doc.getElementById('verba-prompt-editor');
assert.equal(dialog.styles.get('--verba-editor-height'),'900px','window fallback');
win.innerHeight=600;win.dispatchEvent(new Event('resize'));
assert.equal(dialog.styles.get('--verba-editor-height'),'600px');
dialog.close();

// Model host drawer listeners in both capture and bubble phases. Freeze the
// event path before dispatch, like browsers do, including when the target is
// removed inside a click listener. Plain EventTarget does not model DOM bubbling.
let drawerCloses=0,globalClicks=0;
const insidePanel=el=>el===panel || Boolean(el?.parentElement && insidePanel(el.parentElement));
const host=(event)=>{
    if (['click','pointerdown','touchstart'].includes(event.type) && !insidePanel(event.target)) drawerCloses++;
};
function dispatchDomEvent(target,type,key='') {
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperty(event,'target',{value:target});
    Object.defineProperty(event,'key',{value:key});
    const path=[];
    for(let el=target;el;el=el.parentElement)path.push(el);
    host(event); // document capture outside-click check runs before the popup.
    for(const el of path) {
        for(const handler of el.handlers.get(type)||[])handler.call(el,event);
        if(event.cancelBubble)break;
        if(el===doc.documentElement) {
            if(type==='click')globalClicks++;
            host(event);
            if(type==='keydown'&&key==='Escape')drawerCloses++;
        }
    }
    return event;
}
dispatchDomEvent(buttons[0],'click');
dialog=doc.getElementById('verba-prompt-editor');editor=dialog.querySelector('textarea');
assert.equal(dialog.parentElement,panel,'top-layer dialog belongs to extension drawer');
for(const type of ['click','pointerdown','pointerup','mousedown','mouseup','touchstart','touchend']) {
    assert.equal(dispatchDomEvent(editor,type).cancelBubble,true,type+' stays within dialog');
}
editor.value='닫아도 저장';dispatchDomEvent(editor,'input');
dispatchDomEvent(dialog.querySelector('button'),'pointerdown');
dispatchDomEvent(dialog.querySelector('button'),'click');
assert.equal(doc.getElementById('verba-prompt-editor'),null);
assert.equal(settings.globalPrompt,'닫아도 저장');
assert.equal(drawerCloses,0,'close click does not close parent drawer');
assert.equal(globalClicks,0,'no leaking click after target removal');
dispatchDomEvent(buttons[0],'click');
dialog=doc.getElementById('verba-prompt-editor');editor=dialog.querySelector('textarea');
const escapeEvent=dispatchDomEvent(editor,'keydown','Escape');
assert.equal(escapeEvent.cancelBubble,true,'host Escape listener not reached');
assert.equal(escapeEvent.defaultPrevented,false,'native dialog cancel remains available');
dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
assert.equal(doc.getElementById('verba-prompt-editor'),null);
assert.equal(drawerCloses,0,'Escape closes only popup');
const outside=doc.createElement('button');doc.documentElement.append(outside);
dispatchDomEvent(outside,'click');
assert.ok(drawerCloses>0&&globalClicks>0,'unrelated host outside-click behavior remains active');

// The nine general-mode custom-translator fields deliberately use the same
// prompt-slot structure, so exercise each one through the shared modal and
// commit an undelivered IME-style final value only when Close runs sync().
const customPanel=doc.createElement('div');doc.documentElement.append(customPanel);
const customKeys=['output','input','selection','name','consistency','repair','quality','flavor','other'];
const customSaved={};let customSaveCount=0;
for(const key of customKeys){
    const slot=doc.createElement('section');slot.className='verba-prompt-slot verba-custom-translator-field';
    const header=doc.createElement('div');header.className='verba-prompt-slot-head';
    const label=doc.createElement('label');label.textContent=key;header.append(label);
    const source=doc.createElement('textarea');source.value='{기본_프롬프트}';
    source.addEventListener('input',()=>{customSaved[key]=source.value;customSaveCount++;});
    slot.append(header,source);customPanel.append(slot);
}
bindPromptExpandEditors(customPanel);
const customButtons=customPanel.querySelectorAll('.verba-prompt-expand');
assert.equal(customButtons.length,9,'all custom translator fields receive an expand control');
for(const [i,button] of customButtons.entries()){
    button.dispatchEvent(new Event('click'));
    const popup=doc.getElementById('verba-prompt-editor');
    popup.querySelector('textarea').value=`custom-${customKeys[i]}`;
    popup.querySelector('button').dispatchEvent(new Event('click'));
    assert.equal(customSaved[customKeys[i]],`custom-${customKeys[i]}`,'Close commits the final custom prompt value');
}
assert.equal(customSaveCount,9,'each custom prompt saves exactly once on close');
console.log(`PASS: ${checks+23} DOM/event assertions including 9 custom-translator expand/close auto-saves; actual save handlers, close/Escape, viewport cleanup. Rendering/live ST not tested.`);
