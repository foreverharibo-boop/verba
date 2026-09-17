import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const between=(a,b)=>{
    const start=index.indexOf(a),end=index.indexOf(b,start);
    assert.ok(start>=0 && end>start,a);
    return index.slice(start,end);
};
const defs=between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =');
const render=Function('dev','escapeHtml',defs+`
    const settings=structuredClone(DEFAULT_SETTINGS);settings.developerMode=dev;
    const EXTENSION_VERSION='0.5.71',lastQualityAuditSummary='',lastDebugDiagnostic=null;
    const outputTiming={latest:()=>null},outputTimingText=()=>'',normalizedPromptPresets=()=>[],normalizedPromptPresetBackups=()=>[],promptPresetSelectMarkup=()=>'',baseTranslationEditorMarkup=()=>'';
`+between('function tuningChoiceMarkup(', 'function normalizeTranslationRuleOrder(')
 +between('function developerFlavorSettingsMarkup(', 'function syncDeveloperQualityControls(')
 +'const panel={};'+between('    panel.innerHTML = `', '    host.append(panel);')
 +'return panel.innerHTML;');
const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const panels=[false,true].map(dev=>render(dev,escapeHtml));
for(const html of panels){
    assert.match(html,/id="verba-prompt-conflict-settings"[\s\S]*?<\/details>\s*<details id="verba-developer-output-split-lab"/);
    assert.match(html,/id="verba-expression-detail"[\s\S]*?<\/details>\s*<details id="verba-developer-relationship-lab"/);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,'No duplicated IDs in complete settings markup');
    assert.equal(ids.filter(x=>x==='verba-developer-output-split-lab').length,1);
    assert.equal(ids.filter(x=>x==='verba-developer-relationship-lab').length,1);
}
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.name,'verba');assert.equal(manifest.display_name,'베르바');
assert.equal(manifest.version,'0.5.71');assert.ok(index.includes("const EXTENSION_VERSION = '"+manifest.version+"';"));
if(process.argv.includes('--html')) console.log(JSON.stringify(panels));
else console.log('PASS: complete settings markup, exact adjacent placement, unique IDs and version; developer ON/OFF.');
