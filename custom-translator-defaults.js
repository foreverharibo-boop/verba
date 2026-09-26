import {
    buildBannedRepairPrompt,
    buildInputPrompt,
    buildNameHistoryFormsPrompt,
    buildNameMatchPrompt,
    buildOutputPrompt,
    buildProtectedTokenRepairPrompt,
    buildQualityAuditPrompt,
    buildRoleTermPlanPrompt,
    buildSelectionPrompt,
    buildSpeakerAttributionPrompt,
    buildTermConsistencyRepairPrompt,
    buildUntranslatedRepairPrompt,
} from './core.js';

function editablePromptBody(value) {
    const prompt = String(value || '').trim();
    const dataMarkers = [
        '\nReturn {"segments"',
        '\nReturn exactly 3 meaning-equivalent distinct candidates:',
        '\nJSON only:',
        '\nSEGMENTS\n',
        '\nSOURCE\n',
        '\nORIGINAL SOURCE\n',
        '\nORIGINAL\n',
        '\nDATA\n',
        '\nTERMS\n',
        '\nCANDIDATE SEGMENTS\n',
        '\nIDS\n',
        '\nCONTEXT\n',
    ];
    const cutAt = dataMarkers
        .map(marker => prompt.indexOf(marker))
        .filter(index => index >= 0)
        .reduce((earliest, index) => Math.min(earliest, index), prompt.length);
    return prompt.slice(0, cutAt).trim();
}

function originalPromptSection(title, prompt) {
    return `[${title} — ORIGINAL BUILT-IN PROMPT]\n${editablePromptBody(prompt)}`;
}

function previewSettings(ruleOrder = []) {
    return {
        developerMode: false,
        developerCompressedPromptEnabled: false,
        developerExtremeCompressedPromptEnabled: false,
        developerMadKoreanOutputEnabled: false,
        developerHongjinFlavorEnabled: false,
        developerMadKoreanTargetToUserRegister: 'source',
        developerMadKoreanUserToTargetRegister: 'source',
        developerHongjinTranscreation: 'strong',
        developerHongjinProfanity: 'natural',
        developerHongjinTeasing: 'natural',
        developerHongjinVulgarity: 'natural',
        developerHongjinPlayfulness: 'natural',
        developerHongjinAgeBand: 'unspecified',
        developerHongjinOppaFrequency: 'off',
        chuseokGalbwaeScope: 'off',
        globalPrompt: '',
        globalPromptEnabled: true,
        allDialoguePrompt: '',
        allDialoguePromptEnabled: true,
        dialoguePrompt: '',
        dialoguePromptEnabled: true,
        otherDialoguePrompt: '',
        otherDialoguePromptEnabled: true,
        bannedWords: '',
        translationRuleOrder: Array.isArray(ruleOrder) ? [...ruleOrder] : [],
    };
}

export function buildDefaultCustomTranslatorTemplates(ruleOrder = []) {
    const baseSettings = previewSettings(ruleOrder);
    const flavorSettings = {
        ...baseSettings,
        developerMadKoreanOutputEnabled: true,
        developerHongjinFlavorEnabled: true,
    };
    const speakerIdentity = {
        characterName: '{{char}}',
        userName: '{{user}}',
        characterGender: 'unknown',
        nameLocks: [],
    };
    const segmented = {
        segments: [
            { id: 'seg_0000', type: 'narration', text: '{{SOURCE_NARRATION}}' },
            { id: 'seg_0001', type: 'dialogue_candidate', text: '"{{SOURCE_DIALOGUE}}"' },
        ],
        nameTokens: [],
    };
    const sourceSegment = {
        id: 'seg_0000',
        type: 'narration',
        outputScope: 'narration',
        text: '{{SOURCE_TEXT}}',
        qualityChecks: [],
        qualityReasons: [],
        expectedProtectedTokens: [],
        untranslatedReason: 'foreign source text remains untranslated',
    };
    const currentTranslations = new Map([['seg_0000', '{{CURRENT_KOREAN_TRANSLATION}}']]);

    const output = buildOutputPrompt(segmented, baseSettings, '', speakerIdentity, null);
    const input = buildInputPrompt('{{KOREAN_INPUT}}', baseSettings, 'unknown', speakerIdentity);
    const selection = buildSelectionPrompt({
        source: '{{ORIGINAL_SOURCE}}',
        sourceContext: '{{ORIGINAL_SOURCE_CONTEXT}}',
        translation: '{{SELECTED_KOREAN_FRAGMENT}}',
        selected: '{{SELECTED_KOREAN_FRAGMENT}}',
        start: 0,
        end: '{{SELECTED_KOREAN_FRAGMENT}}'.length,
        settings: baseSettings,
        oneTimeInstruction: '',
        speakerIdentity,
        candidateCount: 1,
        contextMode: 'selection',
        tuning: null,
    });
    const nameMatch = buildNameMatchPrompt({
        source: '{{ORIGINAL_SOURCE}}',
        translation: '{{CURRENT_KOREAN_TRANSLATION}}',
        selected: '{{SELECTED_NAME}}',
        start: 0,
        end: '{{SELECTED_NAME}}'.length,
    });
    const nameHistory = buildNameHistoryFormsPrompt({
        sourceName: '{{SOURCE_NAME}}',
        currentName: '{{CURRENT_KOREAN_NAME}}',
        candidates: ['{{CANDIDATE_KOREAN_NAME}}'],
    });
    const rolePlan = buildRoleTermPlanPrompt({
        sourceContext: '{{ORIGINAL_SOURCE_CONTEXT}}',
        terms: ['{{ROLE_OR_TITLE_TERM}}'],
        settings: baseSettings,
    });
    const termConsistency = buildTermConsistencyRepairPrompt({
        rows: [{
            id: 'seg_0000',
            type: 'narration',
            source: '{{SOURCE_TEXT}}',
            currentTranslation: '{{CURRENT_KOREAN_TRANSLATION}}',
        }],
        terms: ['{{ROLE_OR_TITLE_TERM}}'],
        settings: baseSettings,
    });
    const bannedRepair = buildBannedRepairPrompt(
        [sourceSegment], currentTranslations, baseSettings, speakerIdentity, [], null, 'mixed',
    );
    const protectedRepair = buildProtectedTokenRepairPrompt(
        [sourceSegment], currentTranslations, baseSettings, speakerIdentity, [], null, 'mixed',
    );
    const untranslatedRepair = buildUntranslatedRepairPrompt(
        [sourceSegment], currentTranslations, baseSettings, speakerIdentity, [], null, 'mixed',
    );
    const quality = buildQualityAuditPrompt({
        segments: [sourceSegment],
        currentTranslations,
        sourceContext: '{{ORIGINAL_SOURCE_CONTEXT}}',
        settings: baseSettings,
        speakerIdentity,
        nameTokens: [],
        tuning: null,
        enabledChecks: ['meaning', 'referent', 'voice', 'translationese', 'continuity'],
    });
    const flavor = buildOutputPrompt(segmented, flavorSettings, '', speakerIdentity, null);
    const other = buildSpeakerAttributionPrompt(segmented, speakerIdentity, baseSettings);

    return {
        output: editablePromptBody(output),
        input: editablePromptBody(input),
        selection: editablePromptBody(selection),
        name: [
            originalPromptSection('NAME MATCH', nameMatch),
            originalPromptSection('NAME HISTORY FORMS', nameHistory),
        ].join('\n\n'),
        consistency: [
            originalPromptSection('ROLE TERM PLAN', rolePlan),
            originalPromptSection('TERM CONSISTENCY REPAIR', termConsistency),
        ].join('\n\n'),
        repair: [
            originalPromptSection('BANNED WORD REPAIR', bannedRepair),
            originalPromptSection('PROTECTED TOKEN REPAIR', protectedRepair),
            originalPromptSection('UNTRANSLATED TEXT REPAIR', untranslatedRepair),
        ].join('\n\n'),
        quality: editablePromptBody(quality),
        flavor: editablePromptBody(flavor),
        other: editablePromptBody(other),
    };
}
