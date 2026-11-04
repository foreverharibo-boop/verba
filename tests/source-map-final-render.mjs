import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../core.js';
import { escapeCodeTranslation } from '../code-content.js';
const code=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const from=code.indexOf('function restoredSegmentText('),to=code.indexOf('const CONSISTENCY_ROLE_TERMS',from);
const build=Function('restoreProtected','restoreTranslationSurface','escapeCodeTranslation',code.slice(from,to)+'\nreturn buildSourceMap;')(core.restoreProtected,core.restoreTranslationSurface,escapeCodeTranslation);
const locks=[{source:'Vincent',target:'빈센트'}];

test('first translation retains original mapping after final name-particle correction',()=>{
 for(const target of ['빈센트','홍진'])for(const particle of ['은','는','이','가','을','를','으로','로','이랑','랑','은(는)','(은/는)','(이)는']){
  const source='Vincent lowered his head.';
  const segmented=core.segmentSource(source,[{source:'Vincent',target}]);
  const token=segmented.nameTokens[0].token;
  const translations=new Map([[segmented.segments[0].id,token+particle+' 고개를 숙였다.']]);
  const final=core.assembleTranslation(segmented,translations);
  const rows=build(segmented,translations,final);
  assert.equal(rows.length,1,`${target} / ${particle} / ${final}`);
  assert.equal(rows[0].source,source);assert.equal(rows[0].start,0);assert.equal(rows[0].end,final.length);
  assert.equal(final.slice(rows[0].start,rows[0].end),final);
 }
});

test('different source paragraphs with identical final Korean map to their own offsets',()=>{
 const segmented=core.segmentSource('Vincent waited.\n\nVincent stayed.',locks);
 const translations=new Map(segmented.segments.map(s=>[s.id,s.text.match(/@@VERBA_(?:DEEP_)?NAME_\d+@@/)[0]+'은 기다렸다.']));
 const final=core.assembleTranslation(segmented,translations),rows=build(segmented,translations,final);
 assert.equal(rows.length,2);assert.equal(rows[0].source,'Vincent waited.');assert.equal(rows[1].source,'Vincent stayed.');
 assert.ok(rows[1].start>=rows[0].end);
 for(const row of rows)assert.equal(final.slice(row.start,row.end),'빈센트는 기다렸다.');
 // Never attach a missing second occurrence to the first source paragraph.
 const partial=build(segmented,translations,'빈센트는 기다렸다.');assert.equal(partial.length,1);
});

test('canonicalized name token and markup restoration use the same surface for mapping',()=>{
 const segmented=core.segmentSource('Vincent waited with **care**.\n\n"Hello, Vincent."',locks);
 const translations=new Map(segmented.segments.map(s=>[s.id,s.text]));
 const named=segmented.segments.find(s=>s.text.includes(segmented.nameTokens[0].token));
 translations.set(named.id,named.text.replace(segmented.nameTokens[0].token,segmented.nameTokens[0].token+'은'));
 const final=core.assembleTranslation(segmented,translations),rows=build(segmented,translations,final);
 assert.equal(rows.length,segmented.segments.length);
 for(const row of rows){assert.ok(row.source.trim());assert.ok(final.slice(row.start,row.end).trim());assert.doesNotMatch(row.source,/@@VERBA/);}
});

test('full assembly still rejects damaged protected structure',()=>{
 const segmented={nameTokens:[],tokens:[{token:'@@VERBA_0000@@',value:'<b>'}],parts:[{id:'s',text:'Hello.',type:'narration'}]};
 for(const allowDamagedProtected of [false,true]){
  assert.throws(()=>core.assembleTranslation(segmented,new Map([['s','안녕.']]),{allowDamagedProtected}),/보호 요소/);
 }
});

test('source viewer distinguishes absent metadata from an unmapped selection without blaming version',()=>{
 const start=code.indexOf('function showSelectionSource('),end=code.indexOf('\nfunction ',start+1);
 const notices=[];
 const show=Function('settings','normalizedSourceMap','notify','hideSelectionButton',code.slice(start,end)+'\nreturn showSelectionSource;')({debugMode:false},rows=>rows||[],text=>notices.push(text),()=>{});
 show({sourceMap:[],start:0,end:2});
 show({sourceMap:[{start:10,end:20,source:'Original'}],start:0,end:2});
 assert.match(notices[0],/저장되어 있지/);assert.match(notices[1],/선택한 구간/);
 for(const notice of notices)assert.doesNotMatch(notice,/v0\.2\.0|이후 새로/);
});
