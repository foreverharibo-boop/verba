import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    parseGoogleFreeResponse,
    splitGoogleFreeText,
    translateGoogleFreeSegments,
    translateGoogleFreeText,
} from '../google-free.js';

assert.equal(parseGoogleFreeResponse([[['안녕', 'Hello', null, null]]]), '안녕');
assert.equal(parseGoogleFreeResponse({ sentences: [{ trans: '안녕' }, { trans: '하세요' }] }), '안녕하세요');

const token = '@@VERBA_DEEP_NAME_0001@@';
const source = `  Hello ${token}\n\n${'Long text. '.repeat(800)}`;
const split = splitGoogleFreeText(source, 900);
assert.ok(split.length > 4, 'long text should be divided into multiple safe chunks');
assert.equal(split.map(piece => piece.text).join(''), source);
assert.ok(split.some(piece => piece.text === token && piece.translate === false));
assert.ok(split.some(piece => piece.text === '\n\n' && piece.translate === false));

const requested = [];
const fetchImpl = async url => {
    const parsed = new URL(url);
    const text = parsed.searchParams.get('q');
    requested.push(text);
    return {
        ok: true,
        status: 200,
        json: async () => [[[`[${text}]`, text, null, null]]],
    };
};

const translated = await translateGoogleFreeText(`Hello ${token} world`, {
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    fetchImpl,
    maxEncodedChars: 900,
});
assert.equal(translated, `[Hello ]${token} [world]`);
assert.equal(requested.length, 2, 'protected tokens must never be sent to Google');

const rows = await translateGoogleFreeSegments([
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
], { fetchImpl, concurrency: 2 });
assert.equal(rows.get('a'), '[Alpha]');
assert.equal(rows.get('b'), '[Beta]');

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.match(index, /translationEngine:\s*'ai'/);
assert.match(index, /settings\.translationEngine === 'google-free'/);
assert.match(index, /googleFreeEngineEnabled\(\)[\s\S]*translateGoogleFreeSegments/);
assert.match(index, /id="verba-deep-translation-engine"/);
assert.match(index, /긴 글은 자동 분할됩니다/);
assert.match(index, /requireAiEngineForFeature\('선택 재번역'\)/);
assert.match(index, /ensureBilingualDialogueFormat/);

console.log('PASS: 긴르바 무료 Google 엔진 선택, 안전 분할, 보호 토큰, 로컬 한영병기 경로, AI 전용 기능 차단.');
