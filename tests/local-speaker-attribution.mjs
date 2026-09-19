import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildOutputPrompt,
    inferLocalTargetDialogueScopes,
    resolveOutputSpeakerIdentity,
    segmentSource,
} from '../core.js';

const locks = [
    { source: 'Hong-jin', target: '홍진' },
    { source: 'Dam-eun', target: '담은' },
];
const identity = resolveOutputSpeakerIdentity({
    characterName: '김홍진',
    userName: '담은',
    characterGender: 'male',
}, locks);

const source = `Hong-jin checked the corridor. Dam-eun stayed behind him.

"Keep moving," he said.

Hong-jin scanned the garage.

"We go up the ramp," he said. "Then we find a steel door."

Hong-jin stepped inside and turned back to Dam-eun.

"Get in. Now."

He shut the door and checked the lock.

"Check the back room," he said. "Make sure there is water."

He pressed gauze to the cut.

"We rest here," he said. "Then we figure out where the hell we go next."`;
const segmented = segmentSource(source, locks);
const scopes = inferLocalTargetDialogueScopes(segmented, identity);
const dialogueIds = segmented.segments.filter(row => row.type === 'dialogue_candidate').map(row => row.id);
assert.ok(dialogueIds.length >= 7);
for (const id of dialogueIds) assert.equal(scopes[id], 'target_dialogue', `${id} should be locally confirmed as Hong-jin`);

const mixed = segmentSource(`Hong-jin looked at Dam-eun. "No," she said. Dam-eun turned away. "Wait here."`, locks);
const mixedScopes = inferLocalTargetDialogueScopes(mixed, identity);
for (const id of mixed.segments.filter(row => row.type === 'dialogue_candidate').map(row => row.id)) {
    assert.equal(mixedScopes[id], 'user_dialogue', `${id} must be identified as current USER dialogue`);
}

const npc = segmentSource(`A guard raised his weapon. "Stop right there," he shouted.`, locks);
const npcId = npc.segments.find(row => row.type === 'dialogue_candidate').id;
assert.equal(inferLocalTargetDialogueScopes(npc, identity)[npcId], 'npc_dialogue');

// Regression: the real failure shape that previously left every Hong-jin line
// clean. The USER can be mentioned between the target's name and a post-quote
// masculine speech tag without stealing the following dialogue scope.
const realFailureShape = segmentSource(`Hong-jin crossed the garage. Dam-eun's footsteps followed behind him.

"Keep moving," he said, wiping his knife clean.

Hong-jin checked the exit ramp.

"We go up the ramp and out," he said. "Then we find a ground-level storefront with steel shutters."

Hong-jin swept the dry cleaner with his flashlight and turned back to Dam-eun.

"Get in. Now."

He dragged a clothing rack across the door.

"Check the back room," he said, not looking at her. "Make sure there's no other way in."

He pressed gauze to the cut.

"We rest here for an hour," he said. "Then we figure out where the hell we're going next."`, locks);
const realFailureScopes = inferLocalTargetDialogueScopes(realFailureShape, identity);
const realFailureDialogueIds = realFailureShape.segments
    .filter(row => row.type === 'dialogue_candidate')
    .map(row => row.id);
assert.ok(realFailureDialogueIds.length >= 8);
for (const id of realFailureDialogueIds) {
    assert.equal(realFailureScopes[id], 'target_dialogue', `${id} in the real failure shape must receive Hong-jin voice`);
}

const prompt = buildOutputPrompt(segmented, {
    developerMode: true,
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerHongjinProfanity: 'high',
}, '', identity, null, scopes);
assert.match(prompt, /"speaker_scope":"target_dialogue"/);
assert.match(prompt, /speaker_scope is an absolute row-level firewall/);
assert.match(prompt, /prohibit added TARGET profanity/);

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.match(index, /inferLocalTargetDialogueScopes\(segmented, speakerIdentity\)/);
assert.match(index, /options\.tuning \|\| null,\s*speakerScopes,/s);
assert.match(index, /localFlavorIdentityNameLocks/);
assert.doesNotMatch(index, /needsHongjinAttribution/);

const selectionResolverStart = index.indexOf('function selectionResolvedSpeakerScope(');
const selectionResolverEnd = index.indexOf('function bundleStillCurrent(', selectionResolverStart);
assert.ok(selectionResolverStart >= 0 && selectionResolverEnd > selectionResolverStart);
const resolveSelectionScope = Function(
    'selectionTouchesDialogue',
    'normalizedCharacterNameLocks',
    'segmentSource',
    'inferLocalTargetDialogueScopes',
    'selectionSourceRows',
    `${index.slice(selectionResolverStart, selectionResolverEnd)}\nreturn selectionResolvedSpeakerScope;`,
)(
    (translationValue, startValue, endValue) => /["“][^"”]+["”]/u.test(String(translationValue).slice(startValue, endValue)),
    () => locks,
    segmentSource,
    inferLocalTargetDialogueScopes,
    snapshot => snapshot.sourceMap.filter(row => snapshot.start < row.end && snapshot.end > row.start),
);

const selectionSource = `Hong-jin entered. Dam-eun stood. "You look awful," she said. A medic approached. "Rest here," she said. Hong-jin frowned. "I'm fine," he said.`;
const selectionSegments = segmentSource(selectionSource, locks);
const dialogueSegmentsForSelection = selectionSegments.segments.filter(row => row.type === 'dialogue_candidate');
assert.equal(dialogueSegmentsForSelection.length, 3);
const renderedDialogue = ['"꼴이 말이 아니네."', '"여기서 쉬세요."', '"멀쩡해."'];
let renderedTranslation = '';
const selectionMap = dialogueSegmentsForSelection.map((row, indexValue) => {
    const start = renderedTranslation.length;
    renderedTranslation += renderedDialogue[indexValue];
    const end = renderedTranslation.length;
    renderedTranslation += '\n';
    return { id: row.id, source: row.text, start, end };
});
const scopeAt = indexValue => resolveSelectionScope({
    source: selectionSource,
    translation: renderedTranslation,
    start: selectionMap[indexValue].start,
    end: selectionMap[indexValue].end,
    sourceMap: selectionMap,
}, identity);
assert.equal(scopeAt(0), 'user_dialogue', 'current USER selection must retain USER scope');
assert.equal(scopeAt(1), 'npc_dialogue', 'third-party selection must retain NPC scope');
assert.equal(scopeAt(2), 'target_dialogue', 'Hong-jin selection must retain Hong-jin voice');
const staleMedicMap = selectionMap.map(row => ({ ...row }));
staleMedicMap[1] = {
    ...staleMedicMap[1],
    id: selectionMap[2].id,
    source: selectionMap[1].source,
};
assert.equal(resolveSelectionScope({
    source: selectionSource,
    translation: renderedTranslation,
    start: staleMedicMap[1].start,
    end: staleMedicMap[1].end,
    sourceMap: staleMedicMap,
}, identity), 'npc_dialogue', 'stale id collision must fall back to source text instead of leaking target voice');

console.log(`PASS: local attribution marks ${dialogueIds.length} TARGET lines and selection retranslation separates current USER, NPC and TARGET without an API call.`);
