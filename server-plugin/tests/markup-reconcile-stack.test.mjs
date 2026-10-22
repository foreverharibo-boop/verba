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

test('malformed markup still fails closed instead of deleting arbitrary text', () => {
    const before = 'Narrative <private>unfinished';
    const after = 'Narrative ';
    assert.equal(describeSourceChange(before, after).relation, 'tail-removed');
    assert.equal(reconcileCompletedResult(before, after, { translation: before, sourceMap: [] }), null);
});
