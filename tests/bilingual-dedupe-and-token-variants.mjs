import assert from 'node:assert/strict';
import { ensureBilingualDialogueFormat, protectSource, assembleTranslation, restoreProtected } from '../core.js';
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
assert.equal(canonicalizeProtectedTokenVariants('@@VERBA_NAME_ 0023@@이'), '@@VERBA_NAME_0023@@이');
assert.equal(canonicalizeProtectedTokenVariants('@@ verba_name_0001 @@'), '@@VERBA_NAME_0001@@');
assert.equal(canonicalizeProtectedTokenVariants('@@VERBA_ 0002@@'), '@@VERBA_0002@@');
const parsed = collectSegmentResponse(JSON.stringify({ segments: [{ id: 'seg_0000', translation: '@@VERBA_NAME_ 0000@@이 일어났다' }] }), [{ id: 'seg_0000' }]);
assert.equal(parsed.partial.get('seg_0000'), '@@VERBA_NAME_0000@@이 일어났다');

const segmented = protectSource('Nyon stood up.', [{ source: 'Nyon', target: '니욘' }]);
const restored = restoreProtected('@@VERBA_NAME_ 0000@@이 일어났다.', segmented.nameTokens, { strict: false });
assert.equal(restored, '니욘이 일어났다.');

console.log('bilingual-dedupe-and-token-variants ok');

// 이름만 든 대사("Dana,")도 한영병기가 적용되어야 한다.
// 0.5.89 에서는 이런 대사가 passthrough 가 아니라 dialogue_candidate 구간으로 남는다.
{
    const locks = [{ source: 'Dana', target: '다나' }, { source: 'Nyon', target: '니욘' }];
    const cfg = { globalPromptEnabled: true, globalPrompt: '대사는 영어 원문 (한국어 번역) 형식으로 병기' };
    const { segmentSource } = await import('../core.js');

    const seg = segmentSource('"Dana," he said.', locks);
    const first = seg.segments[0];
    for (const returned of [`"${seg.nameTokens[0].token},"`, '"다나,"']) {
        const built = ensureBilingualDialogueFormat(first, returned, cfg, null, seg.nameTokens, seg.tokens);
        assert.equal(
            assembleTranslation(seg, new Map([[first.id, built], ['seg_0001', '그가 말했다.']]), { settings: cfg }),
            '"Dana, (다나,)" 그가 말했다.',
        );
    }
    // 병기 설정이 없으면 원래대로 한국어만 남는다.
    assert.equal(
        assembleTranslation(seg, new Map([[first.id, '"다나,"'], ['seg_0001', '그가 말했다.']])),
        '"다나," 그가 말했다.',
    );

    const two = segmentSource('"Nyon, Dana!" he called.', locks);
    const nyon = two.nameTokens.find(entry => entry.source === 'Nyon').token;
    const dana = two.nameTokens.find(entry => entry.source === 'Dana').token;
    const builtTwo = ensureBilingualDialogueFormat(two.segments[0], `"${nyon}, ${dana}!"`, cfg, null, two.nameTokens, two.tokens);
    assert.equal(
        assembleTranslation(two, new Map([[two.segments[0].id, builtTwo], ['seg_0001', '그가 불렀다.']]), { settings: cfg }),
        '"Nyon, Dana! (니욘, 다나!)" 그가 불렀다.',
    );
    console.log('name-only dialogue bilingual ok');
}
