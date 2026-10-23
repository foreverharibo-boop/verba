const test=require('node:test');
const assert=require('node:assert/strict');
const plugin=require('../index.cjs');
test('plugin routes require native ST identity and matching engine versions',async t=>{
 const routes=new Map();const router={};
 for(const method of ['get','post','delete'])router[method]=(path,fn)=>routes.set(method+path,fn);
 await plugin.init(router);t.after(()=>plugin.exit());
 async function call(method,path,extra={}){
  const req={headers:{},params:{},query:{},socket:{localAddress:'127.0.0.1',localPort:8000},...extra};
  const result={status:200};const res={set(){},status(n){result.status=n;return this;},json(body){result.body=body;}};
  await routes.get(method+path)(req,res);return result;
 }
 assert.equal((await call('get','/capabilities')).status,401);
 const user={profile:{handle:'alice'}};
 assert.equal((await call('get','/capabilities',{user})).body.protocol,1);
 assert.equal((await call('post','/jobs',{user,body:{id:'a'.repeat(32),kind:'output',source:'Hello',snapshot:{variant:'verba',version:'wrong',settings:{}}}})).status,409);
 assert.equal((await call('get','/jobs/:id',{user,params:{id:'b'.repeat(32)}})).status,404);
});
