// Optional server transport. Disabled installations do not contact the plugin.
const API = '/api/plugins/verba-server';
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const abortError = () => new DOMException('번역을 중지했습니다.','AbortError');
const clean = value => JSON.parse(JSON.stringify(value));
const fingerprint = value => { let h=14695981039346656037n; for(const c of value){h^=BigInt(c.codePointAt(0));h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16); };
const hasMarker = (data,marker) => JSON.stringify(data).includes(marker);
export async function captureConnectionProfiles(context, ids) {
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
    const storageKey='verba-server-jobs:'+variant;
    const frames=[]; let records=[]; let ready=false; let relayObserver=false; let installedFetch=null;
    const fetchBase=globalThis.fetch.bind(globalThis);
    const scopeKey=()=>{const c=getContext();return JSON.stringify([c.chatId??'',c.characterId??'',c.groupId??'',c.name2??'']);};
    try{records=JSON.parse(localStorage.getItem(storageKey)||'[]').filter(x=>/^[a-f0-9]{32}$/.test(x.id)).slice(-32);}catch{}
    function save(){try{localStorage.setItem(storageKey,JSON.stringify(records.slice(-32)));}catch{}}
    function remember(row){records=records.filter(x=>x.id!==row.id);records.push(row);save();}
    function forget(id){records=records.filter(x=>x.id!==id);save();}
    async function api(path,init={}) {
        // This controller belongs only to one HTTP exchange. It never means
        // the user cancelled the server-owned generation/translation job.
        const controller=new AbortController();let timedOut=false;
        const timer=setTimeout(()=>{timedOut=true;controller.abort();},20000);
        try {
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
        } finally{clearTimeout(timer);}
    }
    const relayActive=()=>{try{return globalThis.sillyRelayReplies?.apiVersion===1 && localStorage.getItem('silly-relay-enabled-v1')==='true';}catch{return false;}};
    async function check(){
        const caps=await api('/capabilities');
        if(caps.protocol!==1||caps.engines?.[variant]?.version!==version)throw Error('확장과 서버 플러그인의 버전이 다릅니다. 서버 플러그인도 업데이트해 주세요.');
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
        remember({id:envelope.id,scope:scopeKey(),kind:envelope.kind==='observed-generation'?'generation':envelope.kind,config:fingerprint(configurationKey()),at:Date.now()});
        for(let i=0;;i++){
            if(signal?.aborted){await cancel(envelope.id);throw abortError();}
            try{return await api('/jobs',{method:'POST',body:JSON.stringify(envelope)});}
            catch(error){if(error.status){forget(envelope.id);throw error;}if(i===0)onNotice('접수 여부 확인 중입니다. 같은 작업 번호로 재연결합니다.');await pause(2000);}
        }
    }
    async function status(id,cursor=0){return api('/jobs/'+id+'?cursor='+cursor);}
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
                try{state=await status(id);}catch(error){if(error.status)throw error;await pause(2000);continue;}
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
        const recent=[...records].reverse().find(r=>r.scope===scopeKey()&&r.kind==='generation');
        for(const record of (recent && options.stage!=='output-retranslation' ? [recent] : [])){
            if(record.cancel || record.config!==fingerprint(configurationKey()))continue;
            let state;
            try{state=await reconnectStatus(record.id,options.signal);}catch(error){if(error.status===404){forget(record.id);continue;}throw error;}
            if(!state.generationDone||state.source!==source)continue;
            if(['failed','cancelled'].includes(state.state))throw Error(state.error);
            const done=await waitResult(record.id,options.signal);
            record.kind='used';save();
            return done.result;
        }
        if(!await available())return local();
        return run('output',source,options);
    }
    async function run(kind,source,options={},segments){
        const id=newId();
        const envelope={id,kind,source,snapshot:await snapshot(),options:clean({...options,signal:undefined,timing:undefined}),...(segments?{segments}: {})};
        if(options.signal?.aborted)throw abortError();
        await submit(envelope,options.signal);
        const state=await waitResult(id,options.signal);
        return state.result;
    }
    async function input(source,options,local){return await available()?run('input',source,options):local();}
    function generationStarted(type,options={},dryRun=false){
        frames.push({eligible:!dryRun&&!options?.quietToLoud&&[undefined,'normal','regenerate','swipe','continue'].includes(type),type,data:null,request:null});
        if(frames.length>32)frames.splice(0,frames.length-32);
    }
    function afterData(data,dryRun=false){const frame=frames.at(-1);if(frame?.eligible&&!dryRun)frame.data=data;}
    function settingsReady(data){
        const frame=frames.at(-1);const prompt=frame?.data?.prompt;
        if(!frame?.eligible||!Array.isArray(prompt)||!Array.isArray(data?.messages))return;
        const messages=prompt.filter(x=>x&&typeof x==='object');
        if(messages.length!==data.messages.length||!messages.every((x,i)=>x===data.messages[i]))return;
        frame.request=data;
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
                try{state=await status(id);}catch(error){if(error.status)throw error;await pause(2000);continue;}
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
                            try{state=await status(id,cursor);}catch(error){if(error.status)throw error;await pause(2000);continue;}
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
            if(JSON.stringify(frame.request)!==init.body)return previous.call(this,input,init);
            const nativePayload=frame.request; frame.request=null;
            let snap;
            try { if(!await available())return previous.call(this,input,init); snap=await snapshot(); }
            catch(error) { onNotice('서버 번역 준비 실패: '+error.message+' · 답변 생성은 기존 방식으로 진행합니다.'); return previous.call(this,input,init); }
            const generationOptions=getGenerationOptions(frame.type);
            if(relayActive()) {
                if(!relayObserver){onNotice('실리릴레이 서버를 업데이트해야 백그라운드 번역을 연결할 수 있습니다.');return previous.call(this,input,init);}
                const ticket=newId();
                await submit({id:ticket,kind:'observed-generation',snapshot:snap,options:clean(generationOptions.options),generation:{prefix:generationOptions.prefix||''}},init.signal);
                // Mutate the same final payload object that Relay identifies,
                // retaining its existing request binding and recovery journal.
                nativePayload.__verba_server_ticket=ticket;
                const stop=()=>void cancel(ticket);init.signal?.addEventListener('abort',stop,{once:true});
                try{return await previous.call(this,input,{...init,body:JSON.stringify(nativePayload)});}
                catch(error){await cancel(ticket);throw error;}
                finally{init.signal?.removeEventListener('abort',stop);}
            }
            return generatedResponse({id:newId(),kind:'generation',snapshot:snap,
                options:clean(generationOptions.options),generation:{path:url.pathname,payload:JSON.parse(init.body),prefix:generationOptions.prefix||''}},init.signal);
        };
        globalThis.fetch=installedFetch;
    }
    function install(){
        const context=getContext();const on=(name,fn)=>{if(context.eventTypes?.[name])context.eventSource.on(context.eventTypes[name],fn);};
        on('GENERATION_STARTED',generationStarted);on('GENERATE_AFTER_DATA',afterData);on('CHAT_COMPLETION_SETTINGS_READY',settingsReady);
        on('GENERATION_ENDED',()=>frames.pop());on('GENERATION_STOPPED',()=>{frames.length=0;});
        const flush=()=>{for(const r of records)if(r.cancel)void cancel(r.id);};
        window.addEventListener('online',flush);document.addEventListener('visibilitychange',()=>{if(!document.hidden)flush();});
        ensureHook();flush();
    }
    return {check,available,output,input,run,install,status,cancel,hasPendingGeneration:()=>records.some(r=>r.scope===scopeKey()&&r.kind==='generation')};
}
