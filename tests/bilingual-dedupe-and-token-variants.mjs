import assert from 'node:assert/strict';
import { ensureBilingualDialogueFormat, protectSource, segmentSource, assembleTranslation, restoreProtected } from '../core.js';
import { collectSegmentResponse, canonicalizeProtectedTokenVariants } from '../response-parser.js';

const settings = { globalPromptEnabled: true, globalPrompt: '대사는 영어 원문 (한국어 번역) 형식으로 병기' };
const dialogue = text => ({ id: 'seg_0000', type: 'dialogue_candidate', text });
const fmt = (src, tr) => ensureBilingualDialogueFormat(dialogue(src), tr, settings, null, [], []);

// 한영병기: 영어 1번 + 한국어 1번만
assert.equal(fmt('"Nest,"', '"Nest, (Nest, 둥지,)"'), '"Nest, (둥지,)"');
assert.equal(fmt('"Tell Nyon,"', '"Tell Nyon, (Tell Nyon. (니욘한테 말해줘.)"'), '"Tell Nyon, (니욘한테 말해줘.)"');
assert.equal(fmt('"Tell Nyon,"', '"Tell Nyon, (니욘한테 말해줘.) (니욘한테 말해줘.)"'), '"Tell Nyon, (니욘한테 말해줘.)"');
assert.equal(fmt('"Nest,"', '"Nest, (둥지, (둥지,))"'), '"Nest, (둥지,)"');
assert.equal(fmt('"Enough,"', '"Enough, (충분해,)"'), '"Enough, (충분해,)"');

// 이름 보호 토큰 변형 복구
assert.equal(canonicalizeProtectedTokenVariants('@@VERBA_DEEP_NAME_ 0023@@이'), '@@VERBA_DEEP_NAME_0023@@이');
assert.equal(canonicalizeProtectedTokenVariants('@@ verba_deep_name_0001 @@'), '@@VERBA_DEEP_NAME_0001@@');
assert.equal(canonicalizeProtectedTokenVariants('@@VERBA_DEEP_ 0002@@'), '@@VERBA_DEEP_0002@@');
assert.equal(canonicalizeProtectedTokenVariants('@@VERBA_NAME_0003@@'), '@@VERBA_DEEP_NAME_0003@@');
const parsed = collectSegmentResponse(JSON.stringify({ segments: [{ id: 'seg_0000', translation: '@@VERBA_DEEP_NAME_ 0000@@이 일어났다' }] }), [{ id: 'seg_0000' }]);
assert.equal(parsed.partial.get('seg_0000'), '@@VERBA_DEEP_NAME_0000@@이 일어났다');

const segmented = protectSource('Nyon stood up.', [{ source: 'Nyon', target: '니욘' }]);
assert.equal(restoreProtected('@@VERBA_DEEP_NAME_ 0000@@이 일어났다.', segmented.nameTokens, { strict: false }), '니욘이 일어났다.');

// 어시스턴트 응답에 변형 토큰이 섞여도 최종 출력에 토큰이 남지 않아야 한다
{
    const seg = segmentSource('Nyon stood up.', [{ source: 'Nyon', target: '니욘' }]);
    const out = assembleTranslation(seg, new Map([['seg_0000', '@@VERBA_DEEP_NAME_ 0000@@이 자리에서 일어났다. @@VERBA_DEEP_NAME_0099@@']]));
    assert.equal(out, '니욘이 자리에서 일어났다. ');
}

// 이름뿐인 대사("Dana,")는 이 확장에서 이미 세그먼트로 유지되어 한영병기 대상이다
{
    const locks = [{ source: 'Dana', target: '다나' }, { source: 'Nyon', target: '니욘' }];
    const seg = segmentSource('"Dana," he said.', locks);
    const dlg = seg.segments.find(x => x.type === 'dialogue_candidate');
    const tr = new Map(seg.segments.map(x => [x.id, x === dlg
        ? ensureBilingualDialogueFormat(x, '"다나,"', settings, null, seg.nameTokens, seg.tokens)
        : '그가 말했다.']));
    assert.equal(assembleTranslation(seg, tr), '"Dana, (다나,)" 그가 말했다.');
}
// 원문 표기 보존: 락은 Dana 로 등록돼 있어도 원문이 DANA! 면 병기의 영어 쪽도 DANA! 여야 한다
{
    const locks = [{ source: 'Dana', target: '다나' }];
    const seg = segmentSource('"DANA!" he shouted.', locks);
    const dlg = seg.segments.find(x => x.type === 'dialogue_candidate');
    const tr = new Map(seg.segments.map(x => [x.id, x === dlg
        ? ensureBilingualDialogueFormat(x, '"다나!"', settings, null, seg.nameTokens, seg.tokens)
        : '그가 외쳤다.']));
    assert.equal(assembleTranslation(seg, tr), '"DANA! (다나!)" 그가 외쳤다.');
    const lower = segmentSource('"dana,"', locks);
    const d2 = lower.segments[0];
    assert.equal(assembleTranslation(lower, new Map([[d2.id, ensureBilingualDialogueFormat(d2, '"다나,"', settings, null, lower.nameTokens, lower.tokens)]])), '"dana, (다나,)"');
}
console.log('bilingual-dedupe-and-token-variants ok');
