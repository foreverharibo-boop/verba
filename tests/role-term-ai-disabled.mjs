import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const prompts = fs.readFileSync(new URL('../prompt-builders.js', import.meta.url), 'utf8');

const between = (startMarker, endMarker) => {
    const start = index.indexOf(startMarker);
    const end = index.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker);
    return index.slice(start, end);
};

assert.match(index, /const ROLE_TERM_AI_CONSISTENCY_ENABLED = false;/);

const plan = between(
    'async function planRepeatedRoleTermLocks(',
    'function protectedTokensIntact(',
);
assert.match(plan, /if \(!ROLE_TERM_AI_CONSISTENCY_ENABLED\) return \[\];/);
assert.match(plan, /buildRoleTermPlanPrompt/);
assert.match(plan, /stage: 'role-term-plan'/);
const planFunction = Function(
    `const ROLE_TERM_AI_CONSISTENCY_ENABLED = false; ${plan}; return planRepeatedRoleTermLocks;`,
)();
assert.deepEqual(await planFunction({ segments: [{ text: 'father father' }] }), []);

const repair = between(
    'async function repairRepeatedRoleTermConsistency(',
    'function normalizedSourceMap(',
);
assert.match(repair, /if \(!ROLE_TERM_AI_CONSISTENCY_ENABLED\) return;/);
assert.match(repair, /buildTermConsistencyRepairPrompt/);
assert.match(repair, /stage: 'role-term-consistency-repair'/);
const repairFunction = Function(
    `const ROLE_TERM_AI_CONSISTENCY_ENABLED = false; ${repair}; return repairRepeatedRoleTermConsistency;`,
)();
const translations = new Map([['seg_0000', '아버지']]);
assert.equal(
    await repairFunction({ segments: [{ id: 'seg_0000', text: 'master father' }] }, translations),
    undefined,
);
assert.equal(translations.get('seg_0000'), '아버지');

assert.match(prompts, /ROLE-TERM REPAIR:/);
assert.match(index, /await planRepeatedRoleTermLocks\(/);
assert.match(index, /await repairRepeatedRoleTermConsistency\(/);

console.log('PASS: both role-term AI stages are runtime-disabled by one reversible flag while their implementation and prompts remain intact.');
