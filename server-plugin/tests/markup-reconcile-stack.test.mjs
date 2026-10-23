import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSourceChange, reconcileCompletedResult } from '../../server-result-compat.js';

test('long replies reconcile a removed extension block without call-stack overflow', () => {
    const narrative = 'A'.repeat(4300);
    const hidden = `<sfw_scene>${JSON.stringify({ scene: { acts: ['x'.repeat(450)] }, heat: 1 })}</sfw_scene>`;
    const info = '<Info_panel>Location: Kitchen</Info_panel>';
    const before = `${narrative}\n\n${hidden}\n\n${info}`;
    const after = `${narrative}\n\n\n\n${info}`;
    const translated = `가`.repeat(4300) + `\n\n${hidden}\n\n${info}`;

    assert.equal(describeSourceChange(before, after).relation, 'closed-markup-blocks-removed');
    const result = reconcileCompletedResult(before, after, { translation: translated, sourceMap: [] });
    assert.ok(result);
    assert.equal(result.translation.includes('<sfw_scene>'), false);
    assert.equal(result.translation.includes('<Info_panel>'), true);
});

test('sequential middle and final tag cleanup tolerates the leftover trailing separator', () => {
    const narrative = 'A'.repeat(4300);
    const scene = '<sfw_scene>{"scene":{"type":"romance"},"heat":0}</sfw_scene>';
    const info = '<Info_panel>Location: Kitchen</Info_panel>';
    const archive = '<archive-now>\n1> ended\n</archive-now>';
    const before = `${narrative}\n\n${scene}\n\n${info}\n${archive}`;
    const after = `${narrative}\n\n\n\n${info}`;
    const translated = `${'가'.repeat(4300)}\n\n${scene}\n\n${info}\n${archive}`;

    assert.equal(describeSourceChange(before, after).relation, 'closed-markup-blocks-removed');
    const result = reconcileCompletedResult(before, after, { translation: translated, sourceMap: [] });
    assert.ok(result);
    assert.equal(result.translation.includes('<sfw_scene>'), false);
    assert.equal(result.translation.includes('<archive-now>'), false);
    assert.equal(result.translation.includes('<Info_panel>'), true);
    assert.equal(result.translation.endsWith('</Info_panel>'), true);
});

test('malformed markup still fails closed instead of deleting arbitrary text', () => {
    const before = 'Narrative <private>unfinished';
    const after = 'Narrative ';
    assert.equal(describeSourceChange(before, after).relation, 'tail-removed');
    assert.equal(reconcileCompletedResult(before, after, { translation: before, sourceMap: [] }), null);
});
