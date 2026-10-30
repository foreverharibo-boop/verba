import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSource, assembleTranslation } from '../core.js';
import { bilingualReviewTargets } from '../bilingual-review.js';

const fixtures = [
    '<div class="info"><div>Weather: Clear</div><div>Location: Home</div></div>',
    'Before <b>very nice</b> after.',
    '<div data-title="x > y">Hello<br/>World<img src="a.png"></div>',
    '<Info_panel><small>Stay quiet.</small><custom-tag>Wait here.</custom-tag></Info_panel>',
    '<style>.card{color:red}</style>\r\n<div class="card">Hello<!-- unchanged -->there</div>',
    '```html\n<div><div>Hello</div><div>World</div></div>\n```',
    '<div>Already 한국어 <span>Hello</span></div>',
    '<div>Unclosed source <br> text',
];
const markup = text => text.match(/<!--[\s\S]*?-->|<\/?[\p{L}_][\p{L}\p{N}_.:-]*(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gu) || [];
for (const source of fixtures) {
    test(`markup stays outside editable targets: ${source.slice(0, 55)}`, () => {
        const s = segmentSource(source);
        const tokens = s.tokens.filter(t => t.value.startsWith('<')).map(t => t.token);
        assert.ok(s.segments.length > 0);
        for (const row of s.segments) for (const token of tokens) assert.ok(!row.text.includes(token));
        const values = new Map(s.segments.map(row => [row.id, '번역문']));
        const result = assembleTranslation(s, values, { allowDamagedProtected: true });
        assert.deepEqual(markup(result), markup(source));
        assert.equal((result.match(/\r\n|\r|\n/g) || []).join(''), (source.match(/\r\n|\r|\n/g) || []).join(''));
        assert.ok(result.includes('번역문'));
    });
}
test('disabled tagged translation preserves full contents and outside translation', () => {
    const source = 'Before <div><b>Hello</b> World</div> after.';
    const s = segmentSource(source, [], { translateTaggedContent: false });
    assert.equal(assembleTranslation(s, new Map(s.segments.map(r => [r.id, '번역문']))), '번역문 <div><b>Hello</b> World</div> 번역문');
});
test('legacy missing, duplicated or reordered nested tokens fall back locally', () => {
    const text = '@@VERBA_0000@@Hello@@VERBA_0001@@';
    const part = { id: 'seg_0000', type: 'tagged_content', text };
    const other = { id: 'seg_0001', type: 'narration', text: 'Outside.' };
    const s = { parts: [part,other], segments: [part,other], nameTokens: [], tokens: [
        { token: '@@VERBA_0000@@', value: '<div>' }, { token: '@@VERBA_0001@@', value: '</div>' },
    ] };
    for (const damaged of ['번역문', '@@VERBA_0000@@번역문', '@@VERBA_0001@@번역문@@VERBA_0000@@', '@@VERBA_0000@@번역문@@VERBA_0001@@@@VERBA_0001@@']) {
        const map = new Map([[part.id, damaged], [other.id, '바깥.']]);
        assert.equal(assembleTranslation(s, map, { allowDamagedProtected: true }), '<div>Hello</div>바깥.');
        assert.equal(map.get(part.id), text);
    }
    assert.equal(assembleTranslation(s, new Map([[part.id, text.replace('Hello','안녕')],[other.id,'바깥.']])), '<div>안녕</div>바깥.');
});
test('invented raw markup or structural references cannot alter surrounding HTML', () => {
    const s = segmentSource('<div>Hello</div> Outside.');
    for (const attack of ['안녕</div>', '<span>안녕</span>', '안녕@@VERBA_0001@@']) {
        const map = new Map(s.segments.map(r => [r.id,r.type === 'tagged_content' ? attack : '바깥.']));
        assert.equal(assembleTranslation(s, map, { allowDamagedProtected: true }), '<div>Hello</div> 바깥.');
    }
});
test('reviewer skips a marked span containing unexpected HTML from first response', () => {
    const s = segmentSource('*Stay quiet.*');
    const m = new Map([[s.segments[0].id, '*조용히</div>*']]);
    assert.equal(bilingualReviewTargets(s,m,{globalPrompt:'Inside italics, preserve the original English and add Korean in brackets.'}).targets.length,0);
});
