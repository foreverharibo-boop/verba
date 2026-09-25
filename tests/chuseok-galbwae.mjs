import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildOutputPrompt,
    buildSelectionPrompt,
    findUntranslatedSegments,
    segmentSource,
} from '../core.js';

const source = `Aila waited **right there** while Calix called Atlas.\n\n"**Do you know me?**"\n\n<div>How do I do this?</div>\n\n<Info_panel>[Weather: Sunny]</Info_panel>\n\n<Inner_Info><small>Hong-jin: This is insane.</small></Inner_Info>`;
const segmented = segmentSource(source);
assert.deepEqual(segmented.segments.find(row => row.text.includes('How do I'))?.tagContext, ['div']);
assert.deepEqual(segmented.segments.find(row => row.text.includes('Weather'))?.tagContext, ['info_panel']);
assert.deepEqual(segmented.segments.find(row => row.text.includes('This is insane'))?.tagContext, ['inner_info', 'small']);

const disabled = segmentSource(source, [], { translateTaggedContent: false });
assert.equal(disabled.segments.some(row => row.text.includes('How do I')), false);
assert.equal(disabled.segments.some(row => row.text.includes('Weather')), false);

const settings = {
    chuseokGalbwaeScope: 'all',
    developerMadKoreanOutputEnabled: true,
    developerHongjinFlavorEnabled: true,
    globalPromptEnabled: true,
    globalPrompt: 'MUST NOT APPEAR',
    allDialoguePromptEnabled: true,
    allDialoguePrompt: 'ALSO MUST NOT APPEAR',
    translationRuleOrder: ['global', 'allDialogue'],
};
const prompt = buildOutputPrompt(segmented, settings, 'ONE TIME MUST NOT APPEAR');
assert.match(prompt, /EXCLUSIVE TEMPORARY CHUSEOK GALBWAE/);
assert.match(prompt, /ACTIVE MODE=all/);
assert.match(prompt, /나 알아\?→나를 아늕랴!!/);
assert.match(prompt, /씨핤, 씨핧, 샤갈, 쌱앐, 쌰갈, 시핣/);
assert.match(prompt, /Aila→아일라, Calix→칼릭스, Atlas→아틀라스/);
assert.match(prompt, /MARKDOWN IS FORMATTING, NOT A TEXT EXEMPTION/);
assert.match(prompt, /PAIRED TAGS ARE AN ABSOLUTE GALBWAE EXEMPTION/);
assert.doesNotMatch(prompt, /MUST NOT APPEAR|ALSO MUST NOT APPEAR|ONE TIME MUST NOT APPEAR|MAD KOREAN|KIM HONG-JIN/);

const leftovers = findUntranslatedSegments(
    [{ id: 'name', type: 'narration', text: "Atlas's ears moved while Aila called Calix." }],
    new Map([['name', 'Atlas의 귀가 움직이는 동안 Aila가 Calix를 불럿내료.']]),
    { chuseokGalbwaeScope: 'all' },
);
assert.equal(leftovers.length, 1);
assert.match(leftovers[0].untranslatedReason, /UNTRANSLATED_CHARACTER_NAME: Atlas, Aila, Calix/);

const translation = '<Info_panel>[날씨: 맑음]</Info_panel>';
const start = translation.indexOf('[날씨');
const selectionPrompt = buildSelectionPrompt({
    source,
    sourceContext: '[Weather: Sunny]',
    translation,
    selected: '[날씨: 맑음]',
    start,
    end: start + '[날씨: 맑음]'.length,
    settings: { chuseokGalbwaeScope: 'all', translationRuleOrder: [] },
    oneTimeInstruction: '',
});
assert.match(selectionPrompt, /REQUEST SCOPE=tagged_content/);

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert.match(index, /id="verba-deep-chuseok-galbwae-all"/);
assert.match(index, /id="verba-deep-chuseok-galbwae-dialogue-inner"/);
assert.match(index, /galbwaeScope !== 'off'.*includes\('repair'\)/s);
assert.match(style, /\.verba-deep-visibility-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);

console.log('PASS: 긴르바 갈봬체 배타 모드, 태그 예외, 굵은 글씨 지시, 이름 소유격 검수와 UI가 연결됨.');
