'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createJobs} = require('./jobs.cjs');
const provider = require('./provider.cjs');
const manifest = require('./engines/manifest.json');
let jobs;
let observer;
function owner(req) {
    const id=req.user?.profile?.handle;
    if(typeof id!=='string'||!id)throw provider.failure(401,'실리태번 로그인이 필요합니다.');
    return id;
}
function route(fn){return async(req,res)=>{try{res.set('Cache-Control','no-store');const value=await fn(req);res.json(value);}catch(e){res.status(Number(e.status)||500).json({error:e.status?e.message:'서버 플러그인 내부 오류'});}};}
module.exports.info={id:'verba-server',name:'Verba Server',description:'선택형 베르바·베에르으바아 서버 번역'};
module.exports.init=async router=>{
    const engines={};
    for(const variant of Object.keys(manifest.engines)) engines[variant]=await import(pathToFileURL(path.join(__dirname,'engines',variant+'.mjs')).href);
    jobs=createJobs({engines,request:provider.requestLocal,profileRequest:provider.sendProfile,versions:manifest.engines,
        onLifecycle(event) {
            const labels={accepted:'작업 접수',translation_started:'번역 시작',completed:'번역 완료',skipped:'번역 생략',failed:'작업 실패',cancelled:'작업 취소'};
            console.info(`[Verba Server] ${new Date(event.at).toISOString()} ${event.id.slice(0,8)} ${event.kind} · ${labels[event.stage]} · ${event.elapsedMs}ms`);
        },
        prepareNotification(owner, marker) {
            const hook=globalThis[Symbol.for('silly-pop.translation-notifier')];
            return hook?.apiVersion===1 ? hook.prepare(owner, marker) : null;
        }});
    observer={apiVersion:1,complete:(owner,id,response)=>jobs.observed(owner,id,response)};
    globalThis[Symbol.for('verba.relay-observer')]=observer;
    router.get('/capabilities',route(req=>{owner(req);return{protocol:1,version:'0.1.2',engines:manifest.engines,retentionSeconds:86400,relayObserver:globalThis[Symbol.for('verba.relay-capability')]===1};}));
    router.post('/jobs',route(req=>jobs.status(jobs.start(owner(req),req.body,provider.ownConnection(req)))));
    router.get('/jobs/:id',route(req=>jobs.status(jobs.lookup(owner(req),req.params.id),req.query.cursor)));
    router.post('/jobs/:id/cancel',route(req=>jobs.status(jobs.cancel(owner(req),req.params.id))));
    router.delete('/jobs/:id',route(req=>{jobs.remove(owner(req),req.params.id);return{ok:true};}));
};
module.exports.exit=()=>{jobs?.stopAll();if(globalThis[Symbol.for('verba.relay-observer')]===observer)delete globalThis[Symbol.for('verba.relay-observer')];};
