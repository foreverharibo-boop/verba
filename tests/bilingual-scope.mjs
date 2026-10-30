import test from 'node:test';
import assert from 'node:assert/strict';
import { promptRequestsScope, bilingualScopeRequested, maskRequestedBilingualSource, hasExplicitNonDialogueBilingualScope } from '../output-format.js';
import { classifyBilingualIntent, bilingualPromptsNeedingVerdict } from '../bilingual-intent.js';
import { segmentSource, buildOutputPrompt, buildInputPrompt, ensureBilingualDialogueFormat } from '../core.js';
import { englishReviewTargets } from '../english-review.js';

const kinds = ['italic','bold','code','fenced','bracket','dialogue','narration'];
// The actual reported prompt: the heading and later generic preservation rules
// must not widen the first sentence's three source scopes.
export const reportedPrompt = [
 'BILINGUAL OUTPUT FORMAT',
 '',
 'For source text enclosed in italics (*...*), backticks (`...`), or square brackets ([...]), preserve the original English exactly and include its Korean translation once inside the same original markers.',
 '',
 'Required formats:',
 '- Italics: *English text [한국어 번역]*',
 '- Backticks: `English text [한국어 번역]`',
 '- Square brackets: [English text 한국어 번역]',
 '',
 'For italics and backticks, place the Korean translation in square brackets immediately after the original English.',
 '',
 'For text already enclosed in square brackets, use the existing brackets. Separate the English and Korean with one space; do not add another pair of brackets.',
 '',
 'Never remove the original English or replace it with Korean inside these marked spans. Never repeat the Korean translation.',
 '',
 'Preserve the original enclosing markers and their formatting.',
 '',
 'Translate everything outside these marked spans into Korean only, without retaining the English.',
].join('\n');
function expectScopes(prompt, expected) {
 assert.deepEqual(kinds.filter(kind=>promptRequestsScope(prompt,kind)),expected.filter(kind=>kinds.includes(kind)).sort((a,b)=>kinds.indexOf(a)-kinds.indexOf(b)),prompt);
}
test('reported multiline prompt only authorizes its three marked scopes',()=>{
 expectScopes(reportedPrompt,['italic','code','bracket']);
 assert.equal(hasExplicitNonDialogueBilingualScope(reportedPrompt),true);
 assert.equal(hasExplicitNonDialogueBilingualScope('Use bilingual dialogue.'),false);
 const data=segmentSource('"Wait here."\n\n*Stay quiet.*\n\n`Door locked.`');
 const d=data.segments.find(x=>x.type==='dialogue_candidate');
 for(const settings of [
  {globalPrompt:reportedPrompt},
  {customTranslatorEnabled:true,customTranslatorModified:{output:true},customTranslatorTemplates:{output:reportedPrompt}},
 ]) {
  assert.equal(ensureBilingualDialogueFormat(d,'"여기서 기다려."',settings),'"여기서 기다려."');
  assert.doesNotMatch(buildOutputPrompt(data,settings),/BILINGUAL DIALOGUE IS REQUIRED/);
  assert.equal(buildInputPrompt('기다려.',settings),buildInputPrompt('기다려.',{}));
 }
});
test('headings alone cannot authorize local formatting or optional AI verdicts',()=>{
 for(const heading of ['BILINGUAL OUTPUT FORMAT','[BILINGUAL DIALOGUE FORMAT]','## Bilingual Output Format','**BILINGUAL OUTPUT FORMAT**','한영병기 형식']) {
  expectScopes(heading,[]);
  assert.equal(classifyBilingualIntent(heading),'off');
  assert.deepEqual(bilingualPromptsNeedingVerdict({globalPrompt:heading}),[]);
 }
});
test('generic follow-up sentences inherit marked scope and output brackets are not source brackets',()=>{
 expectScopes('Inside italics, preserve the original English and add Korean.\nKeep the English source alongside its Korean translation.', ['italic']);
 expectScopes('For italics, place the Korean translation in square brackets after the original English.', ['italic']);
 expectScopes('Only backticks should use bilingual output.', ['code']);
 expectScopes('이탤릭 안의 글만 한영병기해. 나머지는 한국어로만 번역해.', ['italic']);
 expectScopes('Translate italic spans bilingually.', ['italic']);
 expectScopes('이탤릭만 병기해.', ['italic']);
 expectScopes('서술만 한영병기해.', ['narration']);
 expectScopes('백틱 세 개 안의 글만 한영병기해.', ['fenced']);
});
test('explicit dialogue, all-text and Korean-first permissions remain supported',()=>{
 expectScopes('For dialogue only, always output both the original English dialogue and its Korean translation.', ['dialogue']);
 expectScopes('For all text, always output both English and Korean text.',kinds);
 expectScopes('Inside italics, output both English and Korean text. Put Korean first, followed by the exact English in brackets.', ['italic']);
 expectScopes('For all text, use bilingual output. For dialogue, translate into Korean only.', kinds.filter(x=>x!=='dialogue'));
 expectScopes('Output all text bilingually except dialogue.', kinds.filter(x=>x!=='dialogue'));
 expectScopes('모든 문장을 한영병기하되 대사는 한국어로만 번역해.', kinds.filter(x=>x!=='dialogue'));
 expectScopes('Do not use bilingual narration; bilingual dialogue is required.', ['dialogue']);
 expectScopes('Inside italics, use bilingual output; do not use bilingual output inside backticks.', ['italic']);
});
test('inline and fences remain distinct even with a bilingual heading',()=>{
 expectScopes('BILINGUAL OUTPUT FORMAT\nInside triple backticks, always output both English and Korean text.', ['fenced']);
 expectScopes(reportedPrompt+'\nInside fenced code blocks, always output both English and Korean text.', ['italic','code','bracket','fenced']);
});
test('disabled and unrelated prompt slots never grant permission',()=>{
 for(const settings of [{globalPrompt:reportedPrompt,globalPromptEnabled:false},
 {allDialoguePrompt:reportedPrompt}, {dialoguePrompt:reportedPrompt},
 {customTranslatorEnabled:true,customTranslatorTemplates:{input:reportedPrompt,selection:reportedPrompt}},
 {globalPrompt:reportedPrompt,developerMadKoreanOutputEnabled:true}]) {
  for(const kind of kinds) assert.equal(bilingualScopeRequested(settings,kind),false);
 }
});
test('scope mask protects marked originals without granting dialogue permission',()=>{
 const data=segmentSource('*Stay quiet.*\n\n"Wait here."');
 const translations=new Map(data.segments.map(x=>[x.id,x.type==='dialogue_candidate'?'"Wait here. [여기서 기다려.]"':'*Stay quiet. [조용히 있어.]*']));
 const targets=englishReviewTargets(data,translations,{}, {globalPrompt:reportedPrompt});
 const dialogue=data.segments.find(x=>x.type==='dialogue_candidate');
 assert.equal(maskRequestedBilingualSource(dialogue,translations.get(dialogue.id),{globalPrompt:reportedPrompt}),translations.get(dialogue.id));
 assert.ok(targets.every(x=>!x.text.includes('Stay quiet')));
});

test('nonrequests, prohibitions and conditional instructions cannot authorize a scope',()=>{
 for(const prompt of ['한영병기 요청 안 했어.', '한영병기를 요청하지 않았어.', '한영병기하지 마.',
  'Translate bilingually only when the user explicitly asks.', 'Do not output English and Korean together.',
  'Bilingual output is optional.', 'The character is bilingual.',
  'BILINGUAL OUTPUT FORMAT\nTranslate into Korean only.']) expectScopes(prompt,[]);
});
