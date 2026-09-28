import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const between = (start, end) => index.slice(index.indexOf(start), index.indexOf(end, index.indexOf(start)));

assert.match(index, /key: 'settingsSearch', label: '설정 검색', selector: '#verba-settings-search'/);
assert.match(index, /\$\{settingsVisibilityMarkup\(\)\}\s*\$\{settingsSearchMarkup\(\)\}\s*<section id="verba-profile-settings-group"/);
assert.match(index, /id="verba-settings-search-input"[\s\S]*?placeholder="설정 이름·옵션·설명 검색"/);
assert.match(index, /function settingsSearchHaystack[\s\S]*?element\.textContent/);
assert.match(index, /function settingsSearchHaystack[\s\S]*?placeholder[\s\S]*?title[\s\S]*?aria-label/);
assert.match(index, /tokens\.every\(token => settingsSearchHaystack\(element, label\)\.includes\(token\)\)/);
assert.match(index, /detail\.open = matched && tokens\.every/);
assert.match(index, /verbaSearchWasOpen[\s\S]*?delete detail\.dataset\.verbaSearchWasOpen/);
assert.match(index, /key === 'settingsSearch' && !target\.checked[\s\S]*?resetSettingsSearch\(panel\)/);
assert.match(index, /인터넷 밈 농도/);
assert.match(style, /\.verba-settings-search\s*\{/);
assert.match(style, /\.verba-settings-search\[hidden\][\s\S]*?display:\s*none\s*!important/);

const normalizeSource = between('function normalizedSettingsSearchText(', 'function settingsSearchTargets(');
const normalize = Function(`${normalizeSource}; return normalizedSettingsSearchText;`)();
assert.equal(normalize('  인터넷   밈　농도 '), '인터넷 밈 농도');
assert.equal(normalize('ABC'), 'abc');

console.log('PASS: settings search is placed below screen composition, searches groups/options/help, opens matches, restores state, and can itself be hidden.');
