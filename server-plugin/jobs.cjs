'use strict';
const { createHash } = require('node:crypto');
const { failure, extractReply } = require('./provider.cjs');
const ID = /^[a-f0-9]{32}$/;
const MAX_SNAPSHOT = 4 * 1024 * 1024;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createJobs({ engines, request, profileRequest, versions, now = Date.now, retention = 86400000, maxJobs = 32, maxActive = 4 }) {
    const jobs = new Map();
    const key = (owner,id) => JSON.stringify([owner,id]);
    function prune() {
        for(const [k,j] of jobs) if(j.finishedAt && now()-j.finishedAt>retention) jobs.delete(k);
    }
    function lookup(owner,id) {
        if (!ID.test(String(id))) throw failure(400,'잘못된 작업 번호');
        prune(); const job=jobs.get(key(owner,id));
        if(!job) throw failure(404,'작업이 없거나 서버 재시작·보관 기간 만료로 사라졌습니다. 자동 재요청하지 않습니다.');
        return job;
    }
    function report(job,event) { job.events.push({...event, seq: job.eventSequence++}); if(job.events.length>200) job.events.shift(); }
    function status(job,cursor=0) {
        const start=Math.max(0,Math.min(job.raw.length,Number(cursor)||0));
        const next=Math.min(job.raw.length,start+128*1024);
        return { id:job.id,kind:job.kind,state:job.state,createdAt:job.createdAt,finishedAt:job.finishedAt,
            generationDone:job.generationDone,status:job.httpStatus,type:job.type,
            cursor:start,next,data:job.raw.subarray(start,next).toString('base64'),rawBytes:job.raw.length,
            source:job.source,result:job.result,error:job.error,events:job.events };
    }
    function start(owner,envelope,connection) {
        const { id, kind, snapshot, source, options = {}, generation }=envelope || {};
        if(!ID.test(String(id)) || !['output','input','segments','request','generation','observed-generation'].includes(kind)) throw failure(400,'잘못된 번역 작업');
        if(!snapshot || !engines[snapshot.variant] || !snapshot.settings || typeof snapshot.settings!=='object') throw failure(400,'번역 설정이 필요합니다.');
        if(versions && versions[snapshot.variant]?.version!==snapshot.version) throw failure(409,'확장과 서버 번역 엔진 버전이 다릅니다. 둘 다 업데이트해 주세요.');
        if(Buffer.byteLength(JSON.stringify(envelope))>MAX_SNAPSHOT) throw failure(413,'번역 작업 크기 한도 초과');
        if(kind==='generation' && (!generation || typeof generation.payload!=='object')) throw failure(400,'생성 요청이 필요합니다.');
        if(!['generation','observed-generation'].includes(kind) && typeof source!=='string') throw failure(400,'원문이 필요합니다.');
        prune();
        const hash=digest(envelope); const old=jobs.get(key(owner,id));
        if(old) { if(old.digest!==hash) throw failure(409,'같은 작업 번호에 다른 내용이 있습니다.'); return old; }
        for(const old of [...jobs.values()].filter(j=>j.owner===owner&&j.finishedAt).sort((a,b)=>a.finishedAt-b.finishedAt)) {
            if([...jobs.values()].filter(j=>j.owner===owner).length<maxJobs)break; jobs.delete(key(owner,old.id));
        }
        const own=[...jobs.values()].filter(j=>j.owner===owner);
        if(own.filter(j=>!j.finishedAt).length>=maxActive || own.length>=maxJobs || jobs.size>=128)
            throw failure(429,'서버 작업·보관 한도에 도달했습니다. 완료 작업을 확인하거나 삭제해 주세요.');
        const controller=new AbortController();
        const job={id,owner,kind,digest:hash,createdAt:now(),finishedAt:null,state:'queued',events:[],eventSequence:0,
            controller,raw:Buffer.alloc(0),generationDone:!['generation','observed-generation'].includes(kind),httpStatus:0,type:'',source:source||'',result:null,error:''};
        jobs.set(key(owner,id),job);
        if(kind==='observed-generation')job.response=new Promise((resolve,reject)=>{
            job.receive=resolve;
            controller.signal.addEventListener('abort',()=>reject(new DOMException('취소','AbortError')),{once:true});
        });
        job.done=(async()=>{
            try {
                const engine=engines[snapshot.variant].createEngine(snapshot,(...args)=>profileRequest(connection,snapshot.profiles,...args),e=>report(job,e));
                if(['generation','observed-generation'].includes(kind)) {
                    job.state='generating';
                    const timeout=setTimeout(()=>controller.abort(),20*60*1000);timeout.unref?.();
                    let response;
                    try { response=kind==='observed-generation' ? await job.response : await request(connection,generation.path,generation.payload,{
                        signal:controller.signal,
                        onHeaders(status,type){job.httpStatus=status;job.type=type;},
                        onChunk(chunk){
                            const total=[...jobs.values()].reduce((sum,j)=>sum+j.raw.length,0);
                            if(total+chunk.length>64*1024*1024){controller.abort();return;}
                            job.raw=Buffer.concat([job.raw,chunk]);
                        },
                    }); } finally { clearTimeout(timeout); }
                    job.generationDone=true;
                    if(response.status<200||response.status>=300) throw failure(response.status,`답변 생성 HTTP ${response.status}`);
                    job.source=(String(generation?.prefix || '')+extractReply(response.body,response.type)).trim();
                    if(!job.source.trim()) throw failure(422,'자동번역할 답변 텍스트가 없습니다.');
                }
                if(controller.signal.aborted) throw new DOMException('취소','AbortError');
                job.state='translating';
                const runOptions={...options,signal:controller.signal};
                let result;
                if(kind==='input') result=await engine.input(job.source,runOptions);
                else if(kind==='segments') result=[...await engine.segments(job.source,envelope.segments,runOptions)];
                else if(kind==='request') result=await engine.request(job.source,runOptions);
                else if(['generation','observed-generation'].includes(kind) && !engine.shouldTranslate(job.source)) result={skipped:true,translation:job.source,sourceMap:[]};
                else result=await engine.output(job.source,runOptions);
                if(controller.signal.aborted) throw new DOMException('취소','AbortError');
                job.result=result; job.state='completed';
            } catch(error) {
                job.state=controller.signal.aborted?'cancelled':'failed';
                // Raw provider errors may echo secrets/prompts. Keep public errors structural.
                job.error=controller.signal.aborted?'사용자가 작업을 중지했습니다.':`서버 작업 실패${error.status?' (HTTP '+error.status+')':''}. 진단 단계와 연결 프로필을 확인해 주세요.`;
                report(job,{kind:'failure',code:String(error.code||error.name||'Error'),httpStatus:Number(error.status)||null});
            } finally { job.finishedAt=now(); job.generationDone=true; }
        })();
        return job;
    }
    function cancel(owner,id) { const j=lookup(owner,id); if(!j.finishedAt) j.controller.abort(); return j; }
    function remove(owner,id) {const j=lookup(owner,id);if(!j.finishedAt)throw failure(409,'진행 중인 작업은 먼저 중지해 주세요.');jobs.delete(key(owner,id));}
    function observed(owner,id,response) {
        let job;try{job=lookup(owner,id);}catch{return false;}
        if(job.kind!=='observed-generation'||job.finishedAt||job.received)return false;
        job.received=true;job.httpStatus=response.status;job.type=response.type;
        if(response.state!=='completed'){job.controller.abort();return true;}
        job.receive(response);return true;
    }
    function stopAll(){for(const j of jobs.values())if(!j.finishedAt)j.controller.abort();}
    return {start,lookup,status,cancel,remove,stopAll,observed};
}
module.exports={createJobs};
