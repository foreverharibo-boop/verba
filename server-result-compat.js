// Reuse only deterministic presentation cleanup; never fuzzy-match reply text.
// Ttotto machine reports are removed only if they are complete JSON report blocks.
const stateMarker=/(?:<|&lt;)\s*\/?\s*(?:archive|charm)[-_]?now\b/i;
const normalize=value=>String(value??'').replace(/\r\n/g,'\n').trim();
function stripStateBlocks(value) {
    const source=String(value??''), stack=[], spans=[];
    const tokens=/(?:<|&lt;)\s*(\/?)\s*((?:archive|charm)[-_]?now)\s*(?:>|&gt;)/gi;
    for(const token of source.matchAll(tokens)) {
        const name=token[2].toLowerCase();
        if(!token[1]){stack.push({name,start:token.index});continue;}
        const index=stack.findLastIndex(open=>open.name===name);
        if(index<0)continue;
        spans.push([stack[index].start,token.index+token[0].length]);stack.splice(index);
    }
    const merged=[];
    for(const span of spans.sort((a,b)=>a[0]-b[0])) {
        const last=merged.at(-1);
        if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push(span);
    }
    let text='',offset=0;
    for(const [start,end] of merged){text+=source.slice(offset,start);offset=end;}
    text+=source.slice(offset);
    return {text,spans:merged};
}
const KNOWN_SCENE_REPORT = /<(scene_state|sfw_scene)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu;
function stripSpans(source, ranges) {
    const spans = [];
    for (const [start, end] of ranges.sort((a,b) => a[0]-b[0])) {
        const last=spans.at(-1);
        if(last && start<=last[1]) last[1]=Math.max(last[1],end);
        else spans.push([start,end]);
    }
    let text='', cursor=0;
    for(const [start,end] of spans){ text+=source.slice(cursor,start); cursor=end; }
    text+=source.slice(cursor);
    return {text,spans};
}
function stripVerifiedSceneReports(value) {
    const source=String(value??''), spans=[];
    for(const match of source.matchAll(KNOWN_SCENE_REPORT)){
        let parsed;
        try{parsed=JSON.parse(match[2].trim());}catch{continue;}
        if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))continue;
        if(!('scene' in parsed || 'characters' in parsed || 'location' in parsed
            || 'heat' in parsed || 'intensity' in parsed || 'stage' in parsed
            || 'acts' in parsed || 'important_objects' in parsed))continue;
        spans.push([match.index,match.index+match[0].length]);
    }
    return stripSpans(source,spans);
}
function stripCombinedBlocks(value) {
    const source=String(value??'');
    const states=stripStateBlocks(source);
    const scenes=stripVerifiedSceneReports(source);
    return stripSpans(source,[...states.spans,...scenes.spans]);
}
export function describeSourceChange(before,after) {
    before=String(before??'');after=String(after??'');
    let relation='text-changed',prefix=0,suffix=0;
    if(before===after)relation='same';
    else if(normalize(before)===normalize(after))relation='edge-whitespace-or-line-endings';
    else {
        const cleaned=stripStateBlocks(before);
        const scene=stripVerifiedSceneReports(before);
        const combined=stripCombinedBlocks(before);
        if(cleaned.spans.length&&!stateMarker.test(cleaned.text)&&!stateMarker.test(after)
            &&normalize(cleaned.text)===normalize(after))relation='closed-state-blocks-removed';
        else if(scene.spans.length&&normalize(scene.text)===normalize(after))relation='closed-scene-report-removed';
        else if(cleaned.spans.length&&scene.spans.length
            &&normalize(combined.text)===normalize(after))relation='closed-known-reports-removed';
        else if(after&&before.startsWith(after))relation='tail-removed';
        else if(after&&before.endsWith(after))relation='head-removed';
    }
    while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
    while(suffix<Math.min(before.length,after.length)-prefix&&before.at(-suffix-1)===after.at(-suffix-1))suffix++;
    return {relation,beforeLength:before.length,afterLength:after.length,commonPrefixLength:prefix,commonSuffixLength:suffix};
}
export function compatibleCompletedSource(before,after) {
    return ['same','edge-whitespace-or-line-endings','closed-state-blocks-removed',
        'closed-scene-report-removed','closed-known-reports-removed'].includes(describeSourceChange(before,after).relation);
}
export function reconcileCompletedResult(before,after,result) {
    const relation=describeSourceChange(before,after).relation;
    if(['same','edge-whitespace-or-line-endings'].includes(relation))return result;
    if(typeof result?.translation!=='string')return null;
    const cleaned=relation==='closed-state-blocks-removed'?stripStateBlocks(result.translation)
        :relation==='closed-scene-report-removed'?stripVerifiedSceneReports(result.translation)
        :relation==='closed-known-reports-removed'?stripCombinedBlocks(result.translation):null;
    // When a model damaged/omitted a report wrapper, do not guess how to
    // remove its text. Ask for a translation of the exact final source instead.
    if(!cleaned?.spans.length)return null;
    // A missing closing tag is not permission to cut the remaining answer.
    if(stateMarker.test(cleaned.text)||!cleaned.text.trim())return null;
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
