import { activeCustomOutput, promptRequestsScope, bilingualScopeRequested } from './output-format.js';
import { bilingualReviewTargets, validBilingualReplacement } from './bilingual-review.js';
import { hashText } from './core.js';

const KINDS = ['dialogue','narration','italic','bold','bracket','code','fenced'];
const TYPES = ['dialogue_candidate','narration','tagged_content','code_content'];
const MODES = ['developerMode','developerMadKoreanOutputEnabled','developerHongjinFlavorEnabled','developerMinimalPromptEnabled','developerDeepseekKoreanEnabled','developerCompressedPromptEnabled','chuseokGalbwaeEnabled'];
const REASONS = ['scope-not-requested','tag-excluded','opaque-content','target-limit','wrapper-mismatch','span-alignment','nested-markers','no-english-or-empty','eligible','no-marked-target'];
const n = v => Number.isFinite(v) ? Math.min(10000000,Math.max(0,Math.floor(v))) : 0;
const counts = (keys, value) => Object.fromEntries(keys.map(k=>[k,n(value?.[k])]));
const scopes = v => Object.fromEntries(KINDS.map(k=>[k,v?.[k]===true]));
export function bilingualSettingsDiagnostic(settings = {}) {
    const slot = (text, enabled) => ({ enabled, length:String(text || '').length,
        requested: Object.fromEntries(KINDS.map(k=>[k,promptRequestsScope(text,k)])) });
    const effective = Object.fromEntries(KINDS.map(k=>[k,bilingualScopeRequested(settings,k)]));
    const blocker = settings.developerMadKoreanOutputEnabled === true ? 'mad-exclusive'
        : settings.developerMode === true && (['all','dialogueInner'].includes(settings.chuseokGalbwaeScope)
            || settings.chuseokGalbwaeEnabled === true && settings.chuseokGalbwaeScope !== 'off') ? 'galbwae-exclusive' : 'none';
    return { slots:{global:slot(settings.globalPrompt,settings.globalPromptEnabled!==false),
        allDialogue:slot(settings.allDialoguePrompt,settings.allDialoguePromptEnabled!==false),
        customOutput:slot(activeCustomOutput(settings),!!activeCustomOutput(settings))}, effectiveScopes:effective, blocker,
        modes:Object.fromEntries(MODES.map(k=>[k,settings[k]===true])) };
}
export function sanitizeBilingualSettings(value) {
    if (!value || typeof value!=='object') return null;
    return {slots:Object.fromEntries(['global','allDialogue','customOutput'].map(k=>[k,{
        enabled:value.slots?.[k]?.enabled===true,length:n(value.slots?.[k]?.length),requested:scopes(value.slots?.[k]?.requested)}])),
        effectiveScopes:scopes(value.effectiveScopes),blocker:['none','mad-exclusive','galbwae-exclusive'].includes(value.blocker)?value.blocker:'none',
        modes:Object.fromEntries(MODES.map(k=>[k,value.modes?.[k]===true]))};
}
export function bilingualStageDiagnostic(segmented, values, settings, previous) {
    const found=bilingualReviewTargets(segmented,values,settings), before=previous?bilingualReviewTargets(segmented,previous,settings):null;
    const names=segmented.nameTokens || [];
    const restore=text=>names.reduce((s,x)=>s.split(x.token).join(String(x.original || x.source || x.value || '')),String(text));
    const exact=(t,map)=>restore(map.get(t.segmentId)||'').includes(t.source);
    const lost=before?before.targets.filter(t=>exact(t,previous)&&!exact(t,values)):[];
    const rows=(segmented.segments||[]).map((s,index)=>{
        const targets=found.targets.filter(t=>t.segmentId===s.id);
        const reason=found.decisions?.find(d=>d.segmentId===s.id)?.reason || 'no-marked-target';
        return {index,type:s.type,targets:targets.length,reason,exactSourcePresent:targets.length>0&&targets.every(t=>exact(t,values)),
            lostExpectedSource:lost.some(t=>t.segmentId===s.id)};
    });
    rows.sort((a,b)=>Number(b.lostExpectedSource)-Number(a.lostExpectedSource)||Number(b.targets>0)-Number(a.targets>0)||a.index-b.index);
    return {eligibleTargets:found.targets.length,validPairs:found.targets.filter(t=>validBilingualReplacement(t,t.current)).length,
        exactSourceTargets:found.targets.filter(t=>exact(t,values)).length,lostExpectedSourceTargets:lost.length,
        reasons:Object.fromEntries(REASONS.map(k=>[k,(found.decisions||[]).filter(d=>d.reason===k).length])),
        rows:rows.slice(0,32),rowsOmitted:Math.max(0,rows.length-32)};
}
export function sanitizeBilingualStage(value) {
    if(!value || typeof value!=='object')return null;
    return {...counts(['eligibleTargets','validPairs','exactSourceTargets','lostExpectedSourceTargets','rowsOmitted'],value),reasons:counts(REASONS,value.reasons),
        rows:(Array.isArray(value.rows)?value.rows:[]).slice(0,32).map(r=>({index:n(r.index),type:TYPES.includes(r.type)?r.type:'unknown',
            targets:n(r.targets),reason:REASONS.includes(r.reason)?r.reason:'no-marked-target',exactSourcePresent:r.exactSourcePresent===true,lostExpectedSource:r.lostExpectedSource===true}))};
}
export function sanitizeOutputBinding(value) {
    if(!value || typeof value!=='object')return null;
    return {jobKey:/^[a-f0-9]{32}$/.test(value.jobKey||'')?value.jobKey:null,
        sourceHash:/^[a-z0-9]{1,16}$/.test(value.sourceHash||'')?value.sourceHash:null,sourceLength:n(value.sourceLength),
        messageId:Number.isInteger(value.messageId)&&value.messageId>=0?value.messageId:null,
        swipeId:Number.isInteger(value.swipeId)&&value.swipeId>=0?value.swipeId:null,
        route:['browser','server-engine','server-new','server-reused'].includes(value.route)?value.route:'browser'};
}
export function outputBinding(source, options={}, route='browser', jobKey=null) {
    return sanitizeOutputBinding({sourceHash:hashText(source),sourceLength:String(source||'').length,
        messageId:options.diagnosticMessageId,swipeId:options.diagnosticSwipeId,route,jobKey});
}
export function segmentTypeDiagnostic(segmented) {
    return Object.fromEntries(TYPES.map(type=>[type,(segmented.segments||[]).filter(s=>s.type===type).length]));
}
