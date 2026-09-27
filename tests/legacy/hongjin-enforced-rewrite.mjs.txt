import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = index.indexOf('function compactComparableText(');
const end = index.indexOf('async function runHongjinVoiceRewrite(', start);
assert.ok(start >= 0 && end > start);
const helpers = Function('settings', `${index.slice(start, end)}\nreturn {compactComparableText, hongjinVoiceRewriteFailure};`)({
    developerHongjinProfanity: 'natural',
    developerHongjinTranscreation: 'strong',
});
const highHelpers = Function('settings', `${index.slice(start, end)}\nreturn {hongjinVoiceRewriteFailure, hongjinSceneVoiceFailure};`)({
    developerHongjinProfanity: 'high',
    developerHongjinTranscreation: 'maximum',
});

const time = { id: 'time', type: 'dialogue_candidate', text: '"Time."' };
const five = { id: 'five', type: 'dialogue_candidate', text: '"Five more minutes."' };

assert.equal(helpers.hongjinVoiceRewriteFailure(time, '"시간이다."', '"시간."'), 'literal-time-fragment');
assert.equal(helpers.hongjinVoiceRewriteFailure(five, '"5분만 더."', '"5분만 더."'), 'unchanged-first-pass');
assert.equal(helpers.hongjinVoiceRewriteFailure(time, '"자, 쉬었으면 슬슬 일어나셔야지."', '"시간이다."'), '');
assert.equal(helpers.hongjinVoiceRewriteFailure(five, '"딱 5분만 더 봐준다. 그 뒤엔 바로 움직여."', '"5분만 더."'), '');
assert.equal(highHelpers.hongjinVoiceRewriteFailure(time, '"됐다, 이제 일어나."', '"시간이다."'), '');
assert.equal(highHelpers.hongjinVoiceRewriteFailure(time, '"자, 존나 오래 쉬셨네. 이제 일어나시지."', '"시간이다."'), '');

const sceneRows = [time, five, { id: 'look', text: '"Look at me."' }, { id: 'drink', text: '"Drink."' }, { id: 'move', text: '"Move."' }];
assert.equal(highHelpers.hongjinSceneVoiceFailure(sceneRows, new Map([
    ['time', '"무슨 개소리인지 모르겠네."'],
    ['five', '"뭐라도 좀 처먹어."'],
    ['look', '"나 봐."'],
    ['drink', '"천천히 마셔."'],
    ['move', '"이제 간다."'],
])), 'scene-explicit-profanity-density-1-of-2');
assert.equal(highHelpers.hongjinSceneVoiceFailure(sceneRows, new Map([
    ['time', '"무슨 개소리인지 모르겠네."'],
    ['five', '"존나 오래 쉬었네. 이제 가자."'],
    ['look', '"나 봐."'],
    ['drink', '"천천히 마셔."'],
    ['move', '"이제 간다."'],
])), '');

assert.doesNotMatch(index, /throw new Error\(`김홍진 보이스 강제 재작성 실패:/u);

assert.doesNotMatch(index, /needsHongjinAttribution/);
assert.match(index, /localFlavorIdentityNameLocks/);
assert.match(index, /const needsSpeakerIsolation = Boolean\(\s*!madKoreanExclusiveMode\(\)/s);
assert.match(index, /hongjin-voice-scene-retry/);
assert.match(index, /function hongjinSceneVoiceFailure\(/);
assert.doesNotMatch(index, /hongjin-voice-enforced-retry-/);
assert.match(index, /직역본을 최종 결과로 채택하지 않습니다/);

const translateStart = index.indexOf('async function translateOutputText(');
const translateEnd = index.indexOf('function inputIdentitySpellingContext(', translateStart);
const body = index.slice(translateStart, translateEnd);
assert.doesNotMatch(body, /await runHongjinVoiceRewrite\(/);
assert.match(body, /noModelFollowups: singlePassFlavorMode\(\) \? true/);

console.log('PASS: flavor modes use local identity/speaker routing and primary-request voice authoring without a source-less follow-up rewrite.');
