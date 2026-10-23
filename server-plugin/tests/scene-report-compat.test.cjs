'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { excludeVerifiedSceneReports } = require('../scene-report-compat.cjs');

test('server translates exact visible scene text without waiting for a browser', () => {
    const before = 'Narration.\n\n<scene_state>{"_v":2,"scene":{"location":"room"},"heat":8}</scene_state>\n\n<Info_panel>Keep</Info_panel>';
    const result = excludeVerifiedSceneReports(before);
    assert.equal(result.source, 'Narration.\n\n\n\n<Info_panel>Keep</Info_panel>');
    assert.equal(result.removed, 1);
    assert.equal(before.includes('<scene_state>'), true, 'original message is not mutated');
    const sfw = excludeVerifiedSceneReports('A <sfw_scene>{"location":"home"}</sfw_scene> B');
    assert.equal(sfw.source, 'A  B');
    assert.equal(sfw.removed, 1);
});
test('unverified and incomplete markup is never guessed to be safe', () => {
    for(const source of [
        'Narration <scene_state>not json</scene_state> end',
        'Narration <scene_state>{"scene":{}}',
        'Narration <other_ext>{"scene":{}}</other_ext> end',
        'Narration <scene_state>{"unknown_field":"prose"}</scene_state> end',
        '<scene_state>{"scene":{}}</scene_state>',
    ]) {
        assert.equal(excludeVerifiedSceneReports(source).source, source.trim());
        assert.equal(excludeVerifiedSceneReports(source).removed, 0);
    }
});
