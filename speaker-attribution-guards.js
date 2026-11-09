// These guards only withdraw an unsafe local speaker hint. They never assign
// a new speaker or make a model request; unknown_dialogue uses existing routing.
const speechVerb = '(?:said|says|say|saying|asked|asks|replied|replies|answered|answers|called|calls|shouted|shouts|whispered|whispers|muttered|mutters|added|adds|continued|continues|snapped|snaps|growled|growls|told|tells)';
const knownActorMarker = '@@VERBA_SCOPE_KNOWN@@';
const namedActor = '(?:@@VERBA_SCOPE_KNOWN@@|@@VERBA_(?:DEEP_)?NAME_\\d{4}@@|\\p{Lu}[\\p{L}’\'-]*(?:\\s+\\p{Lu}[\\p{L}’\'-]*){0,3})';

export function hasUnrecognizedSpeechActor(text, aliases, atStart = false) {
    let value = String(text || '').trim();
    const known = new Set([
        ...aliases.targetNames, ...aliases.userNames,
        ...aliases.targetTokens, ...aliases.otherTokens,
    ].map(name => String(name).toLocaleLowerCase()));
    // Preserve complete known identities (e.g. Jean de la Fontaine); a capital
    // surname fragment must not look like a new NPC. This copy is never sent.
    for (const name of [...known].filter(Boolean).sort((a, b) => b.length - a.length)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        value = value.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'giu'), `$1${knownActorMarker}`);
    }
    known.add(knownActorMarker.toLocaleLowerCase());
    const prefix = atStart ? '^' : '(?:^|[\\s,;:—])';
    const matches = [...value.matchAll(new RegExp(`${prefix}(${namedActor})\\s+(?:(?:quietly|softly|loudly|calmly)\\s+)?${speechVerb}\\b`, 'gu'))];
    // Inverted tags such as "...," said John. are recognized only at the
    // beginning of a narration fragment, not inside a longer clause.
    const inverted = value.match(new RegExp(`^${speechVerb}\\s+(${namedActor})(?=$|[^\\p{L}\\p{N}_])`, 'u'));
    const actor = matches.at(-1)?.[1] || inverted?.[1];
    if (!actor || /^(?:he|she|they|i|you|we|it)$/iu.test(actor)) return false;
    return !known.has(actor.toLocaleLowerCase());
}

export function introducesIndirectSpeech(text) {
    const value = String(text || '').trim();
    // Inspect only the latest sentence. Remembering an unrelated event in an
    // earlier sentence must not invalidate the following live dialogue.
    let sentence = value.split(/(?<=[.!?])\s+/u).at(-1) || '';
    // A trailing memory aside does not turn an explicit live speech tag into
    // recalled dialogue: 'Shin said, remembering John's words.'
    const aside = sentence.search(/,\s*(?:remembering|recalling|imagining)\b/iu);
    if (aside >= 0 && /\b(?:said|says|asked|asks|replied|replies|answered|answers)\b/iu.test(sentence.slice(0, aside))) {
        sentence = sentence.slice(0, aside);
    }
    // An explicit new speaking action after a comma ends the earlier action.
    // 'Shin quoted a price, then said, ...' is still live dialogue.
    const live = sentence.match(/,\s*(?:then|and then)\s+(?:said|says|asked|asks|replied|replies|answered|answers)\s*[:,]?\s*$/iu);
    if (live) sentence = sentence.slice(live.index);

    const memory = /\b(?:remember(?:ed|s|ing)?|recall(?:ed|s|ing)?|imagin(?:ed|es|ing))\b/iu.exec(sentence);
    if (memory) {
        const tail = sentence.slice(memory.index + memory[0].length);
        if (new RegExp(`\\b${speechVerb}\\b|\\b(?:words|voice|quotation)\\b|^\\s*[:,]\\s*$`, 'iu').test(tail)) return true;
    }
    return /\b(?:quoted|quotes|quoting|imitated|imitates|imitating)\b/iu.test(sentence)
        || /\b(?:read|reads|reading|repeated|repeats|repeating|echoed|echoes|echoing)\b[^.!?]*\b(?:words|note|letter|message|quotation|line)\b/iu.test(sentence);
}

export function hasAttachedSpeechTag(dialogue, text) {
    // A new sentence following "Hello." may introduce the NEXT speaker.
    // Do not retroactively invalidate that completed dialogue. Comma/question/
    // exclamation continuations and inverted tags can attach to the quote.
    return /[,?!]["”」』]\s*$/u.test(String(dialogue || ''))
        || new RegExp(`^${speechVerb}\\s`, 'u').test(String(text || '').trim());
}

export function hasUncertainPostQuoteTag(dialogue, text, aliases) {
    if (!hasAttachedSpeechTag(dialogue, text)) return false;
    const firstSentence = String(text || '').trim().split(/(?<=[.!?])\s+/u)[0] || '';
    return hasUnrecognizedSpeechActor(firstSentence, aliases, true)
        || introducesIndirectSpeech(firstSentence)
        || /^(?:he|she|they)\s+(?:remembered|recalled|imagined)\b/iu.test(firstSentence);
}
