import { customTranslationInstruction } from './translation-composer.js';
import { bilingualPromptRequestsOutput } from './bilingual-intent.js';

export function activeCustomOutput(settings = {}) {
    const exclusive = settings.developerMadKoreanOutputEnabled === true
        || (settings.developerMode === true && (['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
            || settings.chuseokGalbwaeEnabled === true && settings.chuseokGalbwaeScope !== 'off'));
    return exclusive ? '' : (customTranslationInstruction(settings, 'output') || '');
}
const markers = {
    italic: /italics?|이탤릭|기울임|\(\*\.\.\.\*\)/iu,
    bold: /bold|굵게|굵은|\*\*\.\.\.\*\*/iu,
    code: /backticks?|code\s*(?:blocks?|spans?|fences?)|백틱|코드\s*블록|`/iu,
    bracket: /square\s*brackets?|대괄호|\[\.\.\.\]/iu,
};
// This is a conservative local permission check, not a rewrite of the user's
// instructions. The model receives the full prompt to resolve detailed scopes.
export function promptRequestsScope(prompt, kind) {
    for (const line of String(prompt || '').split(/\r?\n/u)) {
        const scopedMarkers = Object.entries(markers).filter(([, re]) => re.test(line)).map(([key]) => key);
        const clauses = line.split(/;|(?<=[.!?])\s+(?=[A-Z가-힣])|\bbut\b|하지만/iu);
        const affirmative = clauses.some(clause => bilingualPromptRequestsOutput(clause)
            || (!/(?:never|do not|금지|하지)/iu.test(clause) && /(?:output|show|display).*both.*English.*(?:and|with).*Korean/iu.test(clause))
            || (!/(?:do not|never|금지|하지\s*마)/iu.test(clause)
                && /(?:copy|keep|preserve|retain)\b.*\b(?:english|source|original)\b.*\b(?:add|append)\b.*\bkorean\b/iu.test(clause)));
        if (!affirmative) continue;
        if (scopedMarkers.length) {
            // Brackets used only as the output separator are not source scopes.
            const sourceScoped = /(?:marked|enclosed|inside|between|spans?|구간|사이|안에|안의|속의|속)/iu.test(line);
            if (sourceScoped && !scopedMarkers.includes(kind)) continue;
            if (sourceScoped) return true;
        }
        const dialogueOnly = /(?:dialogue|대사)/iu.test(line) && !/(?:narration|서술|all\s+text|전체)/iu.test(line);
        const narrationOnly = /(?:narration|서술)/iu.test(line) && !/(?:dialogue|대사)/iu.test(line);
        if (dialogueOnly && kind !== 'dialogue' || narrationOnly && kind === 'dialogue') continue;
        return true;
    }
    return false;
}
export function bilingualScopeRequested(settings = {}, kind = 'narration') {
    if (settings.developerMadKoreanOutputEnabled === true
        || settings.developerMode === true && (['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
            || settings.chuseokGalbwaeEnabled === true && settings.chuseokGalbwaeScope !== 'off')) return false;
    return (settings.globalPromptEnabled !== false && promptRequestsScope(settings.globalPrompt, kind))
        || (kind === 'dialogue' && settings.allDialoguePromptEnabled !== false && promptRequestsScope(settings.allDialoguePrompt, kind))
        || promptRequestsScope(activeCustomOutput(settings), kind);
}
export const OUTPUT_FORMAT_POLICY = `OUTPUT FORMAT AUTHORITY — applies to assistant-output translation only:
Only active GLOBAL, ALL-DIALOGUE and CUSTOM OUTPUT TRANSLATION RULES can request bilingual formatting. CUSTOM OUTPUT is the user's chat-translation instruction, not a lower-priority suggestion. Respect each instruction's exact scope; ALL-DIALOGUE is limited to direct dialogue. A request for marked spans does not enable bilingual text elsewhere. No explicit applicable request means Korean-only. Speaker-specific and one-time rules cannot enable bilingual formatting.
Preserve Markdown emphasis delimiters, nesting and links. For requested marked-span bilingual output, keep the original marker around both languages, using the user's requested inner separator. Do not duplicate whole source paragraphs or metadata entries.
Rows with type=code_content are readable inline-backtick/fenced text, NOT paired-tag interiors. Their delimiters and executable syntax are stored locally: return inner text only; never add wrapper backticks. Apply GLOBAL/CUSTOM OUTPUT bilingual requests to this natural language only, without applying dialogue-only rules or modifying code syntax.
ABSOLUTE TAG EXCEPTION: rows with type=tagged_content are actual paired-tag interiors, including code nested inside tags. Translate their readable text into Korean ONLY even when any prompt requests bilingual text. Preserve tags, attributes, field count/order, brackets, separators, numbers/units, protected tokens and metadata layout. Never duplicate fields. Style/script remain protected.`;

// Mask only source text actually paired with Korean; keep offsets and review
// accidental English in the Korean half. A permission alone never skips review.
export function maskRequestedBilingualSource(segment, translation, settings = {}, restore = value => value) {
    const text = String(translation || '');
    if (segment?.type === 'tagged_content') return text;
    const source = restore(String(segment?.text || ''));
    const units = [];
    const add = (value, kind) => {
        if (bilingualScopeRequested(settings, kind) && /[A-Za-z]/u.test(value)) units.push(value);
    };
    if (segment?.type === 'code_content') add(source, 'code');
    else {
        add(source.replace(/^["“‘']|["”’']$/gu, ''), segment?.type === 'dialogue_candidate' ? 'dialogue' : 'narration');
        for (const m of source.matchAll(/(\*\*|\*|__|_)([^\n]+?)\1|\[([^\]\n]+)\](?!\()/gu)) {
            add(m[2] ?? m[3], m[3] !== undefined ? 'bracket' : m[1].length === 2 ? 'bold' : 'italic');
        }
    }
    let masked = text;
    for (const unit of [...new Set(units)].sort((a,b) => b.length-a.length)) {
        let pos = 0;
        while ((pos = text.indexOf(unit, pos)) >= 0) {
            const tail = text.slice(pos + unit.length);
            // A Korean counterpart must follow within the same marked value.
            const paired = /^\s*(?:[\[（(【]\s*[^\]）)】\n]*[가-힣][^\]）)】\n]*[\]）)】]|[가-힣][^\]\n]*\])/u.test(tail);
            if (paired) masked = masked.slice(0,pos) + ' '.repeat(unit.length) + masked.slice(pos+unit.length);
            pos += unit.length;
        }
    }
    return masked;
}

export function outputFormatReviewContext(settings = {}) {
    return OUTPUT_FORMAT_POLICY + '\nFORMAT REFERENCE (retain requested source copies; do not expand their scope):\n'
        + JSON.stringify({global: settings.globalPromptEnabled !== false ? settings.globalPrompt || '' : '',
            dialogue: settings.allDialoguePromptEnabled !== false ? settings.allDialoguePrompt || '' : '',
            customOutput: activeCustomOutput(settings)});
}
