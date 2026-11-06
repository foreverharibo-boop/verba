import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exportDebugText} from '../debug-export.js';
const longText='베르바 진단 🐹\n'+('원문과 번역\n"검사": {"거절":false}\n'.repeat(100000));
test('clipboard success does not trigger a file',async()=>{
 let received,files=0;
 assert.equal(await exportDebugText(longText,{copy:async text=>{received=text;},download:()=>files++,filename:'log.txt'}),'clipboard');
 assert.equal(received,longText);assert.equal(files,0);
});
test('clipboard rejection exports the same complete large Unicode snapshot once',async()=>{
 let calls=0,received;
 const method=await exportDebugText(longText,{copy:async()=>{calls++;throw Error('permission denied');},download:(text,filename)=>{received={text,filename};},filename:'log.txt'});
 assert.equal(method,'file');assert.equal(calls,1);assert.deepEqual(received,{text:longText,filename:'log.txt'});
});
test('explicit file export never uses clipboard and download errors propagate',async()=>{
 let copies=0;
 const options={fileOnly:true,filename:'log.txt',copy:async()=>copies++,download:async()=>{throw Error('download failed');}};
 await assert.rejects(exportDebugText(longText,options),/download failed/);assert.equal(copies,0);
});
test('browser download contains full text and defers URL cleanup',async()=>{
 const source=readFileSync(new URL('../debug-export.js',import.meta.url),'utf8').replaceAll('export ','');
 let blob,clicks=0,removed=0,revoked=false,timer;
 const anchor={click(){clicks++;assert.equal(revoked,false);},remove(){removed++;}};
 const url={createObjectURL(value){blob=value;return 'blob:diagnostic';},revokeObjectURL(value){assert.equal(value,'blob:diagnostic');revoked=true;}};
 const doc={createElement(tag){assert.equal(tag,'a');return anchor;},documentElement:{append(value){assert.equal(value,anchor);}}};
 const download=Function('Blob','URL','document','setTimeout',source+'\nreturn downloadDebugText;')(Blob,url,doc,(fn,delay)=>{timer={fn,delay};});
 download(longText,'verba-debug.txt');
 assert.equal(await blob.text(),longText);assert.equal(blob.type,'text/plain;charset=utf-8');
 assert.equal(anchor.download,'verba-debug.txt');assert.equal(clicks,1);assert.equal(removed,1);assert.equal(revoked,false);
 assert.equal(timer.delay,60000);timer.fn();assert.equal(revoked,true);
});
