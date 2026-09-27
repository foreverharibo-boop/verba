import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between = (startText, endText) => {
    const start = index.indexOf(startText);
    const end = index.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `missing source range: ${startText}`);
    return index.slice(start, end);
};

assert.match(index, /promptSlotsCollapsed:\s*false,/);
assert.match(index, /settings\.promptSlotsCollapsed\s*=\s*settings\.promptSlotsCollapsed === true;/);

const markup = between(
    '                <details id="verba-deep-prompt-slots"',
    '                <label for="verba-deep-banned-words">',
);
assert.match(markup, /\$\{settings\.promptSlotsCollapsed \? '' : 'open'\}/);
assert.match(markup, /<summary>프롬프트 입력창 <small>4개 한꺼번에 접기·펴기<\/small><\/summary>/);
assert.equal([...markup.matchAll(/data-verba-deep-prompt-slot="/g)].length, 4);
for (const id of ['global', 'all-dialogue', 'dialogue', 'other-dialogue']) {
    assert.match(markup, new RegExp(`data-verba-deep-prompt-slot="${id}"`));
    assert.match(markup, new RegExp(`id="verba-deep-${id}-prompt-enabled"`));
    assert.match(markup, new RegExp(`id="verba-deep-${id}-prompt"`));
}

const listenerSource = between(
    "    const promptSlotsDetails = panel.querySelector('#verba-deep-prompt-slots');",
    "    panel.querySelector('#verba-deep-global-prompt').addEventListener('input'",
);
let toggleHandler;
const details = {
    open: true,
    addEventListener(type, handler) {
        assert.equal(type, 'toggle');
        toggleHandler = handler;
    },
};
const panel = {
    querySelector(selector) {
        assert.equal(selector, '#verba-deep-prompt-slots');
        return details;
    },
};
const settings = { promptSlotsCollapsed: true };
let saveCount = 0;
Function('panel', 'settings', 'saveSettings', listenerSource)(panel, settings, () => { saveCount += 1; });
assert.equal(typeof toggleHandler, 'function');
toggleHandler();
assert.equal(settings.promptSlotsCollapsed, false);
details.open = false;
toggleHandler();
assert.equal(settings.promptSlotsCollapsed, true);
assert.equal(saveCount, 2);

console.log('PASS: four prompt slots collapse together, preserve their controls, default open, and persist UI state.');
