const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'verba install '));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const st=path.join(root,'Silly Tavern');fs.mkdirSync(st);
 fs.writeFileSync(path.join(st,'server.js'),'// fixture');fs.writeFileSync(path.join(st,'config.yaml'),'keep: true');
 return {root,st,dest:path.join(st,'plugins/verba-server')};
}
function install(st,from=source){return spawnSync('bash',[path.join(from,'install-server.sh'),st],{encoding:'utf8'});}
test('one command installs and overwrites managed files, without deleting settings, extras or making backups',t=>{
 const {st,dest}=fixture(t);
 const first=install(st);assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/0\.1\.3/);
 fs.writeFileSync(path.join(dest,'index.cjs'),'old version');
 fs.writeFileSync(path.join(dest,'custom-note.txt'),'keep note');
 fs.writeFileSync(path.join(dest,'engines/custom.txt'),'keep extra');
 const second=install(st);assert.equal(second.status,0,second.stderr);
 assert.equal(fs.readFileSync(path.join(dest,'index.cjs'),'utf8'),fs.readFileSync(path.join(source,'server-plugin/index.cjs'),'utf8'));
 assert.equal(fs.readFileSync(path.join(st,'config.yaml'),'utf8'),'keep: true');
 assert.equal(fs.readFileSync(path.join(dest,'custom-note.txt'),'utf8'),'keep note');
 assert.equal(fs.readFileSync(path.join(dest,'engines/custom.txt'),'utf8'),'keep extra');
 assert.deepEqual(fs.readdirSync(st).sort(),['config.yaml','plugins','server.js']);
 assert.deepEqual(fs.readdirSync(path.join(dest,'engines')).sort(),['custom.txt','manifest.json','verba-deep.mjs','verba.mjs']);
});
test('an incomplete or syntactically broken download fails before touching the old installation',t=>{
 const {root,st,dest}=fixture(t);assert.equal(install(st).status,0);
 const before=fs.readFileSync(path.join(dest,'index.cjs'),'utf8');
 const broken=path.join(root,'download');fs.mkdirSync(broken);
 fs.copyFileSync(path.join(source,'install-server.sh'),path.join(broken,'install-server.sh'));
 fs.copyFileSync(path.join(source,'SERVER.md'),path.join(broken,'SERVER.md'));
 fs.cpSync(path.join(source,'server-plugin'),path.join(broken,'server-plugin'),{recursive:true});
 const provider=path.join(broken,'server-plugin/provider.cjs');fs.unlinkSync(provider);
 assert.notEqual(install(st,broken).status,0);
 assert.equal(fs.readFileSync(path.join(dest,'index.cjs'),'utf8'),before);
 fs.writeFileSync(provider,'const invalid = ;');assert.notEqual(install(st,broken).status,0);
 assert.equal(fs.readFileSync(path.join(dest,'index.cjs'),'utf8'),before);
 assert.deepEqual(fs.readdirSync(st).sort(),['config.yaml','plugins','server.js']);
});
test('a symlink in a managed destination cannot overwrite a file outside the plugin',t=>{
 const {root,st,dest}=fixture(t);assert.equal(install(st).status,0);
 const outside=path.join(root,'outside');fs.writeFileSync(outside,'unchanged');
 fs.unlinkSync(path.join(dest,'jobs.cjs'));fs.symlinkSync(outside,path.join(dest,'jobs.cjs'));
 assert.notEqual(install(st).status,0);assert.equal(fs.readFileSync(outside,'utf8'),'unchanged');
});
