const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..');
function git(cwd,args){const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout.trim();}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'verba git install '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const st=path.join(root,'Silly Tavern');fs.mkdirSync(st);
  fs.writeFileSync(path.join(st,'server.js'),'// fixture');
  fs.writeFileSync(path.join(st,'config.yaml'),'keep: true');
  return {root,st,dest:path.join(st,'plugins/verba-server'),backups:path.join(st,'.verba-server-backups')};
}
function makeRepository(root){
  const repo=path.join(root,'repository');fs.mkdirSync(repo);
  fs.copyFileSync(path.join(source,'package.json'),path.join(repo,'package.json'));
  fs.copyFileSync(path.join(source,'README.md'),path.join(repo,'README.md'));
  fs.cpSync(path.join(source,'server-plugin'),path.join(repo,'server-plugin'),{recursive:true});
  git(repo,['init','-b','main']);git(repo,['config','user.name','test']);git(repo,['config','user.email','test@example.invalid']);
  git(repo,['add','.']);git(repo,['commit','-m','fixture server']);return repo;
}
function install(st,repo){return spawnSync('bash',[path.join(source,'install-server.sh'),st],{encoding:'utf8',env:{...process.env,VERBA_SERVER_REPO_URL:repo,VERBA_SERVER_REPO_BRANCH:'main'}});}
function legacyPlugin(dir,label='legacy-data'){
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({main:'index.cjs'}));
  fs.writeFileSync(path.join(dir,'index.cjs'),"module.exports.info={id:'verba-server'};");
  fs.writeFileSync(path.join(dir,'legacy-note.txt'),label);
}
test('verified Git install atomically migrates a copied plugin and later pulls updates',t=>{
  const {root,st,dest,backups}=fixture(t),repo=makeRepository(root);legacyPlugin(dest,'preserve me');
  const outside=path.join(root,'outside.txt');fs.writeFileSync(outside,'unchanged');fs.symlinkSync(outside,path.join(dest,'legacy-link'));
  const first=install(st,repo);assert.equal(first.status,0,first.stderr||first.stdout);assert.match(first.stdout,/0\.1\.7/);
  assert.equal(git(dest,['rev-parse','--show-toplevel']),dest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'package.json'))).main,'server-plugin/index.cjs');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'server-plugin/package.json'))).version,'0.1.7');
  assert.equal(fs.readFileSync(path.join(st,'config.yaml'),'utf8'),'keep: true');assert.equal(fs.readFileSync(outside,'utf8'),'unchanged');
  const saved=fs.readdirSync(backups).filter(name=>name.startsWith('legacy-verba-server-'));assert.equal(saved.length,1);
  assert.equal(fs.readFileSync(path.join(backups,saved[0],'legacy-note.txt'),'utf8'),'preserve me');
  fs.writeFileSync(path.join(repo,'server-plugin/update-marker.txt'),'updated through git');git(repo,['add','.']);git(repo,['commit','-m','server update']);
  const second=install(st,repo);assert.equal(second.status,0,second.stderr||second.stdout);
  assert.equal(fs.readFileSync(path.join(dest,'server-plugin/update-marker.txt'),'utf8'),'updated through git');
  assert.equal(fs.readdirSync(backups).filter(name=>name.startsWith('legacy-verba-server-')).length,1);
});
test('duplicate Verba Server copies are backed up while unrelated plugins remain active',t=>{
  const {root,st,dest,backups}=fixture(t),repo=makeRepository(root);
  const duplicate=path.join(st,'plugins/verba-server-old-copy');legacyPlugin(duplicate,'duplicate');
  const unrelated=path.join(st,'plugins/unrelated');fs.mkdirSync(unrelated,{recursive:true});
  fs.writeFileSync(path.join(unrelated,'package.json'),JSON.stringify({main:'index.cjs'}));fs.writeFileSync(path.join(unrelated,'index.cjs'),"module.exports.info={id:'another-plugin'};");
  const result=install(st,repo);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.ok(fs.existsSync(dest));assert.ok(fs.existsSync(unrelated));assert.ok(!fs.existsSync(duplicate));
  const saved=fs.readdirSync(backups).filter(name=>name.startsWith('duplicate-verba-server-old-copy-'));assert.equal(saved.length,1);
  assert.equal(fs.readFileSync(path.join(backups,saved[0],'legacy-note.txt'),'utf8'),'duplicate');
});
test('failed download leaves the legacy active plugin untouched',t=>{
  const {root,st,dest}=fixture(t);legacyPlugin(dest,'still active');
  const missing=path.join(root,'missing-repository');const result=install(st,missing);assert.notEqual(result.status,0);
  assert.equal(fs.readFileSync(path.join(dest,'legacy-note.txt'),'utf8'),'still active');
});
test('invalid SillyTavern path fails before creating a plugin',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'verba invalid install '));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=makeRepository(root),st=path.join(root,'not-silly');fs.mkdirSync(st);const result=install(st,repo);assert.notEqual(result.status,0);
  assert.equal(fs.existsSync(path.join(st,'plugins/verba-server')),false);
});
