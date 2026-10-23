import { compatibleCompletedSource, reconcileCompletedResult, describeSourceChange } from './server-result-compat.js?v=2';
// Optional server transport. Disabled installations do not contact the plugin.
import { installVertexModelCompatibility } from './model-compat.js';
const API = '/api/plugins/verba-server';
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const abortError = () => new DOMException('번역을 중지했습니다.','AbortError');
const clean = value => JSON.parse(JSON.stringify(value));
const fingerprint = value => { let h=14695981039346656037n; for(const c of value){h^=BigInt(c.codePointAt(0));h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16); };
const hasMarker = (data,marker) => JSON.stringify(data).includes(marker);
// TTOTTO consumes this browser-only marker in its fetch wrapper. Its removal
// does not change the bound AI request; every other field must still match.
const replyBody = data => { const body={...data};delete body.__ttotto_main_request;return JSON.stringify(body); };
// Both translator extensions share ST's service classes. Serialize only this
// short, non-network capture so nested wrappers cannot restore each other in
// the wrong order. Translation requests themselves still run concurrently.
const CAPTURE_QUEUE = Symbol.for('verba.profile-capture.queue.v1');
export function captureConnectionProfiles(context, ids) {
    const selected = [...ids];
    const previous = globalThis[CAPTURE_QUEUE] || Promise.resolve();
    const request = previous.then(() => captureProfiles(context, selected));
    const tail = request.then(() => undefined, () => undefined);
    globalThis[CAPTURE_QUEUE] = tail;
    void tail.then(() => { if (globalThis[CAPTURE_QUEUE] === tail) delete globalThis[CAPTURE_QUEUE]; });
    return request;
}
async function captureProfiles(context, ids) {
    const result={};
    for(const id of [...new Set(ids.filter(Boolean))]) {
        const marker='VERBA_CAPTURE_'+newId();
        const restores=[]; let capture=null;
        for(const [name,path] of [['ChatCompletionService','/api/backends/chat-completions/generate'],['TextCompletionService','/api/backends/text-completions/generate']]) {
            const service=context[name];
            if(!service?.sendRequest)continue;
            const original=service.sendRequest;
            const wrapped=function(data,...args){
                if(hasMarker(data,marker)){capture={path,payload:clean(data),marker};return Promise.resolve({content:'captured'});}
                return original.call(this,data,...args);
            };
            service.sendRequest=wrapped;
            restores.push(()=>{if(service.sendRequest===wrapped)service.sendRequest=original;});
        }
        try {
            if(!restores.length)throw Error('실리태번 연결 서비스가 서버 번역 준비를 지원하지 않습니다.');
            // Native profile AND preset construction, stopped before any AI request.
            await context.ConnectionManagerRequestService.sendRequest(id,[{role:'user',content:marker}],15000,{stream:false});
            if(!capture)throw Error('연결 프로필 요청 구성을 가져오지 못했습니다.');
            result[id]=capture;
        } finally {for(const restore of restores.reverse())restore();}
    }
    return result;
}
export function createServerClient({variant,version,getSettings,getContext,isActive,getSnapshot,getGenerationOptions,onProgress=()=>{},onNotice=()=>{}}) {
    // Register during module evaluation, before ST announces APP_READY.
    installVertexModelCompatibility(getContext);
    const storageKey='verba-server-jobs:'+variant;
    const frames=[]; let records=[]; let ready=false; let relayObserver=false; let installedFetch=null;
    const history=[];
    let serverVersion=null;
    const jobDiagnostics=new Map();
    const pendingReads=new Set();
    const resumedRead=()=>Object.assign(Error('서버 결과 수신 연결 재개'),{code:'VERBA_SERVER_READ_RESUMED'});
    function trace(event,detail={}){
        history.push({event,at:Date.now(),...detail});
        if(history.length>40)history.shift();
    }
    function captureNotification(type='normal') {
        // APK has a dedicated bridge so other notification extensions cannot
        // replace its opt-in state through the shared legacy global.
        const dedicated=globalThis[Symbol.for('silly-pop.apk.notifications.v1')];
        const bridge=dedicated||globalThis.sillyPopNotifications;
        const owner=dedicated?'apk':bridge?'legacy':'missing';
        try {
            if(typeof bridge?.captureTranslation!=='function'){
                trace('notification-capture',{bridge:owner,requested:false,reason:'unavailable'});return undefined;
            }
            const marker=bridge.captureTranslation(type)||undefined;
            const requested=marker?.translationEnabled===true;
            trace('notification-capture',{bridge:owner,requested,reason:requested?'captured':'disabled-or-unsupported'});
            return requested?marker:undefined;
        } catch {
            trace('notification-capture',{bridge:owner,requested:false,reason:'capture-error'});
            return undefined;
        }
    }
    const fetchBase=globalThis.fetch.bind(globalThis);
    const scopeKey=()=>{const c=getContext();return JSON.stringify([c.chatId??'',c.characterId??'',c.groupId??'',c.name2??'']);};
    try{records=JSON.parse(localStorage.getItem(storageKey)||'[]').filter(x=>/^[a-f0-9]{32}$/.test(x.id)).slice(-32);}catch{}
    function save(){try{localStorage.setItem(storageKey,JSON.stringify(records.slice(-32)));}catch{}}
    function remember(row){records=records.filter(x=>x.id!==row.id);records.push(row);save();}
    function forget(id){records=records.filter(x=>x.id!==id);save();}
    async function api(path,init={},timeoutMs=20000) {
        // This controller belongs only to one HTTP exchange. It never means
        // the user cancelled the server-owned generation/translation job.
        const controller=new AbortController();let timedOut=false;
        let interrupt;
        const interrupted=new Promise((_,reject)=>{interrupt=error=>{reject(error);controller.abort();};});
        const restart=()=>{pendingReads.delete(restart);interrupt(resumedRead());};
        const resumable=path.startsWith('/jobs/')&&(!init.method||init.method==='GET');
        if(resumable)pendingReads.add(restart);
        const timer=setTimeout(()=>{timedOut=true;interrupt(new DOMException('서버 통신 시간 초과','AbortError'));},timeoutMs);
        try {
            return await Promise.race([interrupted,(async()=>{
            const response=await fetchBase(API+path,{...init,headers:getContext().getRequestHeaders(),signal:controller.signal,cache:'no-store'});
            let data;
            try{data=await response.json();}
            catch(error){
                if(controller.signal.aborted||error?.name==='AbortError')throw error;
                if(response.ok)throw Object.assign(Error('서버 응답을 끝까지 읽지 못했습니다.'),{code:'VERBA_SERVER_RESPONSE_INCOMPLETE'});
                data={};
            }
            if(!response.ok)throw Object.assign(Error(data.error||`서버 번역 HTTP ${response.status}`),{status:response.status});
            return data;
            })()]);
        } catch(error) {
            if(timedOut||error?.name==='AbortError') {
                // Do not retain an AbortError cause: legacy isAbort also walks
                // causes, and would misclassify a connection timeout as cancel.
                throw Object.assign(Error(timedOut
                    ? '서버 통신 대기 시간을 초과했습니다. 서버 작업의 취소를 뜻하지 않습니다.'
                    : '서버와의 통신이 끊겼습니다. 서버 작업의 취소를 뜻하지 않습니다.'),{
                    code:timedOut?'VERBA_SERVER_CONNECTION_TIMEOUT':'VERBA_SERVER_CONNECTION_INTERRUPTED',
                });
            }
            throw error;
        } finally{clearTimeout(timer);pendingReads.delete(restart);}
    }
    const relayActive=()=>{try{return globalThis.sillyRelayReplies?.apiVersion===1 && localStorage.getItem('silly-relay-enabled-v1')==='true';}catch{return false;}};
    async function check(){
        const caps=await api('/capabilities');
        if(caps.protocol!==1||caps.engines?.[variant]?.version!==version)throw Error('확장과 서버 플러그인의 버전이 다릅니다. 서버 플러그인도 업데이트해 주세요.');
        serverVersion=/^\d+\.\d+\.\d+$/.test(caps.version)?caps.version:null;
        relayObserver=caps.relayObserver===true;
        if(relayActive()&&!relayObserver)throw Error('실리릴레이 서버 1.0.6 이상이 필요합니다. 기존 답변 복구 기능을 유지하기 위한 연결입니다.');
        ready=true;return caps;
    }
    async function available(){
        if(getSettings().serverTranslation!==true||!isActive())return false;
        if(ready)return true;
        try{await check();return true;}catch(error){if(error.status===404){onNotice('서버 플러그인이 없어 기존 브라우저 번역을 사용합니다.');return false;}throw error;}
    }
    const configurationKey=()=>{ const value=getSnapshot(); value.settings={...value.settings,serverTranslation:undefined}; return JSON.stringify(value); };
    async function snapshot(){
        const value=clean(getSnapshot());
        value.variant=variant;
        value.version=version;
        value.profiles=value.settings.translationEngine==='google-free'?{}:await captureConnectionProfiles(getContext(),[
            value.settings.profileId,value.settings.fallbackProfileId,value.settings.thirdProfileId]);
        return value;
    }
    async function cancel(id){
        const record=records.find(x=>x.id===id);if(record){record.cancel=true;save();}
        try{await api('/jobs/'+id+'/cancel',{method:'POST',body:'{}'});if(record){record.cancel=false;save();}}catch{onNotice('중지 요청을 아직 전달하지 못했습니다. 연결이 돌아오면 다시 전달합니다.');}
    }
    async function submit(envelope,signal){
        // Retain the ID before sending. An ambiguous timeout never falls back to
        // another translation request. Only the exact same ID/body is retried.
        remember({id:envelope.id,scope:scopeKey(),kind:envelope.kind==='observed-generation'?'generation':envelope.kind,config:fingerprint(configurationKey()),notificationRequested:envelope.notification?.translationEnabled===true,automaticOutput:envelope.kind==='output'&&envelope.options?.automatic===true&&envelope.options?.stage==='output-translation',at:Date.now()});
        for(let i=0;;i++){
            if(signal?.aborted){await cancel(envelope.id);throw abortError();}
            try{return await api('/jobs',{method:'POST',body:JSON.stringify(envelope)});}
            catch(error){if(error.status){forget(envelope.id);throw error;}if(i===0)onNotice('접수 여부 확인 중입니다. 같은 작업 번호로 재연결합니다.');await pause(2000);}
        }
    }
    function observeStatus(id,state) {
        // Fixed structural fields only. Never copy source, result, names, profile
        // payloads or provider error strings into the diagnostic report.
        const notificationCodes=new Set(['notifier_unavailable','prepare_failed','completed','dispatched','duplicate','foreground','disabled','inactive','capacity','delivery_failed']);
        const record=records.find(r=>r.id===id);
        jobDiagnostics.set(id,{
            jobId:id.slice(0,8),
            kind:['generation','observed-generation','output','input','segments','request'].includes(state.kind)?state.kind:'unknown',
            state:['queued','generating','translating','completed','failed','cancelled'].includes(state.state)?state.state:'unknown',
            generationDone:state.generationDone===true,
            hasTranslation:typeof state.result?.translation==='string'&&!!state.result.translation.trim(),
            skipped:state.result?.skipped===true,
            notificationRequested:typeof record?.notificationRequested==='boolean'?record.notificationRequested:null,
            notificationResults:(state.events||[]).filter(e=>e.kind==='notification').map(e=>notificationCodes.has(e.code)?e.code:'unknown').slice(-8),
        });
        if(jobDiagnostics.size>16)jobDiagnostics.delete(jobDiagnostics.keys().next().value);
    }
    async function status(id,cursor=0,timeoutMs=20000){
        const state=await api('/jobs/'+id+'?cursor='+cursor,{},timeoutMs);
        observeStatus(id,state);return state;
    }
    async function refreshDiagnostics(){
        if(getSettings().serverTranslation!==true||!isActive())return;
        const recent=records.filter(r=>r.scope===scopeKey()).slice(-3);
        // Read-only and bounded: copying a diagnostic cannot generate, cancel,
        // retranslate, or deliver an extra notification.
        await Promise.all([
            api('/capabilities',{},3000).then(caps=>{serverVersion=/^\d+\.\d+\.\d+$/.test(caps.version)?caps.version:null;}).catch(()=>{}),
            ...recent.map(r=>status(r.id,0,3000).catch(error=>trace('diagnostic-read-unavailable',{jobId:r.id.slice(0,8),httpStatus:Number(error.status)||null}))),
        ]);
    }
    async function reconnectStatus(id,signal){
        let notified=false;
        const stop=()=>void cancel(id);
        signal?.addEventListener('abort',stop,{once:true});
        try{
            while(true){
                if(signal?.aborted){await cancel(id);throw abortError();}
                try{
                    const state=await status(id);
                    if(signal?.aborted)throw abortError();
                    return state;
                }catch(error){
                    if(signal?.aborted)throw abortError();
                    if(error.status)throw error;
                    if(error.code==='VERBA_SERVER_READ_RESUMED')continue;
                    if(!notified){onNotice('서버 작업 상태를 다시 확인하고 있어요. 같은 작업에 재연결합니다.');notified=true;}
                    await pause(2000);
                }
            }
        }finally{signal?.removeEventListener('abort',stop);}
    }
    async function waitResult(id,signal){
        const stop=()=>void cancel(id);signal?.addEventListener('abort',stop,{once:true});
        try {
            while(true){
                if(signal?.aborted){await cancel(id);throw abortError();}
                let state;
                try{state=await status(id);}catch(error){if(error.status)throw error;if(error.code!=='VERBA_SERVER_READ_RESUMED')await pause(2000);continue;}
                const record=records.find(r=>r.id===id);
            const events=(state.events||[]).filter(e=>e.seq>(record?.eventSeq??-1));
            onProgress({...state,events});
            if(record&&events.length){record.eventSeq=events.at(-1).seq;save();}
                if(state.state==='completed')return state;
                if(['failed','cancelled'].includes(state.state))throw Error(state.error||'서버 번역이 중지됐습니다.');
                await pause(700);
            }
        }finally{signal?.removeEventListener('abort',stop);}
    }
    async function output(source,options,local){
        // Only a generation in the same chat and with the EXACT final source is
        // reusable. Regex/other extension changes never receive stale results.
        // Reading is not an acknowledgement of UI application: a frozen page or
        // message finalization may retry after the first read. Include the most
        // recent used generation, without searching older mismatching replies.
        // A later output is a barrier against older generations. Automatic output
        // results themselves are reusable; a manual output remains a barrier.
        const recent=[...records].reverse().find(r=>r.scope===scopeKey()&&['generation','used','output'].includes(r.kind));
        for(const record of (recent && (recent.kind!=='output'||recent.automaticOutput&&options.automatic===true) && options.stage!=='output-retranslation' ? [recent] : [])){
            if(record.cancel || record.config!==fingerprint(configurationKey())){trace('reuse-skipped',{reason:record.cancel?'cancelled':'settings-changed'});continue;}
            let state;
            try{state=await reconnectStatus(record.id,options.signal);}catch(error){if(error.status===404){forget(record.id);continue;}throw error;}
            source=options.refreshSource?.() ?? source;
            if(!state.generationDone||!compatibleCompletedSource(state.source,source)){trace('reuse-skipped',{reason:!state.generationDone?'generation-pending':'source-changed',...describeSourceChange(state.source,source)});continue;}
            if(['failed','cancelled'].includes(state.state))throw Error(state.error);
            const done=await waitResult(record.id,options.signal);
            source=options.refreshSource?.() ?? source;
            const result=reconcileCompletedResult(done.source,source,done.result);
            if(!result){trace('reuse-skipped',{reason:'result-cleanup-unsafe',...describeSourceChange(done.source,source)});continue;}
            if(record.kind!=='output')record.kind='used';save();
            trace('automatic-result-reused',{...describeSourceChange(done.source,source)});
            return result;
        }
        const serverAvailable=await available();
        source=options.refreshSource?.() ?? source;
        if(!serverAvailable)return local(source);
        trace('browser-output-submitted',{automaticJobKnown:!!recent});
        return run('output',source,options);
    }
    async function run(kind,source,options={},segments){
        const id=newId();
        // Snapshot opt-in metadata before profile preparation can yield or the
        // user switches chats. Manual/helper translations remain silent.
        let notification;
        if(kind==='output'&&options.automatic===true&&options.stage==='output-translation'){
            const marker=captureNotification('normal');
            // Every newly submitted automatic translation is a new revision.
            // Keep one stable completion key for HTTP retries of this exact job,
            // independent of the APK's still-active generation frame. Reusing a
            // finished result never reaches this branch and cannot notify again.
            if(marker)notification={...marker,generationId:`verba:${variant}:${id}`};
        }
        const envelope={id,kind,source,snapshot:await snapshot(),options:clean({...options,signal:undefined,timing:undefined}),...(notification?{notification}:{}),...(segments?{segments}: {})};
        if(options.signal?.aborted)throw abortError();
        await submit(envelope,options.signal);
        const state=await waitResult(id,options.signal);
        return state.result;
    }
    async function input(source,options,local){return await available()?run('input',source,options):local();}
    function generationStarted(type,options={},dryRun=false){
        // ST's prompt previews return after GENERATE_AFTER_DATA without an
        // ENDED event. Pushing them would strand an ineligible frame over the
        // live reply, silently bypassing automatic server job admission.
        if(dryRun){trace('preview-ignored');return;}
        frames.push({eligible:!dryRun&&!options?.quietToLoud&&[undefined,'normal','regenerate','swipe','continue'].includes(type),type,data:null,request:null});
        if(frames.length>32)frames.splice(0,frames.length-32);
    }
    function afterData(data,dryRun=false){const frame=frames.at(-1);if(frame?.eligible&&!dryRun)frame.data=data;}
    function settingsReady(data){
        const frame=frames.at(-1);const prompt=frame?.data?.prompt;
        if(!frame?.eligible||![undefined,'normal','regenerate','swipe','continue'].includes(data?.type))return;
        if(!Array.isArray(prompt)||!Array.isArray(data?.messages)){trace('reply-not-bound',{reason:'missing-prompt'});return;}
        const messages=prompt.filter(x=>x&&typeof x==='object');
        if(!messages.length||messages.length!==data.messages.length||!messages.every((x,i)=>x===data.messages[i])){trace('reply-not-bound',{reason:'different-messages'});return;}
        frame.request=data;
        trace('reply-bound');
        ensureHook();
    }
    async function generatedResponse(envelope,signal){
        const id=envelope.id;
        await submit(envelope,signal);
        let state;let cursor=0;
        const stop=()=>void cancel(id);
        signal?.addEventListener('abort',stop,{once:true});
        try{
            while(true){
                if(signal?.aborted){await cancel(id);throw abortError();}
                try{state=await status(id);}catch(error){if(error.status)throw error;if(error.code!=='VERBA_SERVER_READ_RESUMED')await pause(2000);continue;}
                if(state.status)break;
                if(['failed','cancelled'].includes(state.state))throw Error(state.error);
                await pause(200);
            }
        }catch(error){signal?.removeEventListener('abort',stop);throw error;}
        const stream=new ReadableStream({
            async pull(controller){
                try{
                    while(true){
                        if(signal?.aborted)throw abortError();
                        if(state.cursor!==cursor){
                            try{state=await status(id,cursor);}catch(error){if(error.status)throw error;if(error.code!=='VERBA_SERVER_READ_RESUMED')await pause(2000);continue;}
                        }
                        if(state.next>cursor){
                            const bytes=Uint8Array.from(atob(state.data),c=>c.charCodeAt(0));
                            cursor=state.next;controller.enqueue(bytes);return;
                        }
                        if(state.generationDone){controller.close();signal?.removeEventListener('abort',stop);return;}
                        await pause(200);state={cursor:-1};
                    }
                }catch(error){controller.error(error);signal?.removeEventListener('abort',stop);}
            },
            cancel(){signal?.removeEventListener('abort',stop);return cancel(id);},
        });
        return new Response(stream,{status:state.status,headers:{'content-type':state.type||'application/json'}});
    }
    function ensureHook(){
        if(globalThis.fetch===installedFetch)return;
        const previous=globalThis.fetch;
        installedFetch=async function(input,init){
            const frame=frames.at(-1);
            let url;try{url=new URL(input instanceof Request?input.url:String(input),location.href);}catch{return previous.call(this,input,init);}
            if(!isActive()||getSettings().serverTranslation!==true||getSettings().autoOutput===false||!frame?.request
                ||url.origin!==location.origin||url.pathname!=='/api/backends/chat-completions/generate'
                ||String(init?.method||'GET').toUpperCase()!=='POST'||typeof init?.body!=='string')return previous.call(this,input,init);
            let wirePayload;
            try{wirePayload=JSON.parse(init.body);}catch{return previous.call(this,input,init);}
            if(!wirePayload||Array.isArray(wirePayload)||typeof wirePayload!=='object'||replyBody(frame.request)!==replyBody(wirePayload)){trace('reply-not-bound',{reason:'wire-body-changed'});return previous.call(this,input,init);}
            const nativePayload=frame.request; frame.request=null;
            // Capture the initiating character before asynchronous profile preparation.
            // Only bound automatic reply jobs get this opt-in metadata, never helpers.
            let notification;
            notification=captureNotification(frame.type);
            let snap;
            try { if(!await available())return previous.call(this,input,init); snap=await snapshot(); }
            catch(error) { trace('automatic-prepare-failed');onNotice('서버 번역 준비 실패: '+error.message+' · 답변 생성은 기존 방식으로 진행합니다.'); return previous.call(this,input,init); }
            const generationOptions=getGenerationOptions(frame.type);
            if(relayActive()) {
                if(!relayObserver){onNotice('실리릴레이 서버를 업데이트해야 백그라운드 번역을 연결할 수 있습니다.');return previous.call(this,input,init);}
                const ticket=newId();
                await submit({id:ticket,kind:'observed-generation',snapshot:snap,notification,options:clean(generationOptions.options),generation:{prefix:generationOptions.prefix||''}},init.signal);
                trace('automatic-submitted',{kind:'observed-generation'});
                // Mutate the same final payload object that Relay identifies,
                // retaining its existing request binding and recovery journal.
                nativePayload.__verba_server_ticket=ticket;
                // Preserve the actual outgoing body: do not reintroduce a
                // marker already consumed by TTOTTO's outer fetch wrapper.
                wirePayload.__verba_server_ticket=ticket;
                const stop=()=>void cancel(ticket);init.signal?.addEventListener('abort',stop,{once:true});
                try{return await previous.call(this,input,{...init,body:JSON.stringify(wirePayload)});}
                catch(error){await cancel(ticket);throw error;}
                finally{init.signal?.removeEventListener('abort',stop);}
            }
            trace('automatic-starting',{kind:'generation'});
            return generatedResponse({id:newId(),kind:'generation',snapshot:snap,notification,
                options:clean(generationOptions.options),generation:{path:url.pathname,payload:wirePayload,prefix:generationOptions.prefix||''}},init.signal);
        };
        globalThis.fetch=installedFetch;
    }
    function install(){
        const context=getContext();const types=context.eventTypes||context.event_types;
        const on=(name,fn,first=false)=>{
            if(!types?.[name])return;
            if(first&&typeof context.eventSource.makeFirst==='function')context.eventSource.makeFirst(types[name],fn);
            else context.eventSource.on(types[name],fn);
        };
        on('GENERATION_STARTED',generationStarted);on('GENERATE_AFTER_DATA',afterData);
        // Bind native message identity before TTOTTO clones/replaces messages.
        // Keep the payload object itself so later legitimate edits are sent.
        on('CHAT_COMPLETION_SETTINGS_READY',settingsReady,true);
        on('GENERATION_ENDED',()=>frames.pop());on('GENERATION_STOPPED',()=>{frames.length=0;});
        const flush=()=>{
            if(pendingReads.size)trace('result-read-resumed',{count:pendingReads.size});
            for(const restart of [...pendingReads])restart();
            for(const r of records)if(r.cancel)void cancel(r.id);
        };
        window.addEventListener('online',flush);window.addEventListener('pageshow',flush);
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)flush();});
        ensureHook();flush();
    }
    return {noteSourceChange:(id,before,after,flags)=>trace('application-source-changed',{messageId:Number.isInteger(id)?id:null,...describeSourceChange(before,after),chatChanged:flags.chatChanged===true,swipeChanged:flags.swipeChanged===true,reconciled:flags.reconciled===true}),check,available,output,input,run,install,status,cancel,refreshDiagnostics,diagnostics:()=>({serverVersion,jobs:records.filter(r=>r.scope===scopeKey()).map(r=>jobDiagnostics.get(r.id)).filter(Boolean).map(row=>({...row,notificationResults:[...row.notificationResults]})),events:history.map(row=>({...row})),pendingAutomatic:records.filter(r=>r.scope===scopeKey()&&r.kind==='generation').length}),hasPendingGeneration:()=>records.some(r=>r.scope===scopeKey()&&r.kind==='generation')};
}
