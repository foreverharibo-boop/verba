import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildOutputPrompt,
    buildSelectionPrompt,
    segmentSource,
} from '../core.js';

const source = `He waited.\n\n"Run now!"\n\n<Info_panel>[Weather: Sunny]</Info_panel>\n\n<Inner_Info><small>🧠 Hong-jin: This is insane.</small></Inner_Info>`;
const segmented = segmentSource(source);
const info = segmented.segments.find(row => row.text.includes('Weather'));
const inner = segmented.segments.find(row => row.text.includes('This is insane'));
assert.deepEqual(info.tagContext, ['info_panel']);
assert.deepEqual(inner.tagContext, ['inner_info', 'small']);

const baseSettings = {
    translationRuleOrder: ['fineTuning'],
    globalPromptEnabled: true,
    allDialoguePromptEnabled: true,
    dialoguePromptEnabled: true,
    otherDialoguePromptEnabled: true,
};
const offPrompt = buildOutputPrompt(segmented, baseSettings, '', {
    characterName: '홍진',
    userName: '담은',
});
assert.doesNotMatch(offPrompt, /TEMPORARY CHUSEOK GALBWAE STYLE/);

for (const scope of ['all', 'dialogueInner']) {
    for (const extra of [{}, { developerMadKoreanOutputEnabled: true }]) {
        const prompt = buildOutputPrompt(segmented, {
            ...baseSettings,
            ...extra,
            chuseokGalbwaeScope: scope,
        }, '', { characterName: '홍진', userName: '담은' });
        assert.match(prompt, /TEMPORARY CHUSEOK GALBWAE STYLE/);
        assert.match(prompt, new RegExp(`ACTIVE MODE=${scope}`));
        assert.match(prompt, /MODE=all: apply it to Korean narrative prose/);
        assert.match(prompt, /MODE=dialogueInner: apply it ONLY/);
        assert.match(prompt, /proper names and particles attached directly to those names normally spelled/);
        assert.match(prompt, /"tag_context":\["inner_info","small"\]/);
        assert.match(prompt, /"tag_context":\["info_panel"\]/);
        assert.match(prompt, /"나 알아\?" → "나를 아늕랴!!"/);
    }
}

const exclusivePrompt = buildOutputPrompt(segmented, {
    ...baseSettings,
    chuseokGalbwaeScope: 'all',
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    developerMode: true,
    baseTranslationCustom: { enabled: true, prompt: 'CUSTOM BASE MUST NOT APPEAR' },
    globalPrompt: 'GLOBAL MUST NOT APPEAR',
    allDialoguePrompt: 'ALL DIALOGUE MUST NOT APPEAR',
    dialoguePrompt: 'TARGET DIALOGUE MUST NOT APPEAR',
    otherDialoguePrompt: 'OTHER DIALOGUE MUST NOT APPEAR',
}, 'ONE TIME MUST NOT APPEAR', { characterName: '홍진', userName: '담은' });
assert.match(exclusivePrompt, /EXCLUSIVE GALBWAE MODE/);
assert.doesNotMatch(exclusivePrompt, /MAD KOREAN|KIM HONG-JIN VOICE/);
assert.doesNotMatch(exclusivePrompt, /CUSTOM BASE MUST NOT APPEAR|GLOBAL MUST NOT APPEAR|ALL DIALOGUE MUST NOT APPEAR|TARGET DIALOGUE MUST NOT APPEAR|OTHER DIALOGUE MUST NOT APPEAR|ONE TIME MUST NOT APPEAR/);

const translation = '<Inner_Info><small>🧠 홍진: 이건 미쳤어.</small></Inner_Info>';
const start = translation.indexOf('이건');
const selectionPrompt = buildSelectionPrompt({
    source,
    sourceContext: 'This is insane.',
    translation,
    selected: '이건 미쳤어.',
    start,
    end: start + '이건 미쳤어.'.length,
    settings: { ...baseSettings, chuseokGalbwaeScope: 'dialogueInner' },
    oneTimeInstruction: '',
});
assert.match(selectionPrompt, /CURRENT SCOPE=inner_info/);

const narrativeTranslation = '홍진은 문 앞에서 잠깐 멈췄다.';
const narrativeSelection = buildSelectionPrompt({
    source: 'Hong-jin stopped at the door for a moment.',
    sourceContext: 'Hong-jin stopped at the door for a moment.',
    translation: narrativeTranslation,
    selected: narrativeTranslation,
    start: 0,
    end: narrativeTranslation.length,
    settings: { ...baseSettings, chuseokGalbwaeScope: 'all' },
    oneTimeInstruction: '',
});
assert.match(narrativeSelection, /CURRENT SCOPE=narration/);
assert.match(narrativeSelection, /ACTIVE MODE=all/);

const panelTranslation = '<Info_panel>[날씨: 맑음]</Info_panel>';
const panelStart = panelTranslation.indexOf('[날씨');
const panelSelection = buildSelectionPrompt({
    source: '<Info_panel>[Weather: Sunny]</Info_panel>',
    sourceContext: '[Weather: Sunny]',
    translation: panelTranslation,
    selected: '[날씨: 맑음]',
    start: panelStart,
    end: panelStart + '[날씨: 맑음]'.length,
    settings: { ...baseSettings, chuseokGalbwaeScope: 'all' },
    oneTimeInstruction: '',
});
assert.match(panelSelection, /CURRENT SCOPE=tagged_content/);

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.match(index, /chuseokGalbwaeScope:\s*'off'/);
assert.match(index, /function normalizedChuseokGalbwaeScope\(/);
assert.match(index, /id="verba-chuseok-galbwae-all"/);
assert.match(index, /id="verba-chuseok-galbwae-dialogue-inner"/);
assert.match(index, /target\.id === 'verba-chuseok-galbwae-all'/);
assert.match(index, /target\.id === 'verba-chuseok-galbwae-dialogue-inner'/);
assert.match(index, /chuseokGalbwaeScope:\s*normalizedChuseokGalbwaeScope/);

const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert.match(style, /\.verba-visibility-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);

console.log('PASS: Chuseok Galbwae defaults OFF, runs as an exclusive style prompt, supports all-text or dialogue+Inner_Info modes, uses the old-man meme rewrite pattern, preserves protected structure, and keeps visibility actions horizontal.');
