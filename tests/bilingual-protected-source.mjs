import assert from 'node:assert/strict';
import { normalizeBilingualMappedTranslation } from '../core.js';

const settings = {
    allDialoguePromptEnabled: true,
    allDialoguePrompt: 'For direct dialogue only, always output both the original English dialogue and its Korean translation in this exact format: "English dialogue. [한국어 번역.]"',
};

// Amelia is a synthetic English name, not a literal {{user}} macro.
const lines = [
    ["Today you're asking Amelia to lunch.", '오늘 너 아멜리아한테 점심 같이 먹자고 하는 거다.'],
    ["Fine. It's yours. Ask Amelia to lunch, and I will never speak of the dinner roll again.", '좋아. 네 거야. 아멜리아한테 점심 먹자고 해.'],
    ["Hi, I'm Amelia. I'm sitting all alone and I'm so lonely.", '안녕, 나 아멜리아야. 혼자라 외로워.'],
    ['Hi, Amelia. Mind if I sit?', '안녕, 아멜리아. 앉아도 될까?'],
];
for (const config of [{}, settings]) {
    let translation = '';
    const sourceMap = [];
    const expected = [];
    for (const [english, korean] of lines) {
        if (translation) translation += '\n\n';
        const source = `"${english}"`;
        const leaked = `"${english.replace('Amelia', '@@VERBA_0000@@')} [${korean}]"`;
        sourceMap.push({ id: `seg_${sourceMap.length}`, source, start: translation.length, end: translation.length + leaked.length });
        translation += leaked;
        expected.push(`"${english} [${korean}]"`);
    }
    const normalized = normalizeBilingualMappedTranslation(translation, sourceMap, config);
    assert.equal(normalized.translation, expected.join('\n\n'));
    normalized.sourceMap.forEach((row, i) => assert.equal(normalized.translation.slice(row.start, row.end), expected[i]));
    assert.deepEqual(normalizeBilingualMappedTranslation(normalized.translation, normalized.sourceMap, config), normalized);
}

// The final display pass must restore protection it creates itself, including
// inline code/URLs/HTML; this is independent of the report's redacted name.
for (const part of ['`Amelia`', 'https://example.com/Amelia', '<b>Amelia</b>', '{{user}}']) {
    const source = `"Ask ${part} to lunch."`;
    const translated = `"Ask ${part} to lunch. [점심에 초대해.]"`;
    const row = { source, start: 0, end: translated.length };
    const result = normalizeBilingualMappedTranslation(translated, [row], settings, source);
    assert.equal(result.translation, translated);
    assert.equal(normalizeBilingualMappedTranslation(translated, [], settings, source).translation, translated);
}

// No guessing when the English text differs, or when no original name exists.
for (const [source, translated] of [
    ['"Ask Amelia to lunch."', '"Invite @@VERBA_0000@@ to dinner. [저녁에 초대해.]"'],
    ['"Amelia"', '"@@VERBA_0000@@ [아멜리아]"'],
    ['"Ask Amelia to lunch."', '"Ask Amelia to lunch. [@@VERBA_0000@@를 초대해.]"'],
]) {
    assert.equal(normalizeBilingualMappedTranslation(translated, [{ source, start: 0, end: translated.length }], {}).translation, translated);
}
console.log('PASS: bilingual English token recovery preserves source, Korean text, offsets, and protected content.');
