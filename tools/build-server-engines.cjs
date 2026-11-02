// Build from the SAME index.js functions used in the browser; no translated copy
// of the pipeline is maintained by hand. UI side effects are explicit adapters.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const acorn = require('acorn');
const scope = require('eslint-scope');
const esbuild = require('esbuild');
const verbaOnly = process.argv[2] === '--verba-only';
const roots = process.argv.slice(verbaOnly ? 3 : 2);
if (roots.length !== (verbaOnly ? 1 : 2)) throw Error('Usage: build-server-engines.cjs VERBA_DIRECTORY DEEP_DIRECTORY | --verba-only VERBA_DIRECTORY');
const overrides = {
    settings: 'const settings = structuredClone(snapshot.settings);',
    liveContext: 'function liveContext() { return { ...snapshot.context, ConnectionManagerRequestService: { sendRequest: transport } }; }',
    normalizedCharacterNameLocks: 'function normalizedCharacterNameLocks() { return snapshot.nameLocks || []; }',
    currentCharacterReference: 'function currentCharacterReference() { return { character: snapshot.character || {} }; }',
    profileList: 'function profileList() { return Object.keys(snapshot.profiles || {}).map(id => ({ id, name: id })); }',
    recordProfileAttempt: "function recordProfileAttempt(slot, data) { report({ kind: 'profile', slot, success: data.success, elapsedMs: data.elapsedMs, retry: data.retry, fallback: data.fallback }); }",
    updateServerRetryIndicator: "function updateServerRetryIndicator() { report({ kind: 'retry', requests: [...serverRetryStates.values()].map(({retryCount,maxRetries,delayMs,updatedAt}) => ({retryCount,maxRetries,delayMs,updatedAt})) }); }",
    notify: "function notify(message, type) { report({ kind: 'notice', message, type }); }",
    recordSegmentRecovery: 'function recordSegmentRecovery() { return null; }',
    finishSegmentRecovery: 'function finishSegmentRecovery() {}',
    renderQualityAuditStatus: 'function renderQualityAuditStatus() {}',
    storeDebugDiagnostic: "function storeDebugDiagnostic() { report({ kind: 'diagnostic' }); }",
    createDebugDiagnostic: 'function createDebugDiagnostic(stage) { return { stage }; }',
};
async function build(root, variant) {
    const source = fs.readFileSync(path.join(root,'index.js'),'utf8').replace(/\/\* SERVER_DISPATCH_BEGIN \*\/[\s\S]*?\/\* SERVER_DISPATCH_END \*\//g, '');
    const ast = acorn.parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true});
    const manager = scope.analyze(ast,{ecmaVersion:2024,sourceType:'module',optimistic:true,ignoreEval:true});
    const moduleScope = manager.scopes.find(s=>s.type==='module');
    const definitions = new Map(); const imports = new Map();
    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration') for(const spec of node.specifiers) imports.set(spec.local.name,{node,spec});
        if (node.type === 'FunctionDeclaration') definitions.set(node.id.name,{node,text:source.slice(node.start,node.end)});
        if (node.type === 'VariableDeclaration') for(const decl of node.declarations) if(decl.id.type==='Identifier')
            definitions.set(decl.id.name,{node:decl,text:`${node.kind} ${source.slice(decl.start,decl.end)};`});
    }
    const refs = manager.scopes.flatMap(s=>s.references).filter(r=>!r.init);
    const wanted = new Set();
    function visit(name) {
        if(wanted.has(name)) return; wanted.add(name);
        if(overrides[name] || imports.has(name)) return;
        const def = definitions.get(name); if(!def) throw Error('Missing binding '+name);
        for(const ref of refs) if(ref.identifier.start>=def.node.start && ref.identifier.end<=def.node.end && ref.resolved?.scope===moduleScope) visit(ref.identifier.name);
    }
    for(const name of ['translateOutputText','translateInputText','requestSegments','sendWithRetry','normalizeBilingualMappedTranslation','isPredominantlyKorean','hasForeignText']) visit(name);
    // Explicit adapter dependencies, invisible to the original AST.
    visit('serverRetryStates');
    const importsText=[...wanted].filter(n=>imports.has(n)).map(n=>{
        const {node,spec}=imports.get(n);
        if(!node.source.value.startsWith('./')) throw Error('Browser-only import '+n);
        return `import { ${spec.imported.name}${spec.imported.name===n?'':' as '+n} } from ${JSON.stringify(path.join(root,node.source.value))};`;
    }).join('\n');
    const defs=[...wanted].filter(n=>!imports.has(n)).sort((a,b)=>(definitions.get(a)?.node.start||0)-(definitions.get(b)?.node.start||0))
        .map(n=>overrides[n]||definitions.get(n).text).join('\n\n');
    const entry=`${importsText}\nexport const variant=${JSON.stringify(variant)};\nexport function createEngine(snapshot, transport, report=()=>{}) {\nconst console={log(){},info(){},warn(){},error(){}};\n${defs}\nreturn {output:translateOutputText,input:translateInputText,segments:requestSegments,request:sendWithRetry,normalize:normalizeBilingualMappedTranslation,shouldTranslate:source=>!isPredominantlyKorean(source)&&hasForeignText(source)};\n}\n`;
    const checkAst=acorn.parse(entry,{ecmaVersion:'latest',sourceType:'module',ranges:true});
    const unresolved=scope.analyze(checkAst,{ecmaVersion:2024,sourceType:'module',optimistic:true,ignoreEval:true}).globalScope.through.map(r=>r.identifier.name);
    const globals=new Set('Object Array String Number Boolean Map Set Symbol WeakMap WeakSet Math Date Promise Error TypeError RangeError RegExp JSON Intl AbortController AbortSignal DOMException performance setTimeout clearTimeout setInterval clearInterval Uint8Array TextEncoder TextDecoder structuredClone undefined NaN Infinity parseInt parseFloat isNaN encodeURIComponent decodeURIComponent fetch'.split(' '));
    const forbidden=[...new Set(unresolved)].filter(n=>!globals.has(n));
    if(forbidden.length) throw Error('Unadapted globals: '+forbidden.join(', '));
    const result=await esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'engine-entry.js'},bundle:true,platform:'node',format:'esm',target:'node20',write:false,legalComments:'none'});
    const out=result.outputFiles[0].text;
    for(const destination of roots) {
        fs.mkdirSync(path.join(destination,'server-plugin/engines'),{recursive:true});
        fs.writeFileSync(path.join(destination,'server-plugin/engines',variant+'.mjs'),out);
    }
    const hash=crypto.createHash('sha256').update(out).digest('hex');
    console.log(variant+': '+wanted.size+' original bindings, '+out.length+' chars, '+hash);
    return {hash,version:JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version};
}
(async()=>{
 if (verbaOnly) {
  const root = path.resolve(roots[0]);
  const file = path.join(root,'server-plugin/engines/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file,'utf8'));
  manifest.engines.verba = await build(root,'verba');
  fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
  return;
 }
 const engines={verba:await build(path.resolve(roots[0]),'verba'),'verba-deep':await build(path.resolve(roots[1]),'verba-deep')};
 for(const root of roots) fs.writeFileSync(path.join(root,'server-plugin/engines/manifest.json'),JSON.stringify({protocol:1,engines},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1});

