import { customTranslationInstruction } from './translation-composer.js';
import { bilingualPromptRequestsOutput, isBilingualFormatHeading, hasBilingualInstructionExclusion } from './bilingual-intent.js';

export function activeCustomOutput(settings = {}) {
    const exclusive = settings.developerMadKoreanOutputEnabled === true
        || (settings.developerMode === true && (['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
            || settings.chuseokGalbwaeEnabled === true && settings.chuseokGalbwaeScope !== 'off'));
    return exclusive ? '' : (customTranslationInstruction(settings, 'output') || '');
}
const markers = {
    italic: /italics?|이탤릭|기울임|\(\*\.\.\.\*\)/iu,
    bold: /bold|굵게|굵은|\*\*\.\.\.\*\*/iu,
    fenced: /fenced|triple[ -]*(?:backticks?|ticks?)|code\s*blocks?|코드\s*블록|백틱\s*(?:세|3)\s*개|`{3}|~{3}/iu,
    code: /backticks?|(?:inline\s*code|code\s*spans?)|백틱|(?<!`)`(?!`)/iu,
    bracket: /square\s*brackets?|대괄호|\[\.\.\.\]/iu,
};
// Permissions describe SOURCE scopes, not punctuation used in an output example.
// Collect scope declarations across sentences so "Copy the English ..." retains
// the preceding marked-span restriction instead of enabling the whole message.
const scopeKinds = ['italic', 'bold', 'code', 'fenced', 'bracket', 'dialogue', 'narration'];
function namedScopes(value) {
    const scopes = Object.entries(markers).filter(([, re]) => re.test(value)).map(([key]) => key);
    if (scopes.includes('fenced') && !/inline|single[ -]*backtick|백틱\s*(?:한|1)\s*개|(?<!`)`[^`\n]+`(?!`)/iu.test(value)) {
        const index = scopes.indexOf('code');
        if (index >= 0) scopes.splice(index, 1);
    }
    if (/\bdialogue\b|대사/iu.test(value)) scopes.push('dialogue');
    if (/\bnarration\b|서술|나레이션/iu.test(value)) scopes.push('narration');
    return scopes;
}
function sourceScopes(clause) {
    // In "For italics, place Korean in square brackets", brackets describe the
    // output separator, not another source scope. Read the introductory scope.
    const source = clause.match(/(?:source\s+text|(?:any|each|all)\s+spans?|text)\s+(?:in\s+the\s+source\s+)?(?:enclosed|marked|wrapped|inside|between)[\s\S]*?(?=\s+(?:is|are)\s|,\s*(?:preserve|keep|copy|retain|output|show)|$)/iu);
    if (source) return namedScopes(source[0]);
    const action = clause.search(/\b(?:copy|keep|preserve|retain|place|put|add|append|output|show|display|translate|render|write|include)\b/iu);
    const beforeAction = action > 0 ? namedScopes(clause.slice(0, action)) : [];
    if (beforeAction.length) return beforeAction;
    const target = clause.match(/\b(?:for|inside|within|between|in)\s+(.+?)(?=\s+(?:as|using|with|followed)\b|$)/iu);
    if (target && !/\b(?:korean|translation|english)\b/iu.test(target[1])) return namedScopes(target[1]);
    // Korean instructions and short labelled rules ("Italics: ...") carry the
    // scope before the action too. Don't infer scopes from bracketed examples.
    const label = clause.match(/^\s*[-*]?\s*([^:]+):/u);
    if (label) return namedScopes(label[1]);
    if (/\b(?:dialogue|narration)\b|대사|서술|나레이션/iu.test(clause)) {
        return namedScopes(clause).filter(kind => kind === 'dialogue' || kind === 'narration');
    }
    if (/(?:안의|안에|사이|속|구간|만|에는|은|는).*(?:병기|원문|영어|한국어)/u.test(clause)) return namedScopes(clause);
    // A named emphasis/code source object can follow the verb too.
    return namedScopes(clause).filter(kind => ['italic', 'bold', 'code', 'fenced'].includes(kind));
}
const wholeSource = /\b(?:all|every|entire|whole)\s+(?:source\s+)?(?:text|sentences?|paragraphs?|message|content)\b|(?:모든|전체)\s*(?:문장|본문|텍스트|글|내용)/iu;
const outsideScope = /\b(?:outside|unmarked|everything\s+else|other\s+text|remaining\s+text)\b|나머지|그\s*밖|기호\s*밖|구간\s*밖/iu;
const negativeScope = /\b(?:except\b|excluding\b|no\s+bilingual|(?:do\s+not|don't|never|avoid|disable|without)[^.;]*bilingual|korean(?:\s+translation)?\s+only|only\s+korean)\b|(?:한국어|한글)(?:로)?\s*만|병기[^.;]*(?:하지|금지|말고|없이)/iu;
function affirmativeScope(clause) {
    if (hasBilingualInstructionExclusion(clause)) return false;
    return bilingualPromptRequestsOutput(clause)
        || (!negativeScope.test(clause) && /(?:한\s*영|영\s*한)?\s*병기\s*(?:해|하라|하되|해주세요|해줘|필수|요청)/u.test(clause))
        || (!negativeScope.test(clause) && /\b(?:translate|output|show|display|render|write)\b[^.;]*\bbilingually\b/iu.test(clause))
        || (!/(?:never|do not|금지|하지)/iu.test(clause)
            && /(?:output|show|display).*both.*English.*(?:and|with).*Korean/iu.test(clause))
        || (!/(?:do not|never|금지|하지\s*마)/iu.test(clause)
            && /(?:copy|keep|preserve|retain)\b.*\b(?:english|source|original)\b.*\b(?:add|append|include)\b.*\bkorean\b/iu.test(clause));
}
export function promptRequestsScope(prompt, kind) {
    if (!scopeKinds.includes(kind)) return false;
    const clauses = String(prompt || '').split(/\r?\n|;|(?<=[.!?])\s+(?=[A-Z가-힣])|\b(?:but|however)\b|하지만|(?=\b(?:except|excluding)\b)|(?<=하되)\s*/iu)
        .map(text => text.trim()).filter(text => text && !isBilingualFormatHeading(text));
    const rules = clauses.map(text => ({ text, scopes: sourceScopes(text),
        outside: outsideScope.test(text), negative: negativeScope.test(text),
        all: wholeSource.test(text), positive: affirmativeScope(text) }));
    const declared = new Set(rules.filter(rule => !rule.negative && !rule.outside && !rule.all)
        .flatMap(rule => rule.scopes));
    const allowed = new Set();
    const denied = new Set();
    for (const rule of rules) {
        if (rule.negative) {
            if (rule.outside) {
                for (const scope of scopeKinds) if (!declared.has(scope)) denied.add(scope);
            } else {
                for (const scope of rule.scopes.length ? rule.scopes : scopeKinds) denied.add(scope);
            }
            continue;
        }
        if (!rule.positive || rule.outside) continue;
        const scopes = rule.all ? scopeKinds : rule.scopes.length ? rule.scopes
            : declared.size ? [...declared] : scopeKinds;
        for (const scope of scopes) allowed.add(scope);
    }
    return allowed.has(kind) && !denied.has(kind);
}
// An already explicit marked/narration-only scope needs no optional AI
// dialogue-intent call. A broad yes/no verdict must not widen that scope.
export function hasExplicitNonDialogueBilingualScope(prompt) {
    return !promptRequestsScope(prompt, 'dialogue')
        && scopeKinds.some(kind => kind !== 'dialogue' && promptRequestsScope(prompt, kind));
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
Preserve Markdown emphasis delimiters, nesting and links. For requested marked-span bilingual output, keep the original marker around both languages, using the user's requested inner separator. Respect the requested language order: English followed by Korean or Korean followed by English. Preserve the exact source English in either order. Do not duplicate whole source paragraphs or metadata entries.
Rows with type=code_content are readable inline-backtick/fenced text, NOT paired-tag interiors. Each row carries code_kind=inline or code_kind=fenced. A single-backtick/inline-code bilingual request applies ONLY to inline rows. Fenced rows require an explicit request for fenced/triple-backtick/code-block bilingual output or an unqualified request for all text. Never extend inline-backtick, italic or square-bracket requests into fenced rows; those characters inside a fence are literal content unless the user explicitly requests formatting there. Their delimiters and executable syntax are stored locally: return inner text only; never add wrapper backticks. Apply GLOBAL/CUSTOM OUTPUT bilingual requests to this natural language only, without applying dialogue-only rules or modifying code syntax.
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
    if (segment?.type === 'code_content') {
        const kind = segment.codeKind === 'fenced' ? 'fenced' : 'code';
        add(source, kind);
        // Code delimiters are stored separately, but literal square brackets
        // remain in the row. A translation inserted before the closing bracket
        // must not make the exact English inner value disappear from review.
        const bracketed = source.match(/^\[([^\[\]\n]+)\]$/u);
        if (bracketed) add(bracketed[1], kind);
    }
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
            const forward = /^\s*(?:[\[（(【]\s*[^\]）)】\n]*[가-힣][^\]）)】\n]*[\]）)】]|[가-힣][^\]\n]*\])/u.test(tail);
            const head = text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);
            // Reverse order: Korean [exact source], or [Korean exact source].
            // Require a closing wrapper immediately after the source and a
            // Korean counterpart inside this line, not a neighbouring paragraph.
            const sharedSquare = /^\]/u.test(tail) && /\[[^\[\]\n]*[가-힣][^\[\]\n]*\s$/u.test(head);
            const reverse = sharedSquare || /^[\]）)】]/u.test(tail)
                && /[가-힣]/u.test(head)
                && (/[가-힣][^\[\]（）()【】\n]*[\[（(【]\s*$/u.test(head)
                    || /[\[（(【][^\[\]（）()【】\n]*[가-힣][^\[\]（）()【】\n]*\s$/u.test(head));
            const before = text[pos - 1] || '';
            const after = text[pos + unit.length] || '';
            const boundary = !(/[\p{L}\p{N}_]/u.test(unit[0]) && /[\p{L}\p{N}_]/u.test(before))
                && !(/[\p{L}\p{N}_]/u.test(unit.at(-1)) && /[\p{L}\p{N}_]/u.test(after));
            if (boundary && (forward || reverse)) masked = masked.slice(0,pos) + ' '.repeat(unit.length) + masked.slice(pos+unit.length);
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
