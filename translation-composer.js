// The editor and request builders share the exact same translation prose.
// Only explicitly registered prose blocks pass through this module. Identity,
// current settings, task contracts and source data never enter this splitter.
const COMPOSITION = Symbol('translation composition');
const GENERAL_KEYS = new Set(['output', 'input', 'selection', 'mad', 'hongjin']);

const INTERNAL_SENTENCE = /@@VERBA|\b(?:JSON|NAME LOCK|TARGET CHARACTER|TARGET-CHARACTER|TARGET ADDRESSEE GENDER|USER\/NPC|CURRENT USER|PRIMARY CAST REFERENCES|K→E input|segment id|editable id|between ids|protected (?:layout|structure|tokens)|required output format|identity spelling context|inert data)\b|Ignore every saved\/custom base instruction|This is the only E→K writing engine|Never apply this block to|Translation direction is always|User prompts may affect|LEFT CONTEXT|RIGHT CONTEXT|EXISTING KOREAN CONTEXT|Return exactly three distinct|Return a new Korean replacement for only|Preserve (?:Markdown|macros)|tags, attributes, code|Metadata keeps its existing number\/layout rules|^Handle /iu;

export function splitTranslationProse(value) {
    const editable = [], internal = [];
    for (const line of String(value || '').split('\n')) {
        // Split only at sentence boundaries, preserving every original word.
        // A structural sentence embedded in a prose paragraph stays internal;
        // the remaining original sentences are still available in the editor.
        // These complete lines explain runtime metadata or engine switches;
        // keeping their trailing pronouns alone would produce orphaned prose.
        if (/^\s*(?:-\s*)?(?:Ignore every saved\/custom base instruction|This is the only E→K writing engine|TARGET ADDRESSEE GENDER is|"neutral" means|"unknown" means|Did a known TARGET CHARACTER|DEVELOPER KIM HONGJIN FLAVOR|SCENE FACTS AND OUTPUT CONTRACT)/u.test(line)) {
            internal.push(line);
            continue;
        }
        const sentences = line.split(/(?<=[.!?]) (?=[A-Z])/u);
        const visible = [], fixed = [];
        for (const sentence of sentences) {
            (INTERNAL_SENTENCE.test(sentence) ? fixed : visible).push(sentence);
        }
        if (visible.length) editable.push(visible.join(' '));
        if (fixed.length) internal.push(fixed.join(' '));
    }
    return { editable: editable.join('\n').replace(/\n{3,}/g, '\n\n').trim(), internal: internal.join('\n').trim() };
}

export function customTranslationInstruction(settings = {}, key) {
    if (settings.customTranslatorEnabled !== true) return null;
    const value = settings.customTranslatorTemplates?.[key];
    const modified = settings.customTranslatorModified?.[key];
    // Older versions had no modified flag. Preserve their nonempty edits.
    if (modified === false || typeof value !== 'string' || !value.trim()) return null;
    return value;
}

export function withTranslationComposition(settings = {}, key, build) {
    if (settings[COMPOSITION]) return build(settings);
    const context = { key, emitted: new Set(), collected: null };
    const galbwaeActive = key !== 'input' && (['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
        || settings.chuseokGalbwaeEnabled === true);
    context.disabled = galbwaeActive;
    const active = !galbwaeActive && (
        ((key !== 'output' || settings.developerMadKoreanOutputEnabled !== true)
            && customTranslationInstruction(settings, key) !== null)
        || (key !== 'input'
            && ((settings.developerMadKoreanOutputEnabled === true && customTranslationInstruction(settings, 'mad') !== null)
                || (settings.developerHongjinFlavorEnabled === true && customTranslationInstruction(settings, 'hongjin') !== null)))
    );
    const current = { ...settings, [COMPOSITION]: context };
    // Custom prose is not rewritten through the experimental compressed modes.
    if (active) {
        current.developerCompressedPromptEnabled = false;
        current.developerExtremeCompressedPromptEnabled = false;
    }
    return build(current);
}

export function translationProse(settings, slot, original) {
    const context = settings?.[COMPOSITION];
    if (!context || context.disabled) return original;
    const key = slot === 'primary' ? context.key : slot;
    if (!GENERAL_KEYS.has(key)) return original;
    const custom = context.collected ? null : customTranslationInstruction(settings, key);
    if (!context.collected && custom === null) return original;
    const parts = splitTranslationProse(original);
    if (context.collected) {
        if (key === context.collectKey && parts.editable) context.collected.push(parts.editable);
        return original;
    }
    const first = !context.emitted.has(key);
    context.emitted.add(key);
    return [first ? `[CUSTOM ${key.toUpperCase()} TRANSLATION RULES]\n${custom}\n[END CUSTOM TRANSLATION RULES]\nThe current engine context, active setting scopes, protected structure and response contract supplied by this request remain authoritative; this block replaces translation prose only. A CUSTOM MAD or CUSTOM HONGJIN block is the active writing instruction for that enabled taste, not an excluded ordinary base prompt. CUSTOM HONGJIN applies only to confirmed TARGET dialogue; CUSTOM MAD follows the enabled MAD scope. Apply it only within the enabled taste and speaker scope.` : '', parts.internal].filter(Boolean).join('\n');
}

export function collectTranslationProse(settings, key, build) {
    const context = { key: ['mad', 'hongjin'].includes(key) ? 'output' : key, collectKey: key, emitted: new Set(), collected: [] };
    build({ ...settings, customTranslatorEnabled: false, [COMPOSITION]: context });
    return [...new Set(context.collected)].join('\n\n');
}
