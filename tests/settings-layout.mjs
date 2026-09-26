import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const style=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
const between=(a,b)=>{
    const start=index.indexOf(a),end=index.indexOf(b,start);
    assert.ok(start>=0 && end>start,a);
    return index.slice(start,end);
};
const defs=between('const RELATION_TEMPERATURE_OPTIONS','const baseContext =');
const render=Function('dev','escapeHtml',defs+`
    const settings=structuredClone(DEFAULT_SETTINGS);settings.developerMode=dev;
    const EXTENSION_VERSION='0.6.8',lastQualityAuditSummary='',lastDebugDiagnostic=null;
    const outputTiming={latest:()=>null},outputTimingText=()=>'',normalizedPromptPresets=()=>[],normalizedPromptPresetBackups=()=>[],promptPresetSelectMarkup=()=>'',baseTranslationEditorMarkup=()=>'';
    const normalizedProfileRaceTimeoutMinutes=()=>5,normalizedProfileRaceStaggerSeconds=()=>35,normalizedProfileFailureTimeoutSeconds=()=>120,normalizedProfileFailureTimeoutMinutes=()=>2;
`+between('function tuningChoiceMarkup(', 'function normalizeTranslationRuleOrder(')
 +between('function developerFlavorSettingsMarkup(', 'function syncDeveloperQualityControls(')
 +between('function customTranslatorInstructionPlaceholder(', 'function injectSettingsPanel(')
 +'const panel={};'+between('    panel.innerHTML = `', '    host.append(panel);')
 +'return panel.innerHTML;');
const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const panels=[false,true].map(dev=>render(dev,escapeHtml));
for(const html of panels){
    assert.match(html,/<div><b>베르바<\/b><\/div>/);
    assert.match(html,/id="verba-settings-visibility"[\s\S]*?표시할 기능 선택/);
    assert.match(html,/id="verba-translate-tagged-content" checked/);
    assert.match(html,/id="verba-selection-candidates"[\s\S]*?id="verba-translate-tagged-content"[\s\S]*?id="verba-selection-menu-settings"/);
    assert.match(html,/id="verba-chuseok-galbwae-all"/);
    assert.match(html,/id="verba-chuseok-galbwae-dialogue-inner"/);
    assert.doesNotMatch(html,/id="verba-chuseok-galbwae-(?:all|dialogue-inner)" checked/);
    assert.doesNotMatch(html,/<small>v\$?\{?EXTENSION_VERSION|<small>v0\.5\./);
    assert.match(html,/id="verba-prompt-conflict-settings"[\s\S]*?<\/details>\s*<details id="verba-developer-output-split-lab"/);
    assert.match(html,/id="verba-expression-detail"[\s\S]*?<\/details>\s*<details id="verba-developer-relationship-lab"/);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,'No duplicated IDs in complete settings markup');
    assert.equal(ids.filter(x=>x==='verba-developer-output-split-lab').length,1);
    assert.equal(ids.filter(x=>x==='verba-developer-relationship-lab').length,1);
}
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.name,'verba');assert.equal(manifest.display_name,'베르바');
assert.equal(manifest.version,'0.6.8');assert.ok(index.includes("const EXTENSION_VERSION = '"+manifest.version+"';"));
assert.match(style,/#verba-settings > \.inline-drawer > \.inline-drawer-content\s*\{\s*font-size: \.86em;/);
assert.doesNotMatch(style,/#verba-settings\s*\{\s*font-size:/);
assert.doesNotMatch(style,/#verba-settings \.verba-drawer-header\s*\{[^}]*min-height:/s);
if(process.argv.includes('--html')) console.log(JSON.stringify(panels));
else console.log('PASS: complete settings markup, default outer drawer sizing, hidden visible version, compact inner UI, exact adjacent placement, unique IDs and version; developer ON/OFF.');
