import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSourceChange, compatibleCompletedSource, reconcileCompletedResult, hasVerifiedSceneReport } from '../../server-result-compat.js';

test('unknown extension blocks are removed structurally while visible info markup remains',()=>{
 const removed='<vendor_private>{"mood":"tense"}</vendor_private>';
 const source='Narrative.\n\n'+removed+'\n\n<Info_panel>Keep</Info_panel>';
 const final='Narrative.\n\n\n\n<Info_panel>Keep</Info_panel>';
 assert.equal(hasVerifiedSceneReport(source),false,'no producer-specific wait remains');
 assert.equal(compatibleCompletedSource(source,final),true);
 assert.equal(describeSourceChange(source,final).relation,'closed-markup-blocks-removed');
 const translated='번역.\n\n<vendor_private>{"mood":"긴장"}</vendor_private>\n\n<Info_panel>유지</Info_panel>';
 const result=reconcileCompletedResult(source,final,{translation:translated,sourceMap:[]});
 assert.equal(result.translation,'번역.\n\n\n\n<Info_panel>유지</Info_panel>');
});

test('nested and multiple complete blocks can be removed without retranslating kept text',()=>{
 const nested=reconcileCompletedResult(
  '<wrapper>A<hidden_state>X</hidden_state>B</wrapper>',
  '<wrapper>AB</wrapper>',
  {translation:'<wrapper>가<hidden_state>엑스</hidden_state>나</wrapper>',sourceMap:[]},
 );
 assert.equal(nested.translation,'<wrapper>가나</wrapper>');
 const multiple=reconcileCompletedResult(
  'A<x-one>1</x-one>B<x-two>2</x-two>C',
  'ABC',
  {translation:'가<x-one>일</x-one>나<x-two>이</x-two>다',sourceMap:[]},
 );
 assert.equal(multiple.translation,'가나다');
});

test('source-map rows inside removed blocks are dropped and later positions shift',()=>{
 const source='A<hidden>X</hidden>B';
 const translation='가<hidden>숨김</hidden>나';
 const hiddenStart=translation.indexOf('<hidden>');
 const hiddenEnd=translation.indexOf('</hidden>')+'</hidden>'.length;
 const result=reconcileCompletedResult(source,'AB',{translation,sourceMap:[
  {id:'a',start:0,end:1},
  {id:'hidden',start:hiddenStart,end:hiddenEnd},
  {id:'b',start:hiddenEnd,end:translation.length},
 ]});
 assert.equal(result.translation,'가나');
 assert.deepEqual(result.sourceMap,[{id:'a',start:0,end:1},{id:'b',start:1,end:2}]);
});

test('partial markup, translated structure damage and real prose edits are never guessed',()=>{
 const incomplete='Narrative <hidden_state>{"scene":{}}';
 assert.equal(compatibleCompletedSource(incomplete,'Narrative'),false);
 const source='Narrative.<hidden_state>secret</hidden_state><Info_panel>Keep</Info_panel>';
 const final='Narrative.<Info_panel>Keep</Info_panel>';
 assert.equal(reconcileCompletedResult(source,final,{translation:'번역.<Info_panel>유지</Info_panel>',sourceMap:[]}),null);
 assert.equal(compatibleCompletedSource(source,'Changed.<Info_panel>Keep</Info_panel>'),false);
 assert.equal(compatibleCompletedSource('Hello unchanged tail','Hello'),false);
});
