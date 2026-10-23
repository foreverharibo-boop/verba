// Read-only browser execution timeline for foreground translation diagnostics.
// Visibility != freeze. Freeze events prove event delivery, but an unobserved
// JavaScript timer gap merely suggests background throttling or suspension.
const MAX_EVENTS = 42;
const MAX_JOBS = 8;
const HEARTBEAT_MS = 2500;
const DELAY_THRESHOLD_MS = 10000;
const META_FIELDS = new Set([
    'reason','swipeChanged','chatChanged','sourceChanged','retryScheduled','attempt',
    'beforeLength','afterLength','delayMs','gapMs','hiddenMs','freezeEventObserved',
    'visible','success','status','outputStage',
]);
function safeMeta(info={}) {
    const out={};
    for(const [key,value] of Object.entries(info||{})){
        if(!META_FIELDS.has(key))continue;
        if(typeof value==='boolean')out[key]=value;
        else if(typeof value==='number'&&Number.isFinite(value))out[key]=Math.max(0,Math.round(value));
        else if(typeof value==='string'&&/^[a-z0-9_.-]{1,64}$/i.test(value))out[key]=value;
    }
    return out;
}
export function createBrowserExecutionDiagnostics({
    enabled=()=>false, now=Date.now,
    visibility=()=> 'unknown',
    schedule=(fn,ms)=>setInterval(fn,ms),
    unschedule=id=>clearInterval(id),
}={}) {
    const events=[],jobs=new Map();
    let hiddenAt=null,freezeObserved=false,freezeAt=null,lastHeartbeat=null,timer=null;
    let lastHiddenWindow=null,delayedTimerCount=0,freezeEventCount=0;
    const active=()=>enabled()===true;
    const visible=()=>visibility();
    function push(event,messageId=null,metadata={}){
        if(!active())return;
        const row={event,at:now(),messageId:Number.isInteger(messageId)?messageId:null,
            visibility:visible(),...safeMeta(metadata)};
        events.push(row);if(events.length>MAX_EVENTS)events.shift();
        if(row.messageId!==null){
            const prior=jobs.get(row.messageId)||{messageId:row.messageId};
            const state={...prior,lastStage:event,lastAt:row.at,visibility:row.visibility};
            if(event==='output-started')state.startedAt=row.at;
            if(['translation-applied','translation-render-failed','translation-failed',
                 'translation-aborted','translation-skipped','translation-stale'].includes(event))
                state.outcome=event;
            jobs.delete(row.messageId);jobs.set(row.messageId,state);
            if(jobs.size>MAX_JOBS)jobs.delete(jobs.keys().next().value);
        }
    }
    function heartbeat(){
        if(!active())return;
        const time=now(),gap=lastHeartbeat===null?0:time-lastHeartbeat;
        if(gap>DELAY_THRESHOLD_MS){
            delayedTimerCount++;
            push('javascript-timer-gap',null,{gapMs:gap,reason:visible()==='hidden'?'hidden-timer-delayed':'timer-delayed'});
        }
        lastHeartbeat=time;
    }
    function page(event){
        if(!active())return;
        heartbeat();
        const time=now();
        if(event==='hidden'){
            hiddenAt=time;freezeObserved=false;freezeAt=null;
            push('page-hidden');return;
        }
        if(event==='freeze'){
            freezeEventCount++;
            freezeObserved=true;freezeAt=time;
            push('page-freeze-event');return;
        }
        if(event==='visible'||event==='resume'){
            if(hiddenAt!==null){
                lastHiddenWindow={hiddenMs:Math.max(0,time-hiddenAt),freezeEventObserved:freezeObserved,
                    freezeAt,openedAt:time};
                // The browser may emit both resume and visibilitychange; close once.
                hiddenAt=null;freezeAt=null;freezeObserved=false;
                push('page-returned',null,lastHiddenWindow);
            }else if(event==='resume')push('page-resume-event');
            return;
        }
        push(event);
    }
    function start(){
        if(!active()||timer!==null)return;
        lastHeartbeat=now();
        timer=schedule(heartbeat,HEARTBEAT_MS);
        push('diagnostics-started');
    }
    function clear({dropTimer=false}={}){
        events.length=0;jobs.clear();
        hiddenAt=null;freezeObserved=false;freezeAt=null;lastHeartbeat=now();
        lastHiddenWindow=null;delayedTimerCount=0;freezeEventCount=0;
        if(dropTimer){if(timer!==null)unschedule(timer);timer=null;lastHeartbeat=null;}
    }
    function diagnostics(){
        const suspended=lastHiddenWindow?.freezeEventObserved||false;
        return {
            enabled:active(),
            assessment:suspended?'freeze-event-seen'
                :delayedTimerCount?'javascript-timer-delay-observed'
                :lastHiddenWindow?'background-excursion-seen-no-freeze-proof'
                :'no-browser-freeze-evidence',
            note:'page-hidden alone is not browser freeze. Timer delays may mean throttling, OS suspension or scheduling. No JavaScript can log while execution is frozen.',
            freezeEventCount,delayedTimerCount,
            lastHiddenWindow:lastHiddenWindow?{hiddenMs:lastHiddenWindow.hiddenMs,
                freezeEventObserved:lastHiddenWindow.freezeEventObserved}:null,
            latestJobs:[...jobs.values()].map(x=>({...x})),
            events:events.map(x=>({...x})),
        };
    }
    return{start,clear,page,heartbeat,trace:push,diagnostics};
}
