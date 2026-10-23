import assert from 'node:assert/strict';
import { segmentSource, ensureBilingualDialogueFormat, assembleTranslation, normalizeBilingualMappedTranslation } from '../core.js';

const off = { globalPrompt: '한영병기 요청 안 함.' };
const on = { globalPrompt: '한영병기로 출력해.' };
const source = '"Ask Amelia to lunch."';
const segmented = segmentSource(source, [{ source: 'Amelia', target: '아멜리아' }]);
const segment = segmented.segments.find(row => row.type === 'dialogue_candidate');
assert.ok(segment);
const nameToken = segmented.nameTokens[0].token;
const unknownToken = nameToken.replace('NAME_', '');
const knownOutput = '"Ask ' + nameToken + ' to lunch. [' + nameToken + '를 초대해.]"';
const knownRestored = ensureBilingualDialogueFormat(segment, knownOutput, off, null, segmented.nameTokens, segmented.tokens);
assert.equal(knownRestored, '"Ask Amelia to lunch. [' + nameToken + '를 초대해.]"');
assert.equal(assembleTranslation(segmented, new Map([[segment.id, knownRestored]])), '"Ask Amelia to lunch. [아멜리아를 초대해.]"');

const leaked = '"Ask ' + unknownToken + ' to lunch. [아멜리아를 초대해.]"';
const mapped = [{ id: 'seg_0000', source, start: 0, end: leaked.length }];
const safe = normalizeBilingualMappedTranslation(leaked, mapped, off, source);
assert.equal(safe.translation, '"Ask Amelia to lunch. [아멜리아를 초대해.]"');
assert.deepEqual(normalizeBilingualMappedTranslation(safe.translation, safe.sourceMap, off, source), safe);

const notMatching = '"Invite ' + unknownToken + ' to dinner. [저녁에 초대해.]"';
assert.equal(normalizeBilingualMappedTranslation(notMatching,
    [{ source, start: 0, end: notMatching.length }], off, source).translation, notMatching);
const koreanMarker = '"Ask Amelia to lunch. [' + unknownToken + '를 초대해.]"';
assert.equal(normalizeBilingualMappedTranslation(koreanMarker,
    [{ source, start: 0, end: koreanMarker.length }], off, source).translation, koreanMarker);
const pureKorean = '"아멜리아에게 점심 먹자고 해."';
assert.equal(ensureBilingualDialogueFormat(segment, pureKorean, off, null, segmented.nameTokens, segmented.tokens), pureKorean);
const formatted = ensureBilingualDialogueFormat(segment, pureKorean, on, null, segmented.nameTokens, segmented.tokens);
assert.equal(assembleTranslation(segmented, new Map([[segment.id, formatted]])), '"Ask Amelia to lunch. (아멜리아에게 점심 먹자고 해.)"');
console.log('PASS: matched name tokens recover without weakening bilingual-OFF guard');
