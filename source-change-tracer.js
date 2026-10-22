// Browser-only diagnostics. All hooks are opt-in and restored when disabled.
// The default log contains no source text, prompt, translation or network payload.
const MAX_EVENTS = 40;
const MAX_FULL_TEXT_EVENTS = 3;
const MAX_TRACKED = 6;
const tagHintPattern = /(?:<|&lt;)\s*\/?\s*(scene_state|sfw_scene|archive[-_]?now|charm[-_]?now|rp_plan|starter|thinking|analysis)\b/giu;

function describeTextChange(before, after) {
    before=String(before??''); after=String(after??'');
    let commonPrefixLength=0, commonSuffixLength=0;
    const minimum=Math.min(before.length,after.length);
    while(commonPrefixLength<minimum && before[commonPrefixLength]===after[commonPrefixLength])commonPrefixLength++;
    while(commonSuffixLength<minimum-commonPrefixLength
        && before[before.length-1-commonSuffixLength]===after[after.length-1-commonSuffixLength])commonSuffixLength++;
    const removed=before.slice(commonPrefixLength,before.length-commonSuffixLength);
    const inserted=after.slice(commonPrefixLength,after.length-commonSuffixLength);
    return {
        beforeLength:before.length, afterLength:after.length,
        removedLength:removed.length, insertedLength:inserted.length,
        commonPrefixLength,commonSuffixLength,
        relation: before===after?'same': before.startsWith(after)?'tail-removed'
            :before.endsWith(after)?'head-removed'
            :after.length<before.length?'text-shortened':'text-changed',
        removedTagHints:[...new Set([...removed.matchAll(tagHintPattern)].map(m=>m[1].toLowerCase()))].slice(0,8),
    };
}
// No URLs, user-provided function names or untrusted raw error stacks in normal diagnostics.
function sourceWriter() {
    const frames=[];
    for(const line of String(new Error().stack||'').split('\n').slice(1)) {
        if(line.includes('source-change-tracer.js'))continue;
        const candidate=line.match(/(?:https?:\/\/[^\s)]+|file:\/\/\/[^\s)]+|\/scripts\/[^\s)]+|\/script\.js:\d+:\d+)/u);
        if(!candidate)continue;
        const raw=candidate[0], position=/:(\d+):(\d+)$/u.exec(raw);
        const path=raw.replace(/:(\d+):(\d+)$/u,'').split(/[?#]/u)[0];
        const extension=/\/scripts\/extensions\/(?:third-party\/)?([a-z0-9_.-]{1,80})\/([a-z0-9_./-]{1,150}\.m?js)$/iu.exec(path);
        const script=/\/([a-z0-9_.-]{1,80}\.m?js)$/iu.exec(path);
        if(!script)continue;
        const frame=extension?'extension:'+extension[1]+'/'+extension[2].split('/').slice(-2).join('/')
            :'script:'+script[1];
        frames.push(frame+':'+(position?.[1]||'?')+':'+(position?.[2]||'?'));
        if(frames.length>=5)break;
    }
    return {possibleWriter:frames.find(f=>f.startsWith('extension:'))||frames[0]||null,frames};
}
export function createSourceChangeTracer({enabled=()=>false,fullTextEnabled=()=>false,readSource=()=>'',onChange=()=>{},now=Date.now}={}) {
    const tracked=new Map(),events=[];
    const active=()=>enabled()===true;
    const detailed=()=>active()&&fullTextEnabled()===true;
    const read=msg=>{try{return String(readSource(msg)??'');}catch{return '';}};
    const fullText=(before,after,change)=>detailed()?{
        beforeText:before,afterText:after,
        removedText:before.slice(change.commonPrefixLength,before.length-change.commonSuffixLength),
        insertedText:after.slice(change.commonPrefixLength,after.length-change.commonSuffixLength),
    }:{};
    const push=event=>{
        const row={at:now(),...event};
        events.push(row);
        if(events.length>MAX_EVENTS)events.shift();
        const withText=events.filter(e=>Object.hasOwn(e,'beforeText'));
        for(const old of withText.slice(0,-MAX_FULL_TEXT_EVENTS)) {
            delete old.beforeText;delete old.afterText;delete old.removedText;delete old.insertedText;
            old.fullTextExpired=true;
        }
        try{onChange({messageId:row.messageId,method:row.method,field:row.field,relation:row.relation,
            removedLength:row.removedLength,insertedLength:row.insertedLength});}catch{/*Never affect RP.*/}
    };
    const log=(entry,before,after,method,field,phase,writer=null,effective=true)=>{
        if(!active()||before===after)return;
        const change=describeTextChange(before,after);
        push({event:'source-changed',messageId:entry.id,method,field,phase,
            ...change,...fullText(before,after,change),effectiveSourceChanged:effective,
            ...(writer||{possibleWriter:null,frames:[]})});
    };
    const restore=stop=>{try{stop?.();}catch{/*Field may have been replaced.*/}};
    function unwatch(entry){
        for(const stop of [...entry.restores].reverse())restore(stop);
        entry.restores.length=0;
        restore(entry.swipeStop);entry.swipeStop=null;
        for(const stop of [...entry.nestedStops].reverse())restore(stop);
        entry.nestedStops.length=0;
    }
    function watchField(entry,obj,key,path,onWrite){
        if(!obj||typeof obj!=='object')return null;
        const original=Object.getOwnPropertyDescriptor(obj,key);
        if(!original?.configurable||!original.writable||!('value' in original))return null;
        let value=original.value;
        const getter=()=>value;
        const setter=next=>{
            const live=active();
            const beforeEffective=live?read(entry.message):'';
            const old=value;
            value=next;
            if(live){
                const afterEffective=read(entry.message);
                const ownText=typeof old==='string'&&typeof next==='string';
                const before=ownText?old:beforeEffective;
                const after=ownText?next:afterEffective;
                log(entry,before,after,'property-write',path,entry.phase,
                    sourceWriter(),beforeEffective!==afterEffective);
                entry.lastSource=afterEffective;
                entry.lastMes=typeof entry.message.mes==='string'?entry.message.mes:'';
            }
            try{onWrite?.();}catch{/* Diagnostics never break setters. */}
        };
        try{Object.defineProperty(obj,key,{configurable:true,enumerable:original.enumerable,get:getter,set:setter});}
        catch{return null;}
        return ()=>{
            const current=Object.getOwnPropertyDescriptor(obj,key);
            if(current?.get===getter&&current?.set===setter)Object.defineProperty(obj,key,{...original,value});
        };
    }
    function watchSwipe(entry){
        restore(entry.swipeStop);entry.swipeStop=null;
        for(const stop of [...entry.nestedStops].reverse())restore(stop);
        entry.nestedStops.length=0;
        const swipes=entry.message?.swipes,slot=Number(entry.message?.swipe_id);
        if(!Array.isArray(swipes)||!Number.isInteger(slot)||slot<0||!Object.hasOwn(swipes,slot))return;
        entry.swipeStop=watchField(entry,swipes,String(slot),'swipes['+slot+']',()=>watchSwipe(entry));
        const obj=swipes[slot];
        if(obj&&typeof obj==='object')for(const key of ['mes','text','content','message']){
            const stop=watchField(entry,obj,key,'swipes['+slot+'].'+key);
            if(stop)entry.nestedStops.push(stop);
        }
    }
    function watch(entry){
        for(const key of ['mes','swipes','swipe_id']){
            const stop=watchField(entry,entry.message,key,'message.'+key,()=>{if(key!=='mes')watchSwipe(entry);});
            if(stop)entry.restores.push(stop);
        }
        watchSwipe(entry);
    }
    function observe(id,message,phase='checkpoint'){
        if(!active()||!Number.isInteger(id)||id<0||!message||message.is_user||message.is_system)return;
        const source=read(message),mes=typeof message.mes==='string'?message.mes:'';
        let entry=tracked.get(id);
        if(entry?.message!==message){
            if(entry){log(entry,entry.lastSource,source,'message-object-replaced','chat[index]',phase);
                unwatch(entry);tracked.delete(id);}
            entry={id,message,lastSource:source,lastMes:mes,phase,restores:[],nestedStops:[],swipeStop:null};
            tracked.set(id,entry);watch(entry);
            if(tracked.size>MAX_TRACKED){const oldest=tracked.keys().next().value;unwatch(tracked.get(oldest));tracked.delete(oldest);}
            return;
        }
        log(entry,entry.lastSource,source,'checkpoint-difference','effective-source',phase);
        if(entry.lastSource===source)log(entry,entry.lastMes,mes,'checkpoint-difference','message.mes',phase,null,false);
        entry.lastSource=source;entry.lastMes=mes;entry.phase=phase;
    }
    function compare(id,before,after,phase='before-apply'){
        if(!active()||before===after)return;
        const change=describeTextChange(before,after);
        push({event:'source-comparison',messageId:id,method:'output-snapshot-compare',
            field:'effective-source',phase,...change,...fullText(String(before),String(after),change),
            possibleWriter:null,frames:[],effectiveSourceChanged:true});
    }
    function reset(){
        for(const entry of tracked.values())unwatch(entry);
        tracked.clear();events.length=0;
    }
    function diagnostics(){
        return {enabled:active(),fullTextEnabled:detailed(),fullTextEventLimit:MAX_FULL_TEXT_EVENTS,
            trackedMessageIds:[...tracked.keys()],
            events:events.map(e=>({...e,frames:e.frames?[...e.frames]:undefined,
                removedTagHints:e.removedTagHints?[...e.removedTagHints]:undefined})),
            limitation:'Writer frames are hints, not proof. Already-stripped text and whole-object replacements may lack a writer. Full RP text appears only with explicit session-only opt-in.'};
    }
    return {observe,compare,reset,diagnostics};
}
