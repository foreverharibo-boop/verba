import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    findUntranslatedTaggedContentSegments,
    isPredominantlyKorean,
    segmentSource,
} from '../core.js';
import { translateMinimalOutput } from '../minimal-output.js';

const source = 'English narration.\n<Info_panel>Hello from inside the status panel.</Info_panel>';
const segmented = segmentSource(source, [], { translateTaggedContent: true });
const tag = segmented.segments.find(segment => segment.type === 'tagged_content');
assert.ok(tag, 'paired-tag visible text is segmented');

const firstPass = new Map(segmented.segments.map(segment => [
    segment.id,
    segment.type === 'tagged_content' ? segment.text : '영어 서술문.',
]));
assert.deepEqual(
    findUntranslatedTaggedContentSegments(segmented.segments, firstPass).map(segment => segment.id),
    [tag.id],
    'unchanged foreign tagged content is detected',
);
firstPass.set(tag.id, '상태 패널 안쪽의 인사.');
assert.equal(findUntranslatedTaggedContentSegments(segmented.segments, firstPass).length, 0);

// The established 45% Korean source gate is intentionally unchanged. The
// tag repair runs only after the primary translation path has actually run.
assert.equal(isPredominantlyKorean('한국어 본문입니다. <status>Hello from the panel.</status>'), true);

const settings = {
    developerMode: true,
    developerMinimalPromptEnabled: true,
    developerMinimalPrompt: '자연스럽게 한국어로 번역하라.',
    developerOutputSplitCount: 1,
    translationEngine: 'profile',
    customTranslatorEnabled: false,
    customTranslatorTemplates: {},
    customTranslatorModified: {},
    chuseokGalbwaeScope: 'off',
};
let requests = 0;
const requestSegments = async (_prompt, segments, options = {}) => {
    requests += 1;
    if (options.stage === 'tagged-content-untranslated-repair') {
        assert.equal(segments.length, 1, 'all failed tag rows share one repair request');
        return new Map([[segments[0].id, '상태 패널 안쪽의 인사.']]);
    }
    return new Map(segments.map(segment => [
        segment.id,
        segment.type === 'tagged_content' ? segment.text : '영어 서술문.',
    ]));
};
const result = await translateMinimalOutput(segmented, settings, {
    signal: new AbortController().signal,
    stage: 'output-translation',
}, {
    requestSegments,
    buildSourceMap: () => [],
});
assert.equal(requests, 2, 'one primary request plus exactly one tag-only repair request');
assert.match(result.translation, /<Info_panel>상태 패널 안쪽의 인사.<\/Info_panel>/u);

let cleanRequests = 0;
await translateMinimalOutput(segmented, settings, {
    signal: new AbortController().signal,
    stage: 'output-translation',
}, {
    requestSegments: async (_prompt, segments) => {
        cleanRequests += 1;
        return new Map(segments.map(segment => [
            segment.id,
            segment.type === 'tagged_content' ? '상태 패널 안쪽의 인사.' : '영어 서술문.',
        ]));
    },
    buildSourceMap: () => [],
});
assert.equal(cleanRequests, 1, 'clean tagged content adds no provider request');

let freeRequests = 0;
await translateMinimalOutput(segmented, { ...settings, translationEngine: 'google-free' }, {
    signal: new AbortController().signal,
    stage: 'output-translation',
}, {
    requestSegments: async (_prompt, segments) => {
        freeRequests += 1;
        return new Map(segments.map(segment => [segment.id, segment.text]));
    },
    buildSourceMap: () => [],
});
assert.equal(freeRequests, 1, 'free Google mode never wakes an AI-only repair request');

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.match(index, /repairUntranslatedTaggedContentOnce/);
assert.match(index, /stage:\s*'tagged-content-untranslated-repair'/);
assert.match(index, /if \(googleFreeEngineEnabled\(\)\) return \{ detected: 0, repaired: 0 \}/);

console.log('PASS: 태그 미번역은 로컬 감지 후 문제 구간만 최대 1회 복구하고 정상·무료 Google 결과에는 추가 AI 요청이 없음.');
