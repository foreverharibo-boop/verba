// Markdown containers are formatting, not a blanket translation exemption.
// Machine syntax is withheld locally; only readable text reaches the model.
const PROGRAM_LANGUAGES = /^(?:js|javascript|ts|typescript|jsx|tsx|css|scss|less|json|jsonc|python|py|sh|bash|shell|powershell|ps1|sql|java|c|cpp|csharp|cs|go|rust|ruby|rb|php|yaml|yml|toml|ini)$/i;
const MACHINE_VALUE = /^(?:[\w]+[_./\\][\w./\\-]*|[a-z]+[A-Z][\w]*|https?:\/\/\S+|#[\da-f]{3,8}|\d+(?:\.\d+)?(?:px|em|rem|%|s|ms)?|true|false|null|undefined)$/;
const CODE_LINE = /^\s*(?:(?:(?:const|let|var)\s+[\w$]+\s*=|(?:function|def|class)\s+[\w$]+\s*[(:{]|(?:if|while|for|switch|catch)\s*\(|(?:import|from)\s+[^\n]*\b(?:from|import)\b)|[\w.$]+\s*(?:\([^\n]*\)\s*[;{]?\s*$|(?:[+*/-]?=|=>))|[{}\[\]]\s*[,;]?\s*$|["'][^"']+["']\s*:|[.#][\w-]+\s*\{|[\w-]+\s*:\s*[^\n]*;)/;

function readable(value) {
    const text = String(value).trim();
    return /\p{L}/u.test(text) && !MACHINE_VALUE.test(text);
}

function escaped(text, index) {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count++;
    return count % 2 === 1;
}

// Opening/closing runs must match; longer fenced closers are valid Markdown.
function nextMarkdown(text, from) {
    const runs = /`+|~{3,}/g;
    runs.lastIndex = from;
    let match;
    while ((match = runs.exec(text))) {
        const start = match.index;
        if (escaped(text, start)) continue;
        const run = match[0];
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const fenced = run.length >= 3 && /^ {0,3}$/.test(text.slice(lineStart, start));
        if (fenced) {
            const lineEnd = text.indexOf('\n', runs.lastIndex);
            if (lineEnd < 0) continue;
            const info = text.slice(runs.lastIndex, lineEnd).trim();
            if (run[0] === '`' && info.includes('`')) continue;
            const close = new RegExp('^ {0,3}' + (run[0] === '`' ? '`' : '~') + '{' + run.length + ',}[ \\t]*(?=\\r?$)', 'gm');
            close.lastIndex = lineEnd + 1;
            const end = close.exec(text);
            return {
                start, end: end ? close.lastIndex : text.length,
                open: text.slice(start, lineEnd + 1),
                body: text.slice(lineEnd + 1, end ? end.index : text.length),
                close: end?.[0] || '', language: info.split(/\s/)[0],
            };
        }
        if (run[0] !== '`') continue;
        const closing = /`+/g;
        closing.lastIndex = runs.lastIndex;
        let end;
        while ((end = closing.exec(text))) {
            if (end[0].length !== run.length) continue;
            return { start, end: closing.lastIndex, open: run, body: text.slice(runs.lastIndex, end.index), close: run, language: '' };
        }
    }
    return null;
}

export function replaceProtectedSource(value, opaquePattern, replacement, { opaqueCode = false } = {}) {
    const text = String(value || '');
    const protect = (raw, meta) => typeof replacement === 'function' ? replacement(raw, meta) : replacement;
    const opaque = new RegExp(opaquePattern.source, opaquePattern.flags);
    const ordinary = body => body.replace(opaquePattern, raw => protect(raw));
    let codeKind = 'inline';
    const boundary = (raw, direction, quote = '') => protect(raw, { codeBoundary: direction, codeQuote: quote, codeKind });
    const prose = (body, quote = '') => {
        // Preserve existing escapes verbatim; introduced quotes are escaped at assembly.
        if (quote) return body.split(/(\\(?:u[\da-fA-F]{4}|x[\da-fA-F]{2}|[^]))/u)
            .map((part, i) => i % 2 ? protect(part) : ordinary(part)).join('');
        return ordinary(body);
    };
    const program = (body, language) => {
        const json = /^(?:json|jsonc)$/i.test(language) || /^\s*[{[]/.test(body);
        const conventionalStrings = json || /^(?:|js|javascript|ts|typescript|css|scss|less|python|py|java|c|cpp|csharp|cs|go|rust|ruby|rb|php)$/i.test(language);
        const syntax = /"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\/(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\])*\]|[^/\\\r\n])+\/[a-z]*|#[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g;
        let result = '', cursor = 0, match;
        while ((match = syntax.exec(body))) {
            result += protect(body.slice(cursor, match.index));
            const raw = match[0], quote = raw[0];
            const stringLiteral = (quote === '"' || quote === "'") && !raw.startsWith(quote.repeat(3));
            const comment = raw.startsWith('//') || raw.startsWith('/*') || raw.startsWith('#');
            const commentAllowed = comment && (!json || /jsonc/i.test(language))
                && (quote !== '#' || /^(?:py|python|sh|bash|shell|ruby|rb|yaml|yml|toml|ini|powershell|ps1)$/i.test(language));
            const isKey = !comment && /^\s*:/.test(body.slice(syntax.lastIndex));
            const inner = comment ? raw.slice(raw.startsWith('#') ? 1 : 2, raw.startsWith('/*') ? -2 : undefined) : raw.slice(1, -1);
            // Strings with interpolation or unknown escape semantics stay opaque.
            if ((stringLiteral && conventionalStrings && !/[\w$]/.test(body[match.index - 1] || '') && !(quote === "'" && /^(?:java|c|cpp|csharp|cs|go|rust)$/i.test(language)) && !isKey && !/[`]|\$\{|%[\w(]|\{[^}]*\}/.test(inner) && readable(inner) && (json || /\s|[^\x00-\x7F]/.test(inner) || /^[A-Z][a-z]/.test(inner))) || (commentAllowed && readable(inner))) {
                const open = comment ? raw.slice(0, raw.startsWith('#') ? 1 : 2) : quote;
                const close = comment ? (raw.startsWith('/*') ? '*/' : '') : quote;
                result += boundary(open, 'open', comment ? '' : quote) + prose(inner, comment ? '' : quote) + boundary(close, 'close');
            } else result += protect(raw);
            cursor = syntax.lastIndex;
        }
        return result + protect(body.slice(cursor));
    };
    let result = '', cursor = 0;
    while (cursor < text.length) {
        opaque.lastIndex = cursor;
        const opaqueMatch = opaque.exec(text);
        const code = nextMarkdown(text, cursor);
        if (opaqueMatch && (!code || opaqueMatch.index <= code.start)) {
            result += text.slice(cursor, opaqueMatch.index) + protect(opaqueMatch[0]);
            cursor = opaque.lastIndex;
        } else if (code) {
            result += text.slice(cursor, code.start);
            if (opaqueCode) {
                result += protect(text.slice(code.start, code.end));
                cursor = code.end;
                continue;
            }
            codeKind = code.open.includes('\n') ? 'fenced' : 'inline';
            const markup = /^(?:html|xml|svg)$/i.test(code.language) || /^\s*</.test(code.body);
            const isProgram = !markup && (PROGRAM_LANGUAGES.test(code.language) || code.body.split(/\r?\n/).some(line => CODE_LINE.test(line)));
            const machineOnly = !code.body.includes('\n') && MACHINE_VALUE.test(code.body.trim());
            if (machineOnly) result += protect(text.slice(code.start, code.end));
            else if (isProgram) result += protect(code.open) + program(code.body, code.language) + protect(code.close);
            else result += boundary(code.open, 'open') + prose(code.body) + boundary(code.close, 'close');
            cursor = code.end;
        } else {
            result += text.slice(cursor);
            break;
        }
    }
    return result;
}

// Split at code boundaries BEFORE quotation-based dialogue detection. A string
// value or status panel must not acquire character dialogue/bilingual styling.
export function codeAwareRegions(text, tokens, taggedRanges) {
    const codeRanges = [], stack = [];
    for (const token of tokens) {
        if (!token.codeBoundary) continue;
        const start = text.indexOf(token.token);
        if (start < 0) continue;
        if (token.codeBoundary === 'open') stack.push({ start: start + token.token.length, quote: token.codeQuote || '', kind: token.codeKind || 'inline' });
        else {
            const open = stack.pop();
            if (open) codeRanges.push({ ...open, end: start });
        }
    }
    const points = [...new Set([0, text.length, ...taggedRanges.flatMap(r => [r.start, r.end]), ...codeRanges.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);
    return points.slice(0, -1).map((start, i) => {
        const end = points[i + 1];
        const tag = taggedRanges.find(r => r.start <= start && r.end >= end);
        const code = codeRanges.find(r => r.start <= start && r.end >= end);
        return { text: text.slice(start, end), insideTaggedContent: !!tag, tagContext: tag?.tags || [], insideCode: !!code, codeQuote: code?.quote || '', codeKind: code?.kind || '' };
    }).filter(r => r.text);
}

export function escapeCodeTranslation(text, quote) {
    if (!quote) return text;
    return text.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), '\\' + quote);
}
