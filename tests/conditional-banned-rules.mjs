import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBannedRules, parseBannedWords, findBannedWords, bannedWordsPrompt, bannedWordRejectionDiagnostic, segmentSource } from '../core.js';
import { planPostReview, reviewOutputOnce } from '../post-review.js';
import { createOutputComparison, sanitizeOutputComparison } from '../output-comparison.js';
const settings = { bannedWords:'bro=형, 형씨\n굳은살\n육봉', debugMode:true, aiPostReview:{banned:true} };
const data = (source, drafts) => {
    const segmented = segmentSource(source);
    assert.equal(segmented.segments.length, drafts.length);
    return { segmented, translations:new Map(segmented.segments.map((s,i)=>[s.id,drafts[i]])) };
};
test('mapping targets share their line and whitespace is irrelevant; legacy comma lists survive', () => {
    const expected=[{source:'bro',target:'형'},{source:'bro',target:'형씨'},{source:null,target:'굳은살'},{source:null,target:'육봉'}];
    for (const input of ['bro=형,형씨\n굳은살\n육봉',' bro = 형 , 형씨 \r\n굳은살, 육봉']) assert.deepEqual(parseBannedRules(input), expected);
    assert.deepEqual(parseBannedWords(settings.bannedWords),['굳은살','육봉']);
    assert.deepEqual(parseBannedRules('bro=형, dude=오빠, 오라버니'),[{source:'bro',target:'형'},{source:'dude',target:'오빠'},{source:'dude',target:'오라버니'}]);
    assert.deepEqual(parseBannedRules('bro=,형씨\n=형,형씨\na=b=c,형\n굳은살'),[{source:null,target:'굳은살'}]);
    assert.deepEqual(parseBannedRules('bro=형,형\nbro=형'),[{source:'bro',target:'형'}]);
});
test('source words gate mappings, excluding brother/broken and normal Korean compound words', () => {
    for (const source of ['Bro!','BRO, come here.','Listen, bro.']) {
        for (const target of ['형','형씨','형이 왔다.','형에게는','형이라고','형씨랑','형씨와','형이다','형이잖아요']) assert.ok(findBannedWords(target,settings,source).length, target);
        for (const target of ['형광 U자형 형편없다.','성형외과 모형','형식 형상']) assert.deepEqual(findBannedWords(target,settings,source),[]);
    }
    for (const source of ['', 'His brother waited.', 'The broken lamp.', 'A fluorescent jacket.']) assert.deepEqual(findBannedWords('형씨와 형',settings,source),[]);
    assert.deepEqual(findBannedWords('굳은살과 육봉',settings,''),['굳은살','육봉']);
    assert.deepEqual(findBannedWords('형광',{bannedWords:'형'},''),['형']); // existing global semantics
    assert.deepEqual(findBannedWords('금지',{bannedWords:'a.b=금지'},'axb'),[]);
    assert.deepEqual(findBannedWords('금지',{bannedWords:'a.b=금지'},'a.b'),['금지']);
    assert.deepEqual(findBannedWords('금지',{bannedWords:'my friend=금지'},'My friend!'),['금지']);
});
test('prompts distinguish forbidden mappings from unconditional bans', () => {
    const prompt=bannedWordsPrompt(settings);
    assert.match(prompt,/Unconditional[^\n]+\["굳은살","육봉"\]/);
    assert.match(prompt,/"source":"bro","target":"형씨"/);
    assert.match(prompt,/NOT glossary replacements/);
    assert.match(prompt,/corresponding source unit/);
});
test('post-review fixes scoped general bans without rejecting a neighboring unconditioned use', async () => {
    const fixture=data('Bro, wait.\n\nHis brother waited.', ['형, 기다려.','형은 기다렸다.']);
    const stats=await reviewOutputOnce({...fixture,settings,request:async(_p,units)=>new Map(units.map(u=>[u.id,u.SOURCE.startsWith('Bro')?'친구, 기다려.':u.CURRENT]))});
    assert.equal(stats.changed,1); assert.equal(stats.rejected,0);
    assert.deepEqual([...fixture.translations.values()],['친구, 기다려.','형은 기다렸다.']);
});
test('unchanged violations are reported and retained, never silently marked completed', async () => {
    const fixture=data('Bro, wait.', ['형, 기다려.']);
    const stats=await reviewOutputOnce({...fixture,settings,request:async(_p,units)=>new Map(units.map(u=>[u.id,u.CURRENT]))});
    assert.equal(stats.rejected,1); assert.equal(stats.changed,0);
    assert.equal(stats.failures[0].bannedMatches[0].sourceTerm,'bro');
    assert.equal(stats.failures[0].bannedMatches[0].presentBefore,true);
    assert.equal([...fixture.translations.values()][0],'형, 기다려.');
    const comparison=createOutputComparison(fixture.segmented,true); comparison.postReview(stats);
    const safe=sanitizeOutputComparison(comparison.finish(''),{summaryOnly:true}).postReview;
    assert.deepEqual(safe.failures[0].bannedMatches,[{term:'형',sourceTerm:'bro',rule:'configured-conditional',matchMode:'source-conditioned-word',presentBefore:true}]);
});
test('bilingual Korean is checked and corrected while source remains locked', async () => {
    const cfg={...settings,allDialoguePrompt:'Keep the original English dialogue and add Korean in parentheses.'};
    for (const replacement of ['"Bro, wait. (형씨, 기다려.)"','"Bro, wait. (친구, 기다려.)"']) {
        const fixture=data('"Bro, wait."',['"Bro, wait. (형, 기다려.)"']);
        const stats=await reviewOutputOnce({...fixture,settings:cfg,request:async(_p,units)=> {
            assert.equal(units.length,1); assert.equal(units[0].type,'bilingual'); assert.deepEqual(units[0].BANNED,['형']);
            return new Map([[units[0].id,replacement]]);
        }});
        assert.equal(stats.rejected,replacement.includes('형씨')?1:0);
        assert.equal(stats.changed,replacement.includes('형씨')?0:1);
        assert.match([...fixture.translations.values()][0],/Bro, wait\./);
    }
    // An unconditional English ban may not remove the required source half.
    const fixture=data('"Bro, wait."',['"Bro, wait. (친구, 기다려.)"']);
    const stats=await reviewOutputOnce({...fixture,settings:{...cfg,bannedWords:'Bro'},request:async(_p,units)=>new Map(units.map(u=>[u.id,u.CURRENT]))});
    assert.equal(stats.rejected,0);
});
test('locked source spans cannot activate mappings in surrounding prose', () => {
    const fixture=data('His brother said *Bro, wait.*',['형은 말했다. *Bro, wait. (친구, 기다려.)*']);
    const cfg={...settings,globalPrompt:'Inside italics, preserve original English and add Korean in parentheses.'};
    const plan=planPostReview(fixture.segmented,fixture.translations,cfg);
    assert.equal(plan.units.length,2);
    assert.deepEqual(plan.units.find(u=>u.type==='general').BANNED,[]);
    assert.doesNotMatch(plan.units.find(u=>u.type==='general').BANNED_SOURCE,/Bro/);
});
test('conditional diagnostics expose bounded rule terms only', () => {
    const diagnostic=bannedWordRejectionDiagnostic('친구','형씨',settings,'Bro!');
    assert.deepEqual(diagnostic.bannedMatches,[{term:'형씨',rule:'configured-conditional',matchMode:'source-conditioned-word',presentBefore:false,sourceTerm:'bro'}]);
    assert.deepEqual(bannedWordRejectionDiagnostic('형','형',settings,'His brother.'),{bannedMatches:[],bannedMatchesOmitted:0});
});
