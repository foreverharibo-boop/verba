// Request-local composition: source data and live engine rules never pass through
// an editable field. Unedited requests retain their original bytes.
const COMPOSITION = Symbol('verba translation composition');
export function customTranslationInstruction(settings = {}, key) {
    const value = settings.customTranslatorTemplates?.[key];
    return settings.customTranslatorEnabled === true && settings.customTranslatorModified?.[key] !== false
        && typeof value === 'string' && value.trim() ? value : null;
}
export function withTranslationComposition(settings = {}, key, build) {
    if (settings[COMPOSITION]) return build(settings);
    const disabled = key !== 'input' && (['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
        || settings.chuseokGalbwaeEnabled === true && !['off', 'all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope));
    return build({ ...settings, [COMPOSITION]: { key, disabled, emitted: new Set() } });
}
// Only literal, explicitly registered prose is editable. Excluded substrings
// describe routing/metadata and stay in the assembled request even after edits.
export function translationProse(settings, slot, original, excluded = []) {
    const context = settings?.[COMPOSITION];
    if (!context || context.disabled) return original;
    const key = slot === 'primary' ? context.key : slot;
    let editable = original;
    for (const part of excluded) editable = editable.replace(Array.isArray(part) ? part[0] : part, '');
    if (context.collected) {
        if (key === context.collectKey && editable.trim()) context.collected.push(editable.trim());
        return original;
    }
    const custom = customTranslationInstruction(settings, key);
    if (custom === null) return original;
    const first = !context.emitted.has(key);
    context.emitted.add(key);
    const scope = key === 'hongjin' ? 'Apply only to confirmed TARGET dialogue; never USER/NPC/uncertain speech, narration or tagged content.'
        : key === 'mad' ? 'This is the active MAD writing instruction within the enabled scope.'
        : key === 'input' ? 'Translate Korean USER input to English, preserving the distinction between narration and dialogue.' : '';
    return [first ? `[CUSTOM ${key.toUpperCase()} TRANSLATION RULES]\n${custom}\n[END CUSTOM TRANSLATION RULES]\nThese replace translation prose only. Current engine identity, name mappings, active settings and their scopes, protected structure and response contract remain authoritative over any legacy instructions in this block. ${scope}` : '', ...excluded.map(part => Array.isArray(part) ? part[1] : part)].filter(Boolean).join('\n');
}
export function collectTranslationProse(settings, key, build) {
    const context = { key: ['mad', 'hongjin'].includes(key) ? 'output' : key, collectKey: key, emitted: new Set(), collected: [] };
    build({ ...settings, [COMPOSITION]: context });
    return [...new Set(context.collected)].join('\n\n');
}
