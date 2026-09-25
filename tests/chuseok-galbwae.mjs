import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildOutputPrompt,
    buildSelectionPrompt,
    findUntranslatedSegments,
    segmentSource,
} from '../core.js';

const source = `Aila waited **right there** while Calix called Atlas.\n\n"**Do you know me?**"\n\n<div class="notice">How do I do this?</div>\n\n<Info_panel>[Weather: Sunny]</Info_panel>\n\n<Inner_Info><small>🧠 Hong-jin: This is insane.</small></Inner_Info>`;
const segmented = segmentSource(source);
const ordinaryTag = segmented.segments.find(row => row.text.includes('How do I do this?'));
const info = segmented.segments.find(row => row.text.includes('Weather'));
const inner = segmented.segments.find(row => row.text.includes('This is insane'));
assert.deepEqual(ordinaryTag.tagContext, ['div']);
assert.deepEqual(info.tagContext, ['info_panel']);
assert.deepEqual(inner.tagContext, ['inner_info', 'small']);
assert.ok(segmented.segments.some(row => row.text.includes('**Do you know me?**')));
assert.equal(segmented.tokens.some(row => row.value.includes('**')), false);
const tagsDisabled = segmentSource(source, [], { translateTaggedContent: false });
assert.equal(tagsDisabled.segments.some(row => row.text.includes('How do I do this?')), false);
assert.equal(tagsDisabled.segments.some(row => row.text.includes('This is insane')), false);

const nameLeftoverSegment = { id: 'seg_name', type: 'narration', text: 'Aila called Calix. Atlas answered Aila.' };
const nameLeftovers = findUntranslatedSegments(
    [nameLeftoverSegment],
    new Map([['seg_name', 'Aila가 Calix를 불렀다. Atlas는 Aila! 하고 대답했다.']]),
    { chuseokGalbwaeScope: 'all' },
);
assert.equal(nameLeftovers.length, 1);
assert.match(nameLeftovers[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Aila, Calix, Atlas/);
assert.equal(findUntranslatedSegments(
    [nameLeftoverSegment],
    new Map([['seg_name', '아일라가 칼릭스를 불렀다. 아틀라스가 대답했다.']]),
    { chuseokGalbwaeScope: 'all' },
).length, 0);
assert.match(findUntranslatedSegments(
    [{ id: 'seg_bold_name', type: 'dialogue_candidate', text: '**Aila!**' }],
    new Map([['seg_bold_name', '**Aila!**']]),
    { chuseokGalbwaeScope: 'all' },
)[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Aila/);
assert.match(findUntranslatedSegments(
    [{ id: 'seg_tag_name', type: 'tagged_content', text: 'Calix' }],
    new Map([['seg_tag_name', 'Calix']]),
    { chuseokGalbwaeScope: 'all' },
)[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Calix/);
assert.match(findUntranslatedSegments(
    [{ id: 'seg_bilingual_setting', type: 'dialogue_candidate', text: 'Atlas called her.' }],
    new Map([['seg_bilingual_setting', 'Atlas가 그녀를 불렀다.']]),
    {
        chuseokGalbwaeScope: 'all',
        globalPromptEnabled: true,
        globalPrompt: '영어 원문과 한국어 번역을 함께 출력한다.',
    },
)[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Atlas/);
assert.match(findUntranslatedSegments(
    [{
        id: 'seg_possessive_name',
        type: 'narration',
        text: "Atlas's ears perk up abruptly and then flatten just as fast.",
    }],
    new Map([['seg_possessive_name', 'Atlas의 귀가 팍 솟구컬다가 순식간애 축 쳐젼내요.']]),
    { chuseokGalbwaeScope: 'all' },
)[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Atlas/);
assert.equal(findUntranslatedSegments(
    [nameLeftoverSegment],
    new Map([['seg_name', 'Aila가 Calix를 불렀고 Atlas는 대답했다.']]),
    { chuseokGalbwaeScope: 'off' },
).length, 0);

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
        assert.match(prompt, /"tag_context":\["div"\]/);
        assert.match(prompt, /"나 알아\?" → "나를 아늕랴!!"/);
        assert.match(prompt, /chaotic 죠캎-style Korean internet-post language/);
        assert.match(prompt, /LIGHT, intermittent internet-grandpa flavor/);
        assert.match(prompt, /Do not turn the whole response into historical-drama speech/);
        assert.match(prompt, /씨핤, 씨핧, 샤갈, 쌱앐, 쌰갈, 시핣/);
        assert.match(prompt, /알겠어요→알갰어료/);
        assert.match(prompt, /네 or 응 to 례/);
        assert.match(prompt, /roughly one out of three/);
        assert.match(prompt, /Sprinkle ㄷㄷ, ;; and ㅠㅠ/);
        assert.match(prompt, /NAME HANDLING ORDER — ABSOLUTE/);
        assert.match(prompt, /A supplied fixed name mapping wins/);
        assert.match(prompt, /Aila→아일라, Calix→칼릭스, Atlas→아틀라스/);
        assert.match(prompt, /Never leave a Latin-script character name unchanged/);
        assert.match(prompt, /MARKDOWN IS FORMATTING, NOT A TEXT EXEMPTION/);
        assert.match(prompt, /\*\*Do you know me\?\*\* → \*\*나를 아늕랴!!\*\*/);
        assert.match(prompt, /PAIRED TAGS ARE AN ABSOLUTE GALBWAE EXEMPTION/);
        assert.match(prompt, /Do NOT apply GALBWAE to visible text between ANY <tag>\.\.\.<\/tag> pair/);
        assert.match(prompt, /including <Inner_Info>/);
        assert.match(prompt, /There are no tag-name exceptions/);
        assert.doesNotMatch(prompt, /<div>Do you know me\?<\/div> → <div>나를 아늕랴!!<\/div>/);
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
assert.match(index, /galbwaeScope !== 'off' && String\(options\.stage \|\| ''\)\.toLocaleLowerCase\(\)\.includes\('repair'\)/);

const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert.match(style, /\.verba-visibility-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);

console.log('PASS: Chuseok Galbwae defaults OFF, runs as an exclusive style prompt, supports all-text or dialogue+bold-Markdown modes, detects and repairs strong unchanged Latin character-name leftovers only while Galbwae is active, forces fixed-name-first natural Hangul names before protecting them from style corruption, rewrites eligible visible text inside ** delimiters while absolutely exempting every paired-tag interior, mixes sparse internet-grandpa/profanity/ending/punctuation mutations without mechanical repetition, respects the tagged-content toggle, and keeps visibility actions horizontal.');
