// Reuse only deterministic presentation cleanup; never fuzzy-match reply text.
// Any extension may remove complete markup blocks after generation. Reconcile
// those deletions structurally instead of naming extension-specific tags.
const normalize=value=>String(value??'').replace(/\r\n/g,'\n').trim();
const VOID_TAGS=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const TOKEN=/<\!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*?)?\/?>/g;

function parseMarkup(value) {
    const source=String(value??'');
    const root={name:'#root',start:0,end:source.length,children:[],path:[]};
    const stack=[root],nodes=[];
    let malformed=false;
    for(const match of source.matchAll(TOKEN)) {
        const raw=match[0];
        if(raw.startsWith('<!--')||raw.startsWith('<!')||raw.startsWith('<?'))continue;
        const parsed=/^<\s*(\/?)\s*([A-Za-z][\w:.-]*)/i.exec(raw);
        if(!parsed)continue;
        const closing=!!parsed[1],name=parsed[2].toLowerCase();
        const selfClosing=/\/\s*>$/.test(raw)||VOID_TAGS.has(name);
        if(closing) {
            const open=stack.at(-1);
            if(!open||open===root||open.name!==name){malformed=true;continue;}
            open.end=match.index+raw.length;
            stack.pop();
            continue;
        }
        const parent=stack.at(-1);
        const node={name,start:match.index,end:selfClosing?match.index+raw.length:null,
            children:[],path:[...parent.path,parent.children.length]};
        parent.children.push(node);
        nodes.push(node);
        if(!selfClosing)stack.push(node);
    }
    if(stack.length!==1)malformed=true;
    return {source,nodes:nodes.filter(node=>Number.isInteger(node.end)&&node.end>node.start),malformed};
}

function deletionPlan(before,after) {
    const source=normalize(before),target=normalize(after);
    if(!source||!target||source===target)return null;
    const parsed=parseMarkup(source);
    if(parsed.malformed||!parsed.nodes.length)return null;
    const starts=new Map();
    for(const node of parsed.nodes){
        const list=starts.get(node.start)||[];
        list.push(node);
        starts.set(node.start,list);
    }
    for(const list of starts.values())list.sort((a,b)=>b.end-a.end);
    const memo=new Map();
    function solve(i,j) {
        const key=i+':'+j;
        if(memo.has(key))return memo.get(key);
        if(i===source.length){const value=j===target.length?[]:null;memo.set(key,value);return value;}
        if(j<target.length&&source[i]===target[j]){
            const kept=solve(i+1,j+1);
            if(kept){memo.set(key,kept);return kept;}
        }
        for(const node of starts.get(i)||[]){
            const tail=solve(node.end,j);
            if(tail){const value=[node,...tail];memo.set(key,value);return value;}
        }
        memo.set(key,null);
        return null;
    }
    const removed=solve(0,0);
    return removed?.length?{parsed,removed}:null;
}

const structureSignature=parsed=>parsed.nodes.map(node=>`${node.path.join('.')}:${node.name}`);
function stripSpans(source,ranges) {
    const spans=[];
    for(const [start,end] of ranges.sort((a,b)=>a[0]-b[0])){
        const last=spans.at(-1);
        if(last&&start<=last[1])last[1]=Math.max(last[1],end);
        else spans.push([start,end]);
    }
    let text='',cursor=0;
    for(const [start,end] of spans){text+=source.slice(cursor,start);cursor=end;}
    text+=source.slice(cursor);
    return {text,spans};
}
function reconcileMarkup(before,after,translation) {
    const plan=deletionPlan(before,after);
    if(!plan)return null;
    const translated=parseMarkup(translation);
    if(translated.malformed)return null;
    const sourceSignature=structureSignature(plan.parsed);
    const translatedSignature=structureSignature(translated);
    if(sourceSignature.length!==translatedSignature.length
        ||sourceSignature.some((value,index)=>value!==translatedSignature[index]))return null;
    const byPath=new Map(translated.nodes.map(node=>[node.path.join('.'),node]));
    const ranges=[];
    for(const removed of plan.removed){
        const match=byPath.get(removed.path.join('.'));
        if(!match||match.name!==removed.name)return null;
        ranges.push([match.start,match.end]);
    }
    const cleaned=stripSpans(String(translation??''),ranges);
    return cleaned.spans.length&&cleaned.text.trim()?cleaned:null;
}

export function hasVerifiedSceneReport() {
    // Legacy import kept for older entrypoints. Generic reconciliation no longer
    // waits for one named producer or one named report tag.
    return false;
}
export function describeSourceChange(before,after) {
    before=String(before??'');after=String(after??'');
    let relation='text-changed',prefix=0,suffix=0;
    if(before===after)relation='same';
    else if(normalize(before)===normalize(after))relation='edge-whitespace-or-line-endings';
    else if(deletionPlan(before,after))relation='closed-markup-blocks-removed';
    else if(after&&before.startsWith(after))relation='tail-removed';
    else if(after&&before.endsWith(after))relation='head-removed';
    while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
    while(suffix<Math.min(before.length,after.length)-prefix&&before.at(-suffix-1)===after.at(-suffix-1))suffix++;
    return {relation,beforeLength:before.length,afterLength:after.length,commonPrefixLength:prefix,commonSuffixLength:suffix};
}
export function compatibleCompletedSource(before,after) {
    return ['same','edge-whitespace-or-line-endings','closed-markup-blocks-removed']
        .includes(describeSourceChange(before,after).relation);
}
export function reconcileCompletedResult(before,after,result) {
    const relation=describeSourceChange(before,after).relation;
    if(['same','edge-whitespace-or-line-endings'].includes(relation))return result;
    if(relation!=='closed-markup-blocks-removed'||typeof result?.translation!=='string')return null;
    const cleaned=reconcileMarkup(before,after,result.translation);
    if(!cleaned)return null;
    const translation=cleaned.text.trimEnd();
    const shift=position=>position-cleaned.spans.reduce((n,[start,end])=>n+(end<=position?end-start:0),0);
    const sourceMap=(Array.isArray(result.sourceMap)?result.sourceMap:[]).flatMap(row=>{
        if(!Number.isInteger(row.start)||!Number.isInteger(row.end)||row.start<0||row.end<=row.start||row.end>result.translation.length)return [];
        if(cleaned.spans.some(([start,end])=>row.start<end&&row.end>start))return [];
        const start=shift(row.start),end=shift(row.end);
        if(end>translation.length)return [];
        return [{...row,start,end}];
    });
    return {...result,translation,sourceMap};
}
