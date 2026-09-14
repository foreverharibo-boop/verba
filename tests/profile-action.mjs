import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function source(start, end) {
    const a = index.indexOf(start); const b = index.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a);
    return index.slice(a, b);
}
function fixture(overrides = {}, hidden = false) {
    const settings = { profileId: 'p1', fallbackProfileId: 'p2', thirdProfileId: 'p3', activeProfileSlot: 'A', ...overrides };
    const calls = []; const listeners = new Map(); const frames = []; const roots = [];
    function element() {
        return {
            children: [], attributes: {}, events: {}, style: { setProperty(k, v) { this[k] = v; } },
            append(...children) { this.children.push(...children); },
            setAttribute(k, v) { this.attributes[k] = v; },
            addEventListener(k, fn) { this.events[k] = fn; },
            focus() { this.focused = true; },
            remove() { this.removed = true; },
            contains(target) { return target === this || this.children.includes(target); },
            getBoundingClientRect: () => ({ width: 180, height: 42 }),
            querySelector(selector) { return this.children.find(c => !c.disabled && (!selector.includes('aria-pressed') || c.attributes['aria-pressed'] === 'true')); },
            click() { if (!this.disabled) this.events.click?.({ preventDefault() {}, stopPropagation() {} }); },
        };
    }
    const anchor = { getBoundingClientRect: () => hidden ? { width: 0, height: 0 }
        : { left: 300, top: 650, width: 30, height: 30 } };
    const document = {
        createElement: element, body: { append: node => roots.push(node) },
        querySelector: selector => selector === '#verba-profile-toggle' ? anchor
            : roots.find(node => !node.removed && '#' + node.id === selector),
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name),
    };
    const context = { SlashCommand: { fromProps: x => x }, SlashCommandParser: { addCommandObject: cmd => {
        calls.push(['register']); context.command = cmd;
    } } };
    const env = { settings, document, console, innerWidth: 360, innerHeight: 720,
        liveContext: () => context, profileList: () => [{ id: 'p1', name: '<Profile A>' }, { id: 'p2', name: 'B profile' }, { id: 'p3', name: 'C profile' }],
        saveSettings: () => calls.push(['save']), refreshProfileToggleButton: () => calls.push(['refresh']),
        notify: (...args) => calls.push(['notify', ...args]), reportError: (...args) => calls.push(['error', ...args]), errorText: e => e.message,
        requestAnimationFrame: fn => frames.push(fn),
    };
    vm.runInNewContext(source('function activeProfileSlot()', 'let lastFallbackNoticeAt')
        + source('function selectTranslationProfile(', 'function refreshProfileToggleButton()')
        + '\nglobalThis.register = registerVerbaProfileSlashCommand; globalThis.icon = createProfileToggleButton;', env);
    env.register(); env.register(); assert.equal(calls.filter(c => c[0] === 'register').length, 1);
    assert.equal(context.command.name, 'verba-profile');
    const invoke = () => { assert.equal(context.command.callback(), ''); };
    return { settings, calls, listeners, frames, roots, env, invoke };
}

for (const hidden of [false, true]) {
    for (const slot of ['A', 'B', 'C']) {
        const f = fixture({}, hidden); f.invoke(); f.invoke();
        assert.equal(f.roots.length, 1, 'one popup despite repeated command');
        const menu = f.roots[0]; assert.deepEqual(menu.children.map(c => c.textContent), ['A ✓', 'B', 'C']);
        assert.equal(menu.children[0].title, 'A: <Profile A>', 'profile name remains plain text');
        assert.ok(parseFloat(menu.style.left) >= 8 && parseFloat(menu.style.left) + 180 <= 352);
        assert.ok(parseFloat(menu.style.top) >= 8 && parseFloat(menu.style.top) + 42 <= 712);
        f.frames.forEach(fn => fn());
        menu.children[['A', 'B', 'C'].indexOf(slot)].click();
        assert.equal(f.settings.activeProfileSlot, slot); assert.equal(menu.removed, true); assert.equal(f.listeners.size, 0);
        assert.equal(f.calls.filter(c => c[0] === 'save').length, 1); assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 1);
        assert.deepEqual(Object.keys(f.settings).sort(), ['activeProfileSlot', 'fallbackProfileId', 'profileId', 'thirdProfileId']);
        assert.equal(f.settings.profileId, 'p1'); assert.equal(f.settings.fallbackProfileId, 'p2'); assert.equal(f.settings.thirdProfileId, 'p3');
    }
}
// Duplicate/empty slots cannot be selected; no configured profiles show feedback.
{
    const f = fixture({ fallbackProfileId: 'p1', thirdProfileId: '' }); f.invoke();
    assert.deepEqual(f.roots[0].children.map(c => c.disabled), [false, true, true]);
    f.roots[0].children[1].click(); assert.equal(f.calls.filter(c => c[0] === 'save').length, 0);
    const empty = fixture({ profileId: '', fallbackProfileId: '', thirdProfileId: '' }); empty.invoke();
    assert.equal(empty.roots.length, 0); assert.equal(empty.calls.at(-1)[0], 'notify');
}
// Settings changed while the popup was open: never select a different profile silently.
{
    const f = fixture(); f.invoke(); f.settings.fallbackProfileId = 'replacement';
    f.roots[0].children[1].click(); assert.equal(f.settings.activeProfileSlot, 'A');
    assert.equal(f.calls.filter(c => c[0] === 'save').length, 0);
}
for (const how of ['escape', 'outside']) {
    const f = fixture(); f.invoke(); f.frames.forEach(fn => fn());
    if (how === 'escape') f.listeners.get('keydown')({ key: 'Escape' });
    else f.listeners.get('pointerdown')({ target: {} });
    assert.equal(f.roots[0].removed, true); assert.equal(f.listeners.size, 0);
    assert.equal(f.calls.filter(c => c[0] === 'save').length, 0);
}
// Existing icon continues cycling A/B/C using the same selection helper.
{
    const f = fixture(); const icon = f.env.icon();
    for (const slot of ['B', 'C', 'A']) { icon.click(); assert.equal(f.settings.activeProfileSlot, slot); }
}
assert.ok(source('function initialize()', "if (document.readyState === 'loading')").includes('registerVerbaProfileSlashCommand();'));
console.log('PASS: profile command registration, A/B/C popup, current marker, disabled/stale slots, persistence, dismissal, hidden-anchor placement and existing icon cycle. DOM adapter; no API calls.');
