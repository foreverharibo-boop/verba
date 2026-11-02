// Output-only deterministic guard. Never delete arbitrary Latin text: only an
// exact source copy paired with a Korean counterpart can be removed.
const pairs = [['[',']'],['(',')'],['（','）'],['【','】']];
const quotes = [['"','"'],['“','”'],['‘','’'],["'","'"],['「','」'],['『','』']];
const token = /@@VERBA_(?:[A-Z]+_)*\d+@@/gu;
const opaque = text => (text.match(token) || []).filter(x => !x.includes('_NAME_')).sort().join('|');
const strip = value => String(value).trim();
function unwrap(text, open, close) {
    if (!text.startsWith(open) || !text.endsWith(close)) return null;
    if (open !== close && pairs.some(p => p[0] === open)) {
        let depth = 0;
        for (let i=0;i<text.length;i++) {
            if(text[i] === open) depth++;
            if(text[i] === close && --depth === 0 && i !== text.length-1) return null;
        }
        if(depth) return null;
    }
    return text.slice(open.length,-close.length).trim();
}
function bare(text) {
    let value=strip(text);
    for(let n=0;n<4;n++) {
        const p=[['**','**'],['__','__'],['*','*'],['_','_'],...quotes,...pairs].find(([a,b])=>unwrap(value,a,b)!==null);
        if(!p) break;
        value=unwrap(value,...p);
    }
    return value;
}
function sourceUnits(source, names) {
    const values=[source,...source.split(/\r?\n/u)];
    for(const m of source.matchAll(/(\*\*|__|\*|_)([^\n]+?)\1|\[([^\]\n]+)\](?!\()/gu)) values.push(m[2]??m[3]);
    return [...new Set(values.flatMap(v=>[strip(v),bare(v)]).flatMap(v=>[v,names.reduce((s,n)=>s.split(n.token).join(n.original||n.source||n.value||''),v)]))]
        .filter(v=>v && /[A-Za-z]/u.test(v.replace(token,'')) && !/[가-힣<>`]|\{\{|https?:\/\//u.test(v) && !opaque(v))
        .sort((a,b)=>b.length-a.length);
}
function korean(value,names) {
    return /[가-힣]/u.test(names.reduce((s,n)=>s.split(n.token).join(n.value||''),value).replace(token,''));
}
function reduceBody(value, units, names) {
    const text=strip(value);
    for(const src of units) {
        if(text.startsWith(src)) {
            const tail=text.slice(src.length);
            // A separate Korean line is also a whole-unit parallel translation.
            if (/^[ \t]*\r?\n/u.test(tail) && korean(tail,names) && !tail.includes(src)) return tail.trim();
            if(!/^\s*[[(（【]/u.test(tail)) continue;
            for(const p of pairs) {
                const ko=unwrap(tail.trim(),...p);
                if(ko!==null && korean(ko,names) && !ko.includes(src)) return ko;
            }
        }
        if(text.endsWith(src)) {
            const head=text.slice(0,-src.length);
            if(/\r?\n[ \t]*$/u.test(head) && korean(head,names) && !head.includes(src)) return head.trim();
        }
        for(const [a,b] of pairs) {
            const suffix=a+src+b;
            if(text.endsWith(suffix)) {
                const ko=text.slice(0,-suffix.length).trim();
                if(ko && korean(ko,names) && !ko.includes(src)) return ko;
            }
        }
    }
    return text;
}
function reduceWrapped(value,units,names,depth=0) {
    if(depth>4) return value;
    const text=strip(value);
    const direct=reduceBody(text,units,names);
    if(direct!==text) return value.replace(text,direct);
    for(const [a,b] of [['**','**'],['__','__'],['*','*'],['_','_'],...quotes,...pairs]) {
        const inner=unwrap(text,a,b);
        if(inner===null) continue;
        let reduced=reduceWrapped(inner,units,names,depth+1);
        // Square-bracket RP uses one shared bracket pair, not nested brackets.
        if(a==='[' && reduced===inner) for(const src of units) {
            if(inner.startsWith(src+' ') && korean(inner.slice(src.length),names)) { reduced=inner.slice(src.length).trim();break; }
            if(inner.endsWith(' '+src) && korean(inner.slice(0,-src.length),names)) { reduced=inner.slice(0,-src.length).trim();break; }
        }
        if(reduced!==inner) return value.replace(text,a+reduced+b);
    }
    return value;
}
export function enforceMadKoreanOnly(segmented, translations, settings={}) {
    const stats={changedRows:0};
    if(settings.developerMadKoreanOutputEnabled!==true) return stats;
    const names=segmented.nameTokens||[];
    for(const segment of segmented.segments||[]) {
        const current=translations.get(segment.id);
        if(typeof current!=='string') continue;
        const units=sourceUnits(String(segment.text||''),names);
        let next=reduceWrapped(current,units,names);
        next=next.split(/(\r?\n)/u).map(line=>reduceWrapped(line,units,names)).join('');
        // Inline emphasis can occur within a larger narration segment. Match
        // only emphasis, never HTML, links, executable code or their attributes.
        next=next.replace(/(\*\*|__|\*|_)([^\n]+?)\1/gu,(whole,mark,body)=>mark+reduceBody(body,units,names)+mark);
        if(next!==current) {
            const source=strip(segment.text||'');
            const wrapper=[['**','**'],['__','__'],['*','*'],['_','_'],...quotes,['[',']']].find(p=>unwrap(source,...p)!==null);
            if(wrapper && unwrap(strip(next),...wrapper)===null) next=wrapper[0]+next.trim()+wrapper[1];
        }
        if(next!==current && next.trim() && opaque(next)===opaque(current)) {
            translations.set(segment.id,next);stats.changedRows++;
        }
    }
    return stats;
}
