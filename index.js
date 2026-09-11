import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { messageFormatting, showMoreMessages } from '../../../../script.js';
import {
    assembleTranslation,
    buildBannedRepairPrompt,
    buildInputPrompt,
    buildMultiSelectionPrompt,
    buildNameHistoryFormsPrompt,
    buildNameMatchPrompt,
    buildOutputPrompt,
    buildProtectedTokenRepairPrompt,
    buildQualityAuditPrompt,
    buildRoleTermPlanPrompt,
    buildScopedOutputPrompt,
    buildSpeakerAttributionPrompt,
    buildSelectionPrompt,
    buildTermConsistencyRepairPrompt,
    buildUntranslatedRepairPrompt,
    detectCharacterGender,
    extractResponseText,
    findBannedWords,
    findProtectedTokenIntegrityProblems,
    findTranslationPromptConflicts,
    findUntranslatedSegments,
    hasForeignText,
    hasKorean,
    hashText,
    isPredominantlyKorean,
    parseSegmentResponse,
    parseSelectionCandidateResponse,
    replaceOutsideProtected,
    restoreProtected,
    segmentSource,
    selectionTouchesDialogue,
} from './core.js';

const EXTENSION_KEY = 'verba';
const EXTENSION_VERSION = '0.4.31';
const TOUCH_SELECTION_QUIET_MS = 2000;
const STATE_KEY = 'verba_current_translation';
const SOURCE_VIEW_KEY = 'verba_source_view';
const CHARACTER_FIELD_KEY = 'verba';
const RELATION_TEMPERATURE_OPTIONS = [
    { value: 'cold', label: '차가움' },
    { value: 'distant', label: '거리감' },
    { value: 'default', label: '기본' },
    { value: 'close', label: '가까움' },
    { value: 'intimate', label: '친밀함' },
];
const LOCALIZATION_LEVEL_OPTIONS = [
    { value: 'preserve', label: '원문 유지' },
    { value: 'light', label: '약한 현지화' },
    { value: 'balanced', label: '균형' },
    { value: 'naturalized', label: '자연스러운 한국어' },
    { value: 'native', label: '네이티브 한국어' },
];
const TRANSLATION_RULE_DEFINITIONS = [
    { key: 'oneTime', label: '이번 번역 요구사항' },
    { key: 'characterDialogue', label: '캐릭터 대사 전용 프롬프트' },
    { key: 'otherDialogue', label: 'NPC·USER 대사 전용 프롬프트' },
    { key: 'allDialogue', label: '모든 대사 공통 프롬프트' },
    { key: 'global', label: '전체 번역 전역 프롬프트' },
    { key: 'fineTuning', label: '관계 온도·현지화' },
];
const DEFAULT_TRANSLATION_RULE_ORDER = TRANSLATION_RULE_DEFINITIONS.map(item => item.key);
const DEFAULT_SETTINGS = {
    profileId: '',
    fallbackProfileId: '',
    thirdProfileId: '',
    activeProfileSlot: 'A',
    autoProfileFallback: true,
    debugMode: false,
    developerMode: false,
    qualityAuditEnabled: false,
    qualityAuditMeaning: true,
    qualityAuditReferent: true,
    qualityAuditVoice: true,
    qualityAuditTranslationese: true,
    qualityAuditContinuity: true,
    expressionEmphasisTaste: 'default',
    expressionDisfluencyTaste: 'default',
    expressionIdiomMetaphorTaste: 'default',
    koreanFlavorEnabled: false,
    koreanFlavorDialogueRhythm: 'balanced',
    koreanFlavorPronounOmission: 'natural',
    koreanFlavorProfanityTone: 'default',
    koreanFlavorInterjectionTone: 'natural',
    koreanFlavorMemeDensity: 'default',
    koreanFlavorReduceReferentRepetition: true,
    englishFlavorEnabled: false,
    englishFlavorDialogueRhythm: 'balanced',
    englishFlavorSlangDensity: 'natural',
    englishFlavorProfanityTone: 'default',
    englishFlavorInterjectionTone: 'natural',
    englishFlavorMemeDensity: 'default',
    englishFlavorReduceReferentRepetition: true,
    englishFlavorConversationNaturalization: 'natural',
    autoInput: false,
    selectionCandidates: false,
    selectionQuickCount: 2,
    showSelectionName: true,
    showSelectionSource: true,
    showSelectionLock: true,
    showSelectionBundle: true,
    profileStats: null,
    globalPrompt: '',
    globalPromptEnabled: true,
    allDialoguePrompt: '',
    allDialoguePromptEnabled: true,
    dialoguePrompt: '',
    dialoguePromptEnabled: true,
    otherDialoguePrompt: '',
    otherDialoguePromptEnabled: true,
    promptPresets: [],
    promptPresetBackups: [],
    dialogueEndingPreferred: '',
    dialogueEndingAvoid: '',
    dialogueEndingStrength: 'normal',
    dialogueEndingRepetitionReduction: true,
    previousOutputCompletionAction: 'jump',
    retranslationInstructionHistory: [],
    bannedWords: '',
    maxTokens: 15000,
    timeoutSeconds: 120,
    relationTemperatureEnabled: true,
    relationTemperature: 'default',
    narrationLocalizationLevel: 'balanced',
    dialogueLocalizationLevel: 'balanced',
    translationRuleOrder: DEFAULT_TRANSLATION_RULE_ORDER,
};

const baseContext = getContext();
const previousSettings = extension_settings[EXTENSION_KEY] && typeof extension_settings[EXTENSION_KEY] === 'object'
    ? extension_settings[EXTENSION_KEY]
    : {};
const previousLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === previousSettings.localizationLevel)
    ? previousSettings.localizationLevel
    : 'balanced';
extension_settings[EXTENSION_KEY] = Object.assign(
    {},
    DEFAULT_SETTINGS,
    extension_settings[EXTENSION_KEY] || {},
);
const settings = extension_settings[EXTENSION_KEY];
settings.profileStats = normalizeProfileStats(settings.profileStats);
settings.autoProfileFallback = settings.autoProfileFallback !== false;
settings.developerMode = settings.developerMode === true;
settings.qualityAuditEnabled = settings.qualityAuditEnabled === true;
settings.qualityAuditMeaning = settings.qualityAuditMeaning !== false;
settings.qualityAuditReferent = settings.qualityAuditReferent !== false;
settings.qualityAuditVoice = settings.qualityAuditVoice !== false;
settings.qualityAuditTranslationese = settings.qualityAuditTranslationese !== false;
settings.qualityAuditContinuity = settings.qualityAuditContinuity !== false;
settings.expressionEmphasisTaste = ['default', 'source', 'natural', 'active'].includes(settings.expressionEmphasisTaste)
    ? settings.expressionEmphasisTaste
    : 'default';
settings.expressionDisfluencyTaste = ['default', 'clean', 'natural', 'active'].includes(settings.expressionDisfluencyTaste)
    ? settings.expressionDisfluencyTaste
    : 'default';
settings.expressionIdiomMetaphorTaste = ['default', 'meaning', 'balanced', 'koreanized', 'sourceCulture'].includes(settings.expressionIdiomMetaphorTaste)
    ? settings.expressionIdiomMetaphorTaste
    : 'default';
settings.promptPresets = Array.isArray(settings.promptPresets)
    ? settings.promptPresets
        .map((preset, index) => ({
            id: String(preset?.id || `preset_${index}_${Date.now()}`).slice(0, 120),
            name: String(preset?.name || '').trim().slice(0, 60),
            globalPrompt: String(preset?.globalPrompt || ''),
            globalPromptEnabled: preset?.globalPromptEnabled !== false,
            allDialoguePrompt: String(preset?.allDialoguePrompt || ''),
            allDialoguePromptEnabled: preset?.allDialoguePromptEnabled !== false,
            dialoguePrompt: String(preset?.dialoguePrompt || ''),
            dialoguePromptEnabled: preset?.dialoguePromptEnabled !== false,
            otherDialoguePrompt: String(preset?.otherDialoguePrompt || ''),
            otherDialoguePromptEnabled: preset?.otherDialoguePromptEnabled !== false,
            favorite: preset?.favorite === true,
            updatedAt: String(preset?.updatedAt || ''),
        }))
        .filter(preset => preset.name)
        .slice(0, 100)
    : [];
settings.promptPresetBackups = normalizedPromptPresetBackups(settings.promptPresetBackups);
settings.koreanFlavorEnabled = settings.koreanFlavorEnabled === true;
settings.koreanFlavorDialogueRhythm = ['default', 'short', 'balanced', 'smooth'].includes(settings.koreanFlavorDialogueRhythm)
    ? settings.koreanFlavorDialogueRhythm
    : 'balanced';
settings.koreanFlavorPronounOmission = ['default', 'preserve', 'natural', 'active'].includes(settings.koreanFlavorPronounOmission)
    ? settings.koreanFlavorPronounOmission
    : 'natural';
settings.koreanFlavorProfanityTone = ['default', 'dry', 'blunt', 'lowSlang', 'restrained'].includes(settings.koreanFlavorProfanityTone)
    ? settings.koreanFlavorProfanityTone
    : 'default';
settings.koreanFlavorInterjectionTone = ['default', 'natural', 'restrained', 'lively'].includes(settings.koreanFlavorInterjectionTone)
    ? settings.koreanFlavorInterjectionTone
    : 'natural';
settings.koreanFlavorMemeDensity = ['default', 'light', 'natural', 'active'].includes(settings.koreanFlavorMemeDensity)
    ? settings.koreanFlavorMemeDensity
    : 'default';
settings.koreanFlavorReduceReferentRepetition = settings.koreanFlavorReduceReferentRepetition !== false;
settings.englishFlavorEnabled = settings.englishFlavorEnabled === true;
settings.englishFlavorDialogueRhythm = ['default', 'short', 'balanced', 'smooth'].includes(settings.englishFlavorDialogueRhythm)
    ? settings.englishFlavorDialogueRhythm
    : 'balanced';
settings.englishFlavorSlangDensity = ['default', 'low', 'natural', 'active'].includes(settings.englishFlavorSlangDensity)
    ? settings.englishFlavorSlangDensity
    : 'natural';
settings.englishFlavorProfanityTone = ['default', 'dry', 'blunt', 'everyday', 'lowSlang', 'restrained'].includes(settings.englishFlavorProfanityTone)
    ? settings.englishFlavorProfanityTone
    : 'default';
settings.englishFlavorInterjectionTone = ['default', 'natural', 'restrained', 'lively'].includes(settings.englishFlavorInterjectionTone)
    ? settings.englishFlavorInterjectionTone
    : 'natural';
settings.englishFlavorMemeDensity = ['default', 'light', 'natural', 'active'].includes(settings.englishFlavorMemeDensity)
    ? settings.englishFlavorMemeDensity
    : 'default';
settings.englishFlavorReduceReferentRepetition = settings.englishFlavorReduceReferentRepetition !== false;
settings.englishFlavorConversationNaturalization = ['default', 'natural', 'active'].includes(settings.englishFlavorConversationNaturalization)
    ? settings.englishFlavorConversationNaturalization
    : 'natural';
settings.relationTemperatureEnabled = settings.relationTemperatureEnabled !== false;
settings.selectionQuickCount = Math.min(5, Math.max(2, Number(settings.selectionQuickCount) || 2));
settings.globalPrompt = typeof settings.globalPrompt === 'string' ? settings.globalPrompt : '';
settings.globalPromptEnabled = settings.globalPromptEnabled !== false;
settings.dialoguePrompt = typeof settings.dialoguePrompt === 'string' ? settings.dialoguePrompt : '';
settings.dialoguePromptEnabled = settings.dialoguePromptEnabled !== false;
settings.allDialoguePrompt = typeof settings.allDialoguePrompt === 'string' ? settings.allDialoguePrompt : '';
settings.allDialoguePromptEnabled = settings.allDialoguePromptEnabled !== false;
settings.otherDialoguePrompt = typeof settings.otherDialoguePrompt === 'string' ? settings.otherDialoguePrompt : '';
settings.otherDialoguePromptEnabled = settings.otherDialoguePromptEnabled !== false;
settings.dialogueEndingPreferred = typeof settings.dialogueEndingPreferred === 'string' ? settings.dialogueEndingPreferred : '';
settings.dialogueEndingAvoid = typeof settings.dialogueEndingAvoid === 'string' ? settings.dialogueEndingAvoid : '';
settings.dialogueEndingStrength = ['light', 'normal', 'strong'].includes(settings.dialogueEndingStrength)
    ? settings.dialogueEndingStrength
    : 'normal';
settings.dialogueEndingRepetitionReduction = settings.dialogueEndingRepetitionReduction !== false;
settings.previousOutputCompletionAction = ['jump', 'stay'].includes(settings.previousOutputCompletionAction)
    ? settings.previousOutputCompletionAction
    : 'jump';
settings.retranslationInstructionHistory = Array.isArray(settings.retranslationInstructionHistory)
    ? [...new Set(
        settings.retranslationInstructionHistory
            .map(value => String(value || '').trim())
            .filter(Boolean),
    )].slice(0, 5)
    : [];
settings.relationTemperature = RELATION_TEMPERATURE_OPTIONS.some(option => option.value === settings.relationTemperature)
    ? settings.relationTemperature
    : 'default';
settings.narrationLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === previousSettings.narrationLocalizationLevel)
    ? previousSettings.narrationLocalizationLevel
    : previousLocalizationLevel;
settings.dialogueLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === previousSettings.dialogueLocalizationLevel)
    ? previousSettings.dialogueLocalizationLevel
    : previousLocalizationLevel;
if (
    Array.isArray(settings.translationRuleOrder)
    && !settings.translationRuleOrder.includes('otherDialogue')
) {
    const migratedOrder = [...settings.translationRuleOrder];
    const characterIndex = migratedOrder.indexOf('characterDialogue');
    const allDialogueIndex = migratedOrder.indexOf('allDialogue');
    const insertAt = characterIndex >= 0
        ? characterIndex + 1
        : allDialogueIndex >= 0
            ? allDialogueIndex
            : 1;
    migratedOrder.splice(insertAt, 0, 'otherDialogue');
    settings.translationRuleOrder = migratedOrder;
}
settings.translationRuleOrder = normalizeTranslationRuleOrder(settings.translationRuleOrder);
delete settings.localizationLevel;
delete settings.narrationStyle;
delete settings.dialogueStyle;
delete settings.preserveProperNouns;
delete settings.preserveRoles;
delete settings.preserveNumbers;
delete settings.preservePerspective;
delete settings.preserveFormatting;
settings.debugMode = settings.debugMode === true;
if (settings.maxTokens !== 15000) {
    settings.maxTokens = 15000;
    liveContext().saveSettingsDebounced?.();
}

const pendingOutputs = new Map();
const pendingSentInputs = new WeakMap();
const automaticTranslationTimers = new Map();
const swipeTranslationJobs = new Map();
const renderedTranslationCache = new Map();
const lastRenderedTranslationByMessage = new Map();
const failedOutputSignatures = new Map();
const serverRetryStates = new Map();
const speakerAttributionCache = new Map();
const roleTermPlanCache = new Map();
const insteadRevisionTranslationSeen = new Map();
const pendingInputControllers = new Set();
const transientLockedMessages = new Set();
const SCOPED_PARALLEL_REQUEST_LIMIT = 2;
const scopedParallelRequestQueue = [];
let scopedParallelRequestActive = 0;
let requestTail = Promise.resolve();
let lastQualityAuditSummary = '아직 실행되지 않음';
let chatSaveTimer = null;
let promptEditorBackupTimer = null;
let uiRefreshTimer = null;
let inputBusy = false;
let bypassSendClick = false;
let selectionBusy = false;
let selectionSnapshot = null;
let selectionTimer = null;
let bottomErrorTimer = null;
let messageCopyHoldTimer = null;
let messageCopyPointerId = null;
let messageCopyStart = null;
let messageCopyHoldShown = false;
let suppressMessageCopyClickUntil = 0;
let multiSelectionState = null;
let selectionHighlightTimer = null;
let selectionGestureActive = false;
let selectionNeedsCapture = false;
let selectionPointerType = '';
let preservedGestureSelection = null;
let lastTouchSelectionAt = 0;
let lastDesktopSelectionPlacement = null;
let lastDesktopSelectionAt = 0;
let lastDebugDiagnostic = null;
let lastPromptConflicts = [];

function liveContext() {
    return globalThis.SillyTavern?.getContext?.() || baseContext;
}

function notify(message, type = 'info') {
    if (type === 'error') {
        const diagnostic = settings.debugMode
            ? createDebugDiagnostic('generic-error', null, String(message || '오류가 발생했습니다.'))
            : null;
        if (diagnostic) lastDebugDiagnostic = diagnostic;
        showBottomError(message, diagnostic);
        try {
            globalThis.toastr?.error?.(message, '베르바');
        } catch {
            // Bottom notice above remains the fallback.
        }
        console.error(`[베르바] ${message}`);
        return;
    }
    const toaster = globalThis.toastr;
    if (toaster && typeof toaster[type] === 'function') {
        toaster[type](message, '베르바');
        return;
    }
    const logger = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    logger(`[베르바] ${message}`);
}

function sanitizeDebugValue(value, limit = 6000) {
    return String(value ?? '')
        .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/((?:api[-_ ]?key|authorization|token|secret|password)\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
        .slice(0, Math.max(200, Number(limit) || 6000));
}

function debugErrorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current) && chain.length < 6) {
        seen.add(current);
        chain.push({
            name: sanitizeDebugValue(current?.name || '', 120),
            message: sanitizeDebugValue(current?.message || String(current || ''), 1800),
            code: sanitizeDebugValue(current?.code || '', 200),
            status: sanitizeDebugValue(current?.status ?? current?.statusCode ?? current?.response?.status ?? '', 120),
            statusText: sanitizeDebugValue(current?.response?.statusText || '', 300),
            details: sanitizeDebugValue(current?.details || current?.response?.data?.error?.message || current?.response?.data?.message || '', 1800),
            stack: sanitizeDebugValue(current?.stack || '', 4500),
        });
        current = current?.cause;
    }
    return chain;
}

function createDebugDiagnostic(stage = 'unknown', error = null, displayMessage = '') {
    const context = liveContext();
    const latest = (() => {
        const chat = Array.isArray(context.chat) ? context.chat : [];
        for (let id = chat.length - 1; id >= 0; id -= 1) {
            const message = chat[id];
            if (message && !message.is_user && !message.is_system) return { id, message };
        }
        return null;
    })();
    const source = latest ? messageSource(latest.message) : '';
    const configured = configuredProfiles();
    const viewport = globalThis.visualViewport;
    return {
        report: 'VERBA_DEBUG_DIAGNOSTIC',
        verbaVersion: EXTENSION_VERSION,
        time: new Date().toISOString(),
        stage: sanitizeDebugValue(stage, 160),
        displayMessage: sanitizeDebugValue(displayMessage, 2200),
        errorChain: debugErrorChain(error),
        environment: {
            userAgent: sanitizeDebugValue(globalThis.navigator?.userAgent || '', 1000),
            viewport: {
                width: Math.round(viewport?.width || globalThis.innerWidth || 0),
                height: Math.round(viewport?.height || globalThis.innerHeight || 0),
                offsetTop: Math.round(viewport?.offsetTop || 0),
                offsetLeft: Math.round(viewport?.offsetLeft || 0),
            },
            touch: Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches),
        },
        profileState: {
            activeSlot: activeProfileSlot(),
            configuredSlots: configured.map(profile => profile.slot),
            autoProfileFallback: settings.autoProfileFallback !== false,
        },
        translationState: latest ? {
            messageId: latest.id,
            swipeId: currentSwipeId(latest.message),
            sourceHash: source ? hashText(source) : '',
            sourceLength: source.length,
            hasStoredTranslation: Boolean(currentRecord(latest.message)),
        } : null,
        settingsState: {
            autoInput: Boolean(settings.autoInput),
            selectionCandidates: Boolean(settings.selectionCandidates),
            relationTemperatureEnabled: settings.relationTemperatureEnabled !== false,
            relationTemperature: String(settings.relationTemperature || ''),
            narrationLocalizationLevel: String(settings.narrationLocalizationLevel || ''),
            dialogueLocalizationLevel: String(settings.dialogueLocalizationLevel || ''),
            maxTokens: Number(settings.maxTokens) || 0,
            timeoutSeconds: Number(settings.timeoutSeconds) || 0,
            mountedMessageCount: document.querySelectorAll('.mes[mesid]').length,
        },
        privacy: '메시지 원문·번역문·프롬프트·프로필 ID·API 키는 포함하지 않음',
    };
}

function debugDiagnosticText(diagnostic) {
    if (!diagnostic) return '';
    return `베르바 오류 진단\n${JSON.stringify(diagnostic, null, 2)}`;
}

async function copyDebugDiagnostic(diagnostic = lastDebugDiagnostic) {
    if (!diagnostic) throw new Error('복사할 최근 오류 진단이 없습니다.');
    await copyText(debugDiagnosticText(diagnostic));
}

function reportError(stage, error, displayMessage = '') {
    const message = String(displayMessage || errorText(error) || '오류가 발생했습니다.');
    const diagnostic = settings.debugMode ? createDebugDiagnostic(stage, error, message) : null;
    if (diagnostic) lastDebugDiagnostic = diagnostic;

    // Keep the diagnostic-capable bottom notice, but also use SillyTavern's
    // normal error toast so a translation failure can never end silently.
    showBottomError(message, diagnostic);
    try {
        globalThis.toastr?.error?.(message, '베르바');
    } catch {
        // Bottom notice above remains the fallback.
    }
    console.error(`[베르바] ${stage}`, error || message);
}

function compactPromptConflictExcerpt(value, limit = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '(감지 문구 없음)';
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function configuredPromptConflicts() {
    return findTranslationPromptConflicts({
        settings,
        oneTimeInstruction: '',
        includeDialogue: true,
        includeCharacterDialogue: true,
    });
}

function renderPromptConflictInspector(conflicts = null) {
    const host = document.querySelector('#verba-prompt-conflict-content');
    const badge = document.querySelector('#verba-prompt-conflict-count');
    if (!host) return;

    const rows = Array.isArray(conflicts) ? conflicts : configuredPromptConflicts();
    lastPromptConflicts = rows;

    if (badge) badge.textContent = rows.length ? `${rows.length}건 감지` : '충돌 없음';

    if (!rows.length) {
        host.innerHTML = `
            <div class="verba-conflict-empty">
                현재 저장된 전역·모든 대사 공통·캐릭터 전용·NPC·USER 전용 프롬프트에서는 명백한 충돌이 감지되지 않았어요.
            </div>`;
        return;
    }

    host.innerHTML = rows.map((conflict, index) => `
        <div class="verba-conflict-card">
            <div class="verba-conflict-card-header">
                <b>${index + 1}. ${escapeHtml(conflict.label || '번역 규칙')}</b>
                <small>${escapeHtml(conflict.winner?.label || '')} 우선</small>
            </div>
            <div class="verba-conflict-side">
                <span>${escapeHtml(conflict.left?.label || '')}</span>
                <b>${escapeHtml(conflict.left?.directive || '')}</b>
                <code>${escapeHtml(conflict.left?.excerpt || '')}</code>
            </div>
            <div class="verba-conflict-vs">↕ 서로 상충</div>
            <div class="verba-conflict-side">
                <span>${escapeHtml(conflict.right?.label || '')}</span>
                <b>${escapeHtml(conflict.right?.directive || '')}</b>
                <code>${escapeHtml(conflict.right?.excerpt || '')}</code>
            </div>
        </div>
    `).join('');
}

function warnTranslationPromptConflicts({
    oneTimeInstruction = '',
    includeDialogue = true,
    includeCharacterDialogue = true,
} = {}) {
    const conflicts = findTranslationPromptConflicts({
        settings,
        oneTimeInstruction,
        includeDialogue,
        includeCharacterDialogue,
    });
    if (!conflicts.length) {
        lastPromptConflicts = [];
        renderPromptConflictInspector([]);
        return conflicts;
    }
    lastPromptConflicts = conflicts;
    renderPromptConflictInspector(conflicts);
    const first = conflicts[0];
    const remainder = conflicts.length > 1 ? ` 외 ${conflicts.length - 1}건` : '';
    const leftExcerpt = compactPromptConflictExcerpt(first.left?.excerpt);
    const rightExcerpt = compactPromptConflictExcerpt(first.right?.excerpt);
    notify(
        `번역 규칙 충돌${remainder}: ${first.left.label}의 “${leftExcerpt}” ↔ ${first.right.label}의 “${rightExcerpt}”. 현재 ${first.winner.label} 우선이며, 확장 탭의 ‘프롬프트 충돌 확인’에서 자세히 볼 수 있어요.`,
        'warning',
    );
    return conflicts;
}

function showBottomError(message, diagnostic = null) {
    clearTimeout(bottomErrorTimer);
    document.querySelector('#verba-bottom-error')?.remove();
    const notice = document.createElement('div');
    notice.id = 'verba-bottom-error';
    notice.className = 'verba-bottom-notice verba-bottom-error';
    notice.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.className = 'verba-error-text';
    text.textContent = `베르바 · ${String(message || '오류가 발생했습니다.')}`;
    const actions = document.createElement('div');
    actions.className = 'verba-error-actions';
    if (settings.debugMode && diagnostic) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'menu_button verba-debug-copy';
        copy.textContent = '진단 복사';
        copy.setAttribute('aria-label', '오류 진단 정보 복사');
        copy.addEventListener('click', async () => {
            const previous = copy.textContent;
            copy.disabled = true;
            try {
                await copyDebugDiagnostic(diagnostic);
                copy.textContent = '복사됨';
            } catch (error) {
                copy.textContent = '복사 실패';
                console.error('[베르바] 오류 진단 복사 실패', error);
            } finally {
                setTimeout(() => {
                    if (!copy.isConnected) return;
                    copy.disabled = false;
                    copy.textContent = previous;
                }, 1200);
            }
        });
        actions.append(copy);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'verba-error-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', '오류 알림 닫기');
    close.addEventListener('click', () => {
        clearTimeout(bottomErrorTimer);
        notice.remove();
    });
    actions.append(close);
    notice.append(text, actions);
    document.documentElement.append(notice);
    bottomErrorTimer = setTimeout(() => notice.remove(), settings.debugMode && diagnostic ? 30000 : 12000);
}

function updateServerRetryIndicator() {
    let indicator = document.querySelector('#verba-server-retry-indicator');
    if (!serverRetryStates.size) {
        indicator?.remove();
        return;
    }
    const state = [...serverRetryStates.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!indicator) {
        indicator = document.createElement('button');
        indicator.id = 'verba-server-retry-indicator';
        indicator.className = 'verba-bottom-notice';
        indicator.type = 'button';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');
        indicator.addEventListener('click', () => {
            indicator.disabled = true;
            indicator.textContent = '베르바 · 번역 재시도 취소 중…';
            for (const retry of serverRetryStates.values()) retry.controller.abort();
            notify('번역 자동 재시도를 취소했어요.', 'info');
        });
        document.documentElement.append(indicator);
    }
    const timing = state.delayMs > 0 ? `${Math.ceil(state.delayMs / 1000)}초 후` : '요청 중';
    indicator.disabled = false;
    indicator.textContent = `베르바 · 번역 실패 · ${state.retryCount}/${state.maxRetries}회 ${timing} 재시도 · ✕`;
    indicator.title = '눌러서 번역 자동 재시도 취소';
    indicator.setAttribute('aria-label', indicator.title);
}

function showProgress(message, options = {}) {
    if (!globalThis.toastr?.info) return null;
    return globalThis.toastr.info(message, '베르바', {
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: false,
        closeButton: Boolean(options.onCancel),
        onCloseClick: typeof options.onCancel === 'function' ? options.onCancel : undefined,
    });
}

function showInputProgress(controller) {
    return showProgress('인풋을 영어로 번역 중입니다…', {
        onCancel: () => controller.abort(),
    });
}

function clearProgress(toast) {
    if (!toast) return;
    try {
        globalThis.toastr?.clear?.(toast);
    } catch {
        toast?.remove?.();
        toast?.[0]?.remove?.();
    }
}

function errorText(error) {
    if (!error) return '알 수 없는 오류';
    if (typeof error === 'string') return error;
    const parts = [];
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current) && parts.length < 6) {
        seen.add(current);
        if (current.message && !parts.includes(current.message)) parts.push(current.message);
        if (current.status) parts.push(`상태 ${current.status}`);
        if (current.statusCode) parts.push(`상태 ${current.statusCode}`);
        if (current.code) parts.push(`코드 ${current.code}`);
        if (current.details && !parts.includes(String(current.details))) parts.push(String(current.details));
        if (current.response?.status) parts.push(`상태 ${current.response.status}`);
        if (current.response?.statusText) parts.push(String(current.response.statusText));
        if (current.response?.data?.error?.message) parts.push(String(current.response.data.error.message));
        if (current.response?.data?.message) parts.push(String(current.response.data.message));
        current = current.cause;
    }
    return parts.join(' / ') || String(error);
}

function sameRetranslationWording(left, right) {
    const normalize = value => String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
    const leftNormalized = normalize(left);
    const rightNormalized = normalize(right);
    if (leftNormalized === rightNormalized) return true;
    const wordingOnly = value => value.replace(/[\s\p{P}]+/gu, '');
    const leftWording = wordingOnly(leftNormalized);
    return Boolean(leftWording && leftWording === wordingOnly(rightNormalized));
}

function isAbort(error, signal) {
    if (signal?.aborted || error?.name === 'AbortError') return true;
    if (error?.code === 'VERBA_TIMEOUT') return false;
    let current = error?.cause;
    const seen = new Set();
    while (current && !seen.has(current)) {
        seen.add(current);
        if (current.code === 'VERBA_TIMEOUT') return false;
        if (current.name === 'AbortError') return true;
        current = current.cause;
    }
    return false;
}

function saveSettings() {
    liveContext().saveSettingsDebounced?.();
}

function normalizedPromptPresetName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function currentPromptPresetSnapshot() {
    return {
        globalPrompt: String(settings.globalPrompt || ''),
        globalPromptEnabled: settings.globalPromptEnabled !== false,
        allDialoguePrompt: String(settings.allDialoguePrompt || ''),
        allDialoguePromptEnabled: settings.allDialoguePromptEnabled !== false,
        dialoguePrompt: String(settings.dialoguePrompt || ''),
        dialoguePromptEnabled: settings.dialoguePromptEnabled !== false,
        otherDialoguePrompt: String(settings.otherDialoguePrompt || ''),
        otherDialoguePromptEnabled: settings.otherDialoguePromptEnabled !== false,
    };
}

function normalizedPromptPresets() {
    const rows = Array.isArray(settings.promptPresets) ? settings.promptPresets : [];
    const seenIds = new Set();
    const result = [];
    for (const [index, raw] of rows.entries()) {
        const name = normalizedPromptPresetName(raw?.name);
        if (!name) continue;
        let id = String(raw?.id || `preset_${index}_${Date.now()}`).slice(0, 120);
        if (!id || seenIds.has(id)) id = `preset_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        seenIds.add(id);
        result.push({
            id,
            name,
            globalPrompt: String(raw?.globalPrompt || ''),
            globalPromptEnabled: raw?.globalPromptEnabled !== false,
            allDialoguePrompt: String(raw?.allDialoguePrompt || ''),
            allDialoguePromptEnabled: raw?.allDialoguePromptEnabled !== false,
            dialoguePrompt: String(raw?.dialoguePrompt || ''),
            dialoguePromptEnabled: raw?.dialoguePromptEnabled !== false,
            otherDialoguePrompt: String(raw?.otherDialoguePrompt || ''),
            otherDialoguePromptEnabled: raw?.otherDialoguePromptEnabled !== false,
            favorite: raw?.favorite === true,
            updatedAt: String(raw?.updatedAt || ''),
        });
        if (result.length >= 100) break;
    }
    settings.promptPresets = result;
    return result;
}


function normalizedPromptEditorSnapshot(value = {}) {
    return {
        globalPrompt: String(value?.globalPrompt || ''),
        globalPromptEnabled: value?.globalPromptEnabled !== false,
        allDialoguePrompt: String(value?.allDialoguePrompt || ''),
        allDialoguePromptEnabled: value?.allDialoguePromptEnabled !== false,
        dialoguePrompt: String(value?.dialoguePrompt || ''),
        dialoguePromptEnabled: value?.dialoguePromptEnabled !== false,
        otherDialoguePrompt: String(value?.otherDialoguePrompt || ''),
        otherDialoguePromptEnabled: value?.otherDialoguePromptEnabled !== false,
    };
}

function promptEditorSnapshotHasContent(snapshot = {}) {
    const normalized = normalizedPromptEditorSnapshot(snapshot);
    return [
        normalized.globalPrompt,
        normalized.allDialoguePrompt,
        normalized.dialoguePrompt,
        normalized.otherDialoguePrompt,
    ].some(value => String(value || '').trim().length > 0);
}

function normalizedPromptPresetBackups(value = settings?.promptPresetBackups) {
    const rows = Array.isArray(value) ? value : [];
    return rows.map((raw, index) => {
        // v0.4.12 stored whole preset-list backups. Those old rows have no
        // editor snapshot and are intentionally skipped by the new editor backup system.
        const snapshotSource = raw?.snapshot && typeof raw.snapshot === 'object'
            ? raw.snapshot
            : raw?.editor && typeof raw.editor === 'object'
                ? raw.editor
                : null;
        if (!snapshotSource) return null;

        const createdAt = Number(raw?.createdAt);
        const snapshot = normalizedPromptEditorSnapshot(snapshotSource);
        if (!promptEditorSnapshotHasContent(snapshot)) return null;

        return {
            id: String(raw?.id || `editor_backup_${Date.now()}_${index}`).slice(0, 140),
            createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
            reason: String(raw?.reason || '자동 백업').trim().slice(0, 80) || '자동 백업',
            snapshot,
        };
    })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);
}

function promptEditorBackupSignature(snapshot = currentPromptPresetSnapshot()) {
    return JSON.stringify(normalizedPromptEditorSnapshot(snapshot));
}

function createPromptEditorBackup(reason = '자동 백업', { force = false } = {}) {
    const snapshot = normalizedPromptEditorSnapshot(currentPromptPresetSnapshot());
    const backups = normalizedPromptPresetBackups(settings.promptPresetBackups);

    // Never keep a backup whose four prompt fields are all empty.
    // ON/OFF state by itself is not useful enough to create a backup.
    if (!promptEditorSnapshotHasContent(snapshot)) {
        settings.promptPresetBackups = backups;
        return false;
    }

    const signature = promptEditorBackupSignature(snapshot);

    if (!force && backups[0] && promptEditorBackupSignature(backups[0].snapshot) === signature) {
        return false;
    }

    const backup = {
        id: `prompt_editor_backup_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        createdAt: Date.now(),
        reason: String(reason || '자동 백업').trim().slice(0, 80) || '자동 백업',
        snapshot,
    };
    settings.promptPresetBackups = [backup, ...backups].slice(0, 5);
    return true;
}

function schedulePromptEditorBackup(delay = 10 * 60 * 1000) {
    clearTimeout(promptEditorBackupTimer);
    promptEditorBackupTimer = setTimeout(() => {
        promptEditorBackupTimer = null;
        if (!createPromptEditorBackup('10분 입력 멈춤 자동 백업')) return;
        saveSettings();
        renderPromptPresetBackups();
    }, Math.max(1000, Number(delay) || 10 * 60 * 1000));
}

function formatPromptPresetBackupTime(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    try {
        return date.toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return date.toISOString().slice(5, 16).replace('T', ' ');
    }
}

function promptPresetBackupById(id) {
    const key = String(id || '');
    return normalizedPromptPresetBackups(settings.promptPresetBackups)
        .find(backup => backup.id === key) || null;
}

function applyPromptEditorSnapshot(snapshot) {
    const next = normalizedPromptEditorSnapshot(snapshot);
    settings.globalPrompt = next.globalPrompt;
    settings.globalPromptEnabled = next.globalPromptEnabled;
    settings.allDialoguePrompt = next.allDialoguePrompt;
    settings.allDialoguePromptEnabled = next.allDialoguePromptEnabled;
    settings.dialoguePrompt = next.dialoguePrompt;
    settings.dialoguePromptEnabled = next.dialoguePromptEnabled;
    settings.otherDialoguePrompt = next.otherDialoguePrompt;
    settings.otherDialoguePromptEnabled = next.otherDialoguePromptEnabled;

    const values = {
        '#verba-global-prompt': settings.globalPrompt,
        '#verba-all-dialogue-prompt': settings.allDialoguePrompt,
        '#verba-dialogue-prompt': settings.dialoguePrompt,
        '#verba-other-dialogue-prompt': settings.otherDialoguePrompt,
    };
    for (const [selector, value] of Object.entries(values)) {
        const field = document.querySelector(selector);
        if (field) field.value = value;
    }

    syncPromptSlotUi();
    saveSettings();
    renderPromptConflictInspector();
}

function promptBackupPreviewSlotMarkup(label, text, enabled) {
    return `<section class="verba-backup-preview-slot">
        <div class="verba-backup-preview-slot-head">
            <b>${escapeHtml(label)}</b>
            <span class="verba-backup-preview-state ${enabled ? 'is-on' : 'is-off'}">${enabled ? 'ON' : 'OFF'}</span>
        </div>
        <pre>${escapeHtml(String(text || '').trim() || '(비어 있음)')}</pre>
    </section>`;
}

function togglePromptEditorBackupPreview(row, backup, button) {
    if (!row || !backup?.snapshot) {
        notify('미리볼 프롬프트 백업을 찾지 못했어요.', 'warning');
        return;
    }

    const existing = row.querySelector('.verba-prompt-preset-backup-inline-preview');
    if (existing) {
        existing.remove();
        if (button) button.textContent = '미리보기';
        return;
    }

    // 한 번에 하나의 백업만 펼칩니다.
    document.querySelectorAll('.verba-prompt-preset-backup-inline-preview').forEach(preview => {
        const otherRow = preview.closest('.verba-prompt-preset-backup-row');
        const otherButton = otherRow?.querySelector('.verba-prompt-preset-backup-preview');
        if (otherButton) otherButton.textContent = '미리보기';
        preview.remove();
    });

    const snapshot = normalizedPromptEditorSnapshot(backup.snapshot);
    const preview = document.createElement('div');
    preview.className = 'verba-prompt-preset-backup-inline-preview';
    preview.innerHTML = `
        <div class="verba-backup-inline-preview-head">
            <b>백업 내용</b>
            <small>${escapeHtml(formatPromptPresetBackupTime(backup.createdAt))} · ${escapeHtml(backup.reason)}</small>
        </div>
        <div class="verba-backup-preview-list">
            ${promptBackupPreviewSlotMarkup('전체 번역 전역 프롬프트', snapshot.globalPrompt, snapshot.globalPromptEnabled)}
            ${promptBackupPreviewSlotMarkup('모든 대사 공통 프롬프트', snapshot.allDialoguePrompt, snapshot.allDialoguePromptEnabled)}
            ${promptBackupPreviewSlotMarkup('캐릭터 대사 전용 프롬프트', snapshot.dialoguePrompt, snapshot.dialoguePromptEnabled)}
            ${promptBackupPreviewSlotMarkup('NPC·USER 대사 전용 프롬프트', snapshot.otherDialoguePrompt, snapshot.otherDialoguePromptEnabled)}
        </div>`;

    row.append(preview);
    if (button) button.textContent = '미리보기 닫기';
}

function renderPromptPresetBackups() {
    const list = document.querySelector('#verba-prompt-preset-backup-list');
    const count = document.querySelector('#verba-prompt-preset-backup-count');
    const backups = normalizedPromptPresetBackups(settings.promptPresetBackups);
    settings.promptPresetBackups = backups;

    if (count) count.textContent = `${backups.length}/5`;
    if (!list) return;

    list.innerHTML = backups.length
        ? backups.map(backup => `
            <div class="verba-prompt-preset-backup-row" data-backup-id="${escapeHtml(backup.id)}">
                <div class="verba-prompt-preset-backup-meta">
                    <b>${escapeHtml(formatPromptPresetBackupTime(backup.createdAt))}</b>
                    <small>${escapeHtml(backup.reason)}</small>
                </div>
                <div class="verba-prompt-preset-backup-actions">
                    <button type="button" class="menu_button verba-prompt-preset-backup-preview">미리보기</button>
                    <button type="button" class="menu_button verba-prompt-preset-backup-restore">복원</button>
                    <button type="button" class="menu_button verba-prompt-preset-backup-delete">삭제</button>
                </div>
            </div>
        `).join('')
        : '<div class="verba-prompt-preset-backup-empty">아직 자동 백업이 없어요.</div>';

    list.querySelectorAll('.verba-prompt-preset-backup-preview').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const row = button.closest('[data-backup-id]');
            const backup = promptPresetBackupById(row?.dataset?.backupId);
            if (!backup) {
                notify('미리볼 프롬프트 백업을 찾지 못했어요.', 'warning');
                renderPromptPresetBackups();
                return;
            }
            togglePromptEditorBackupPreview(row, backup, button);
        });
    });

    list.querySelectorAll('.verba-prompt-preset-backup-restore').forEach(button => {
        button.addEventListener('click', () => {
            const row = button.closest('[data-backup-id]');
            const backup = promptPresetBackupById(row?.dataset?.backupId);
            if (!backup) {
                notify('복원할 프롬프트 백업을 찾지 못했어요.', 'warning');
                renderPromptPresetBackups();
                return;
            }
            if (!globalThis.confirm?.(
                `${formatPromptPresetBackupTime(backup.createdAt)} 백업으로 현재 4개 프롬프트를 복원할까요?\n현재 상태는 복원 직전에 한 번 더 백업됩니다.`,
            )) return;

            clearTimeout(promptEditorBackupTimer);
            promptEditorBackupTimer = null;
            createPromptEditorBackup('백업 복원 전', { force: true });
            applyPromptEditorSnapshot(backup.snapshot);
            saveSettings();
            renderPromptPresetBackups();
            notify('현재 프롬프트를 백업 상태로 복원했어요.', 'success');
        });
    });

    list.querySelectorAll('.verba-prompt-preset-backup-delete').forEach(button => {
        button.addEventListener('click', () => {
            const row = button.closest('[data-backup-id]');
            const backup = promptPresetBackupById(row?.dataset?.backupId);
            if (!backup) {
                notify('삭제할 프롬프트 백업을 찾지 못했어요.', 'warning');
                renderPromptPresetBackups();
                return;
            }
            if (!globalThis.confirm?.(
                `${formatPromptPresetBackupTime(backup.createdAt)} 프롬프트 백업을 삭제할까요?`,
            )) return;

            settings.promptPresetBackups = normalizedPromptPresetBackups(settings.promptPresetBackups)
                .filter(item => item.id !== backup.id);
            saveSettings();
            renderPromptPresetBackups();
            notify('프롬프트 백업을 삭제했어요.', 'success');
        });
    });
}

function promptPresetById(id) {
    const key = String(id || '');
    return normalizedPromptPresets().find(preset => preset.id === key) || null;
}

function promptPresetDuplicateName(baseName, rows = normalizedPromptPresets()) {
    const base = normalizedPromptPresetName(baseName) || '프롬프트 프리셋';
    const used = new Set((rows || []).map(row => String(row?.name || '').toLocaleLowerCase()));
    const first = normalizedPromptPresetName(`${base} 복사본`);
    if (first && !used.has(first.toLocaleLowerCase())) return first;

    for (let index = 2; index <= 999; index += 1) {
        const suffix = ` 복사본 ${index}`;
        const trimmedBase = base.slice(0, Math.max(1, 60 - suffix.length)).trim();
        const candidate = normalizedPromptPresetName(`${trimmedBase}${suffix}`);
        if (candidate && !used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return normalizedPromptPresetName(`${base.slice(0, 42)} ${Date.now()}`);
}

function promptPresetDisplayRows() {
    return normalizedPromptPresets()
        .map((preset, index) => ({ preset, index }))
        .sort((left, right) => {
            const favoriteDiff = Number(right.preset.favorite === true) - Number(left.preset.favorite === true);
            return favoriteDiff || left.index - right.index;
        })
        .map(entry => entry.preset);
}

function promptPresetSelectMarkup(selectedId = '') {
    const selected = String(selectedId || '');
    const rows = promptPresetDisplayRows();
    return [
        '<option value="">저장된 프롬프트 프리셋 선택</option>',
        ...rows.map(preset => (
            `<option value="${escapeHtml(preset.id)}" ${preset.id === selected ? 'selected' : ''}>${preset.favorite ? '★ ' : ''}${escapeHtml(preset.name)}</option>`
        )),
    ].join('');
}

function renderPromptPresetManager(selectedId = '') {
    const select = document.querySelector('#verba-prompt-preset-select');
    if (!select) return;
    const keep = selectedId || select.value;
    select.innerHTML = promptPresetSelectMarkup(keep);
    if (keep && [...select.options].some(option => option.value === keep)) select.value = keep;

    const count = document.querySelector('#verba-prompt-preset-count');
    if (count) count.textContent = `${normalizedPromptPresets().length}개 저장`;

    const selectedPreset = promptPresetById(select.value);
    const hasSelection = Boolean(selectedPreset);
    [
        '#verba-prompt-preset-rename',
        '#verba-prompt-preset-duplicate',
        '#verba-prompt-preset-favorite',
        '#verba-prompt-preset-delete',
    ].forEach(selector => {
        const button = document.querySelector(selector);
        if (button) button.disabled = !hasSelection;
    });

    const favoriteButton = document.querySelector('#verba-prompt-preset-favorite');
    if (favoriteButton) {
        favoriteButton.textContent = selectedPreset?.favorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기';
        favoriteButton.classList.toggle('is-favorite', selectedPreset?.favorite === true);
    }

    renderPromptPresetBackups();
}

function syncPromptSlotUi() {
    const slots = [
        ['global', 'globalPromptEnabled'],
        ['all-dialogue', 'allDialoguePromptEnabled'],
        ['dialogue', 'dialoguePromptEnabled'],
        ['other-dialogue', 'otherDialoguePromptEnabled'],
    ];
    for (const [slot, key] of slots) {
        const wrapper = document.querySelector(`[data-verba-prompt-slot="${slot}"]`);
        const checkbox = document.querySelector(`#verba-${slot}-prompt-enabled`);
        const enabled = settings[key] !== false;
        if (wrapper) wrapper.classList.toggle('verba-prompt-slot-off', !enabled);
        if (checkbox) {
            checkbox.checked = enabled;
            const label = checkbox.closest('.verba-prompt-slot-toggle')?.querySelector('span');
            if (label) label.textContent = enabled ? 'ON' : 'OFF';
        }
    }
}

function setPromptFieldsFromPreset(preset) {
    if (!preset) return;
    settings.globalPrompt = String(preset.globalPrompt || '');
    settings.globalPromptEnabled = preset.globalPromptEnabled !== false;
    settings.allDialoguePrompt = String(preset.allDialoguePrompt || '');
    settings.allDialoguePromptEnabled = preset.allDialoguePromptEnabled !== false;
    settings.dialoguePrompt = String(preset.dialoguePrompt || '');
    settings.dialoguePromptEnabled = preset.dialoguePromptEnabled !== false;
    settings.otherDialoguePrompt = String(preset.otherDialoguePrompt || '');
    settings.otherDialoguePromptEnabled = preset.otherDialoguePromptEnabled !== false;

    const values = {
        '#verba-global-prompt': settings.globalPrompt,
        '#verba-all-dialogue-prompt': settings.allDialoguePrompt,
        '#verba-dialogue-prompt': settings.dialoguePrompt,
        '#verba-other-dialogue-prompt': settings.otherDialoguePrompt,
    };
    for (const [selector, value] of Object.entries(values)) {
        const field = document.querySelector(selector);
        if (field) field.value = value;
    }
    syncPromptSlotUi();
    saveSettings();
    renderPromptConflictInspector();
}

function optionLabel(options, value, fallback = '기본') {
    return options.find(option => option.value === value)?.label || fallback;
}

function compactLines(value) {
    return String(value || '')
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(Boolean);
}

function currentRulesPromptSlotMarkup(label, text, enabled) {
    const content = String(text || '').trim();
    const actuallyApplied = enabled && Boolean(content);
    const state = !enabled ? 'OFF · 제외' : content ? 'ON · 적용' : 'ON · 비어 있음';
    return `<section class="verba-current-rule-card ${actuallyApplied ? 'is-active' : 'is-muted'}">
        <div class="verba-current-rule-card-head">
            <b>${escapeHtml(label)}</b>
            <span>${escapeHtml(state)}</span>
        </div>
        ${content ? `<pre>${escapeHtml(content)}</pre>` : ''}
    </section>`;
}

function currentRulesSimpleCard(title, rows = []) {
    const valid = rows.filter(row => row && row[1] !== undefined && row[1] !== null && String(row[1]) !== '');
    return `<section class="verba-current-rule-card">
        <div class="verba-current-rule-card-head"><b>${escapeHtml(title)}</b></div>
        <div class="verba-current-rule-lines">
            ${valid.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}
        </div>
    </section>`;
}

function renderCurrentAppliedRules() {
    const host = document.querySelector('#verba-current-rules-content');
    if (!host) return;

    const relationEnabled = settings.relationTemperatureEnabled !== false;
    const relationLabel = optionLabel(RELATION_TEMPERATURE_OPTIONS, settings.relationTemperature);
    const narrationLocalization = optionLabel(LOCALIZATION_LEVEL_OPTIONS, settings.narrationLocalizationLevel);
    const dialogueLocalization = optionLabel(LOCALIZATION_LEVEL_OPTIONS, settings.dialogueLocalizationLevel);

    const emphasisLabels = {
        default: '기본 · 추가 지시 없음',
        source: '원문대로',
        natural: '자연스럽게',
        active: '적극적으로',
    };
    const disfluencyLabels = {
        default: '기본 · 추가 지시 없음',
        clean: '정리해서 번역',
        natural: '자연스럽게 보존',
        active: '적극 보존',
    };
    const idiomLabels = {
        default: '기본 · 추가 지시 없음',
        meaning: '뜻 중심',
        balanced: '균형',
        koreanized: '한국식 네이티브화',
        sourceCulture: '원문화·비유 결 보존',
    };

    const koreanRhythm = { default: '기본', short: '짧고 툭툭', balanced: '자연스러운 보통', smooth: '길고 매끄럽게' };
    const koreanPronoun = { default: '기본', preserve: '원문 지칭 비교적 유지', natural: '자연스러우면 생략', active: '한국어답게 적극 생략' };
    const koreanProfanity = { default: '기본', dry: '건조하게', blunt: '직설적·거칠게', lowSlang: '인터넷식 표현 적게', restrained: '비속어 최소화' };
    const interjection = { default: '기본', natural: '자연스럽게', restrained: '담백하게', lively: '생동감 있게' };
    const meme = { default: '기본', light: '살짝', natural: '자연스럽게', active: '적극적으로' };

    const englishRhythm = { default: '기본', short: '짧고 툭툭', balanced: '자연스러운 보통', smooth: '길고 매끄럽게' };
    const englishConversation = { default: '기본', natural: '자연스럽게', active: '적극적으로' };
    const englishSlang = { default: '기본', low: '적게', natural: '자연스럽게', active: '적극적으로' };
    const englishProfanity = { default: '기본', dry: '건조하게', blunt: '직설적·거칠게', everyday: '일상적인 영어권 느낌', lowSlang: '인터넷·밈식 표현 적게', restrained: '비속어 최소화' };

    const endingPreferred = compactLines(settings.dialogueEndingPreferred);
    const endingAvoid = compactLines(settings.dialogueEndingAvoid);
    const banned = compactLines(settings.bannedWords);
    const priority = normalizeTranslationRuleOrder(settings.translationRuleOrder)
        .map(key => TRANSLATION_RULE_DEFINITIONS.find(item => item.key === key)?.label || key)
        .join(' → ');

    host.innerHTML = `
        <div class="verba-current-rules-note">현재 저장값을 기준으로 실제 번역에 적용되는 사용자 규칙을 정리해서 보여줍니다. API 호출은 하지 않습니다.</div>

        <div class="verba-current-rule-grid">
            ${currentRulesPromptSlotMarkup('전체 번역 전역 프롬프트', settings.globalPrompt, settings.globalPromptEnabled !== false)}
            ${currentRulesPromptSlotMarkup('모든 대사 공통 프롬프트', settings.allDialoguePrompt, settings.allDialoguePromptEnabled !== false)}
            ${currentRulesPromptSlotMarkup('캐릭터 대사 전용 프롬프트', settings.dialoguePrompt, settings.dialoguePromptEnabled !== false)}
            ${currentRulesPromptSlotMarkup('NPC·USER 대사 전용 프롬프트', settings.otherDialoguePrompt, settings.otherDialoguePromptEnabled !== false)}

            ${currentRulesSimpleCard('관계·현지화', [
                ['상태', relationEnabled ? 'ON' : 'OFF'],
                ['관계 온도', relationEnabled ? relationLabel : '적용 안 함'],
                ['서술 현지화', relationEnabled ? narrationLocalization : '적용 안 함'],
                ['대사 현지화', relationEnabled ? dialogueLocalization : '적용 안 함'],
            ])}

            ${currentRulesSimpleCard('대사 말끝 취향 · 캐릭터 대사', [
                ['선호 표현', endingPreferred.length ? endingPreferred.join(' / ') : '없음'],
                ['회피 표현', endingAvoid.length ? endingAvoid.join(' / ') : '없음'],
                ['적용 강도', ({ light: '약하게', normal: '보통', strong: '강하게' })[settings.dialogueEndingStrength] || '보통'],
                ['반복 줄이기', settings.dialogueEndingRepetitionReduction !== false ? 'ON' : 'OFF'],
            ])}

            ${currentRulesSimpleCard('표현 디테일', [
                ['강조 표현', emphasisLabels[settings.expressionEmphasisTaste] || '기본 · 추가 지시 없음'],
                ['말더듬·늘임·끊김', disfluencyLabels[settings.expressionDisfluencyTaste] || '기본 · 추가 지시 없음'],
                ['관용구·비유', idiomLabels[settings.expressionIdiomMetaphorTaste] || '기본 · 추가 지시 없음'],
            ])}

            ${currentRulesSimpleCard('한캐의 맛', settings.koreanFlavorEnabled === true ? [
                ['상태', 'ON'],
                ['대사 호흡', koreanRhythm[settings.koreanFlavorDialogueRhythm] || '기본'],
                ['주어·대명사', koreanPronoun[settings.koreanFlavorPronounOmission] || '기본'],
                ['욕설 결', koreanProfanity[settings.koreanFlavorProfanityTone] || '기본'],
                ['감탄사', interjection[settings.koreanFlavorInterjectionTone] || '기본'],
                ['인터넷 밈', meme[settings.koreanFlavorMemeDensity] || '기본'],
                ['반복 지칭 줄이기', settings.koreanFlavorReduceReferentRepetition !== false ? 'ON' : 'OFF'],
            ] : [['상태', 'OFF']])}

            ${currentRulesSimpleCard('영캐의 맛', settings.englishFlavorEnabled === true ? [
                ['상태', 'ON'],
                ['대사 호흡', englishRhythm[settings.englishFlavorDialogueRhythm] || '기본'],
                ['영어권 회화 자연화', englishConversation[settings.englishFlavorConversationNaturalization] || '기본'],
                ['슬랭·구어체', englishSlang[settings.englishFlavorSlangDensity] || '기본'],
                ['욕설 결', englishProfanity[settings.englishFlavorProfanityTone] || '기본'],
                ['감탄사', interjection[settings.englishFlavorInterjectionTone] || '기본'],
                ['인터넷 밈', meme[settings.englishFlavorMemeDensity] || '기본'],
                ['지칭 반복 줄이기', settings.englishFlavorReduceReferentRepetition !== false ? 'ON' : 'OFF'],
            ] : [['상태', 'OFF']])}

            ${currentRulesSimpleCard('기타 적용 규칙', [
                ['금지어', banned.length ? `${banned.length}개 · ${banned.join(' / ')}` : '없음'],
                ['우선순위', priority],
                ['품질 검수 실험실', settings.qualityAuditEnabled === true ? 'ON' : 'OFF'],
            ])}
        </div>`;
}

function currentCharacterReference() {
    const context = liveContext();
    if (context.characterId === undefined || context.characterId === null || context.characterId === '') return null;
    const characterId = Number(context.characterId);
    if (!Number.isInteger(characterId) || characterId < 0) return null;
    const character = context.characters?.[characterId];
    return character ? { context, characterId, character } : null;
}

function allCharacterNameLockGroups() {
    const context = liveContext();
    const characters = Array.isArray(context.characters) ? context.characters : [];
    return characters.flatMap((character, characterId) => {
        if (!character) return [];
        const rows = normalizedCharacterNameLocks(character);
        if (!rows.length) return [];
        return [{
            reference: { context, characterId, character },
            characterName: String(character.name ?? character.data?.name ?? `캐릭터 ${characterId + 1}`),
            rows,
        }];
    });
}

function normalizedCharacterNameLocks(character = currentCharacterReference()?.character) {
    const rows = character?.data?.extensions?.[CHARACTER_FIELD_KEY]?.nameLocks;
    if (!Array.isArray(rows)) return [];
    const result = [];
    const seen = new Set();
    for (const row of rows) {
        const source = String(row?.source || '').trim();
        const target = String(row?.target || '').trim();
        if (!source || !target || source.length > 120 || target.length > 120) continue;
        const key = source.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ source, target });
    }
    return result;
}

async function writeCharacterNameLocks(reference, rows) {
    if (!reference) throw new Error('개별 캐릭터 채팅에서만 이름을 고정할 수 있습니다.');
    if (typeof reference.context.writeExtensionField !== 'function') {
        throw new Error('현재 SillyTavern에서 캐릭터 확장 데이터 저장을 지원하지 않습니다.');
    }

    const existing = reference.character.data?.extensions?.[CHARACTER_FIELD_KEY];
    const field = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...existing }
        : {};
    field.nameLocks = rows;
    await reference.context.writeExtensionField(reference.characterId, CHARACTER_FIELD_KEY, field);

    if (!reference.character.data || typeof reference.character.data !== 'object') reference.character.data = {};
    if (!reference.character.data.extensions || typeof reference.character.data.extensions !== 'object') {
        reference.character.data.extensions = {};
    }
    reference.character.data.extensions[CHARACTER_FIELD_KEY] = field;
}

async function saveCharacterNameLock(source, target, reference = currentCharacterReference()) {
    if (!reference) throw new Error('개별 캐릭터 채팅에서만 이름을 고정할 수 있습니다.');
    const sourceName = String(source || '').trim();
    const targetName = String(target || '').trim();
    if (!sourceName || !targetName) throw new Error('원문 이름과 고정 표기를 모두 입력해 주세요.');
    if (sourceName.length > 120 || targetName.length > 120 || /[\r\n]/.test(sourceName + targetName)) {
        throw new Error('이름은 줄바꿈 없이 120자 이내로 입력해 주세요.');
    }

    const rows = normalizedCharacterNameLocks(reference.character)
        .filter(row => row.source.toLocaleLowerCase() !== sourceName.toLocaleLowerCase());
    rows.push({ source: sourceName, target: targetName });
    await writeCharacterNameLocks(reference, rows);
}

async function deleteCharacterNameLock(source, reference = currentCharacterReference()) {
    const sourceName = String(source || '').trim();
    if (!sourceName) throw new Error('삭제할 원문 이름이 없습니다.');
    const rows = normalizedCharacterNameLocks(reference?.character)
        .filter(row => row.source.toLocaleLowerCase() !== sourceName.toLocaleLowerCase());
    await writeCharacterNameLocks(reference, rows);
}

function scheduleChatSave(chatReference) {
    clearTimeout(chatSaveTimer);
    chatSaveTimer = setTimeout(() => {
        chatSaveTimer = null;
        const context = liveContext();
        if (context.chat !== chatReference) return;
        try {
            context.saveChat?.()?.catch?.(error => console.warn('[베르바] 채팅 저장 실패', error));
        } catch (error) {
            console.warn('[베르바] 채팅 저장 실패', error);
        }
    }, 250);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function normalizedTranslationTuning(value = {}) {
    const relationTemperatureEnabled = typeof value.relationTemperatureEnabled === 'boolean'
        ? value.relationTemperatureEnabled
        : settings.relationTemperatureEnabled !== false;
    const relationTemperature = RELATION_TEMPERATURE_OPTIONS.some(option => option.value === value.relationTemperature)
        ? value.relationTemperature
        : settings.relationTemperature;
    const legacyLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === value.localizationLevel)
        ? value.localizationLevel
        : null;
    const narrationLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === value.narrationLocalizationLevel)
        ? value.narrationLocalizationLevel
        : legacyLocalizationLevel || settings.narrationLocalizationLevel;
    const dialogueLocalizationLevel = LOCALIZATION_LEVEL_OPTIONS.some(option => option.value === value.dialogueLocalizationLevel)
        ? value.dialogueLocalizationLevel
        : legacyLocalizationLevel || settings.dialogueLocalizationLevel;
    return {
        relationTemperatureEnabled,
        relationTemperature,
        narrationLocalizationLevel,
        dialogueLocalizationLevel,
    };
}

function tuningChoiceMarkup(name, options, selected) {
    return `<div class="verba-tuning-options" role="radiogroup">
        ${options.map(option => `
            <label>
                <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}" ${option.value === selected ? 'checked' : ''}>
                <span>${escapeHtml(option.label)}</span>
            </label>
        `).join('')}
    </div>`;
}

function normalizeTranslationRuleOrder(value) {
    const allowed = new Set(DEFAULT_TRANSLATION_RULE_ORDER);
    const ordered = [];
    for (const key of Array.isArray(value) ? value : []) {
        const normalized = String(key || '');
        if (!allowed.has(normalized) || ordered.includes(normalized)) continue;
        ordered.push(normalized);
    }
    for (const key of DEFAULT_TRANSLATION_RULE_ORDER) {
        if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
}

function renderTranslationRuleOrder() {
    const host = document.querySelector('#verba-rule-priority-list');
    if (!host) return;
    settings.translationRuleOrder = normalizeTranslationRuleOrder(settings.translationRuleOrder);
    host.innerHTML = settings.translationRuleOrder.map((key, index, order) => {
        const definition = TRANSLATION_RULE_DEFINITIONS.find(item => item.key === key);
        return `<div class="verba-rule-priority-row" data-rule-key="${escapeHtml(key)}">
            <b>${index + 1}</b>
            <span>${escapeHtml(definition?.label || key)}</span>
            <div class="verba-rule-priority-actions">
                <button type="button" class="menu_button verba-rule-move-up" aria-label="위로 이동" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="menu_button verba-rule-move-down" aria-label="아래로 이동" ${index === order.length - 1 ? 'disabled' : ''}>↓</button>
            </div>
        </div>`;
    }).join('');
}

function emptyProfileStat() {
    return {
        requests: 0,
        successes: 0,
        failures: 0,
        totalMs: 0,
        retries: 0,
        fallbacks: 0,
        outputJobs: 0,
        outputSuccesses: 0,
        outputFailures: 0,
        outputTotalMs: 0,
        lastOutputMs: 0,
    };
}

function normalizeProfileStats(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(['A', 'B', 'C'].map(slot => {
        const raw = source[slot] && typeof source[slot] === 'object' ? source[slot] : {};
        const stat = emptyProfileStat();
        for (const key of Object.keys(stat)) {
            stat[key] = Math.max(0, Number(raw[key]) || 0);
        }
        return [slot, stat];
    }));
}

function profileSlotForId(profileId) {
    const id = String(profileId || '');
    return configuredProfiles().find(profile => profile.id === id)?.slot || 'A';
}

function recordProfileAttempt(slot, { success, elapsedMs, retry = false, fallback = false } = {}) {
    const normalizedSlot = ['A', 'B', 'C'].includes(slot) ? slot : 'A';
    settings.profileStats = normalizeProfileStats(settings.profileStats);
    const stat = settings.profileStats[normalizedSlot];
    stat.requests += 1;
    stat.totalMs += Math.max(0, Math.round(Number(elapsedMs) || 0));
    if (success) stat.successes += 1;
    else stat.failures += 1;
    if (retry) stat.retries += 1;
    // '대체'는 대체 프로필을 시도한 횟수가 아니라, 실제로 성공해
    // 번역 응답으로 사용된 횟수만 집계한다.
    if (fallback && success) stat.fallbacks += 1;
    saveSettings();
    renderProfileStats();
}

function recordOutputTranslation(slot, { success, elapsedMs } = {}) {
    const normalizedSlot = ['A', 'B', 'C'].includes(slot) ? slot : 'A';
    settings.profileStats = normalizeProfileStats(settings.profileStats);
    const stat = settings.profileStats[normalizedSlot];
    const measuredMs = Math.max(0, Math.round(Number(elapsedMs) || 0));
    stat.outputJobs += 1;
    stat.outputTotalMs += measuredMs;
    stat.lastOutputMs = measuredMs;
    if (success) stat.outputSuccesses += 1;
    else stat.outputFailures += 1;
    saveSettings();
    renderProfileStats();
}

async function copyText(value) {
    const text = String(value ?? '');
    let clipboardError = null;
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (error) {
            clipboardError = error;
        }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = '0';
    textarea.style.opacity = '0.01';
    textarea.style.pointerEvents = 'none';
    textarea.style.fontSize = '16px';
    document.documentElement.append(textarea);
    try {
        textarea.focus({ preventScroll: true });
    } catch {
        textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    let copied = false;
    try {
        copied = Boolean(document.execCommand?.('copy'));
    } catch {
        copied = false;
    }
    textarea.remove();
    if (!copied) {
        throw new Error(
            clipboardError
                ? `클립보드 권한이 거부되었고 호환 복사도 실패했습니다: ${errorText(clipboardError)}`
                : '클립보드 복사를 지원하지 않는 환경입니다.',
        );
    }
}

function renderProfileStats() {
    const content = document.querySelector('#verba-profile-stats-content');
    if (!content) return;
    settings.profileStats = normalizeProfileStats(settings.profileStats);
    content.innerHTML = ['A', 'B', 'C'].map(slot => {
        const stat = settings.profileStats[slot];
        const successRate = stat.requests ? Math.round((stat.successes / stat.requests) * 100) : 0;
        const outputAverageSeconds = stat.outputJobs ? stat.outputTotalMs / stat.outputJobs / 1000 : 0;
        const outputAverageLabel = stat.outputJobs
            ? `${outputAverageSeconds.toLocaleString('ko-KR', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
            })}초`
            : '—';
        const profile = configuredProfiles().find(candidate => candidate.slot === slot);
        const name = profile ? profileDisplayName(profile.id) : '미설정';
        return `<div class="verba-stat-row">
            <b>${slot}</b>
            <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <small>요청 ${stat.requests} · 성공 ${successRate}% · 평균 ${outputAverageLabel} · 재시도 ${stat.retries} · 대체 ${stat.fallbacks}</small>
        </div>`;
    }).join('');
}

function normalizedMessageId(payload) {
    const value = typeof payload === 'object' && payload !== null
        ? payload.messageId ?? payload.id ?? payload.mesId
        : payload;
    const id = Number(value);
    return Number.isInteger(id) ? id : -1;
}

function profileList() {
    const raw = liveContext().extensionSettings?.connectionManager?.profiles;
    const profiles = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    return profiles.filter(Boolean).map((profile, index) => ({
        id: String(profile.id ?? profile.profileId ?? index),
        name: String(profile.name ?? profile.display_name ?? profile.id ?? `프로필 ${index + 1}`),
    }));
}

function fillProfileSelect(select, selectedId, placeholder) {
    if (!select) return;
    const profiles = profileList();
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + profiles
        .map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)
        .join('');
    if (selectedId && !profiles.some(profile => profile.id === String(selectedId))) {
        select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(selectedId)}">저장된 프로필을 찾을 수 없음</option>`);
    }
    select.value = String(selectedId || '');
}

function refreshProfileSelect() {
    fillProfileSelect(
        document.querySelector('#verba-profile'),
        settings.profileId,
        '연결 프로필을 선택하세요',
    );
    fillProfileSelect(
        document.querySelector('#verba-fallback-profile'),
        settings.fallbackProfileId,
        '프로필 B를 사용하지 않음',
    );
    fillProfileSelect(
        document.querySelector('#verba-third-profile'),
        settings.thirdProfileId,
        '프로필 C를 사용하지 않음',
    );
    refreshProfileToggleButton();
    renderProfileStats();
}

function enqueueRequest(task) {
    const run = requestTail.then(task, task);
    requestTail = run.catch(() => {});
    return run;
}

function drainScopedParallelRequestQueue() {
    while (
        scopedParallelRequestActive < SCOPED_PARALLEL_REQUEST_LIMIT
        && scopedParallelRequestQueue.length
    ) {
        const item = scopedParallelRequestQueue.shift();
        scopedParallelRequestActive += 1;

        Promise.resolve()
            .then(item.task)
            .then(item.resolve, item.reject)
            .finally(() => {
                scopedParallelRequestActive = Math.max(0, scopedParallelRequestActive - 1);
                drainScopedParallelRequestQueue();
            });
    }
}

function enqueueScopedParallelRequest(task) {
    return new Promise((resolve, reject) => {
        scopedParallelRequestQueue.push({ task, resolve, reject });
        drainScopedParallelRequestQueue();
    });
}

async function runWithConcurrency(items, limit, worker) {
    const rows = Array.from(items || []);
    if (!rows.length) return [];
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, rows.length));
    const results = new Array(rows.length);
    let nextIndex = 0;

    const runners = Array.from({ length: concurrency }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= rows.length) return;
            results[index] = await worker(rows[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}

function setBoundedCache(cache, key, value, limit = 80) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

function transientError(error) {
    const text = errorText(error).toLowerCase();
    if (/\b(?:400|401|403|404|413|422)\b|bad request|invalid request|invalid api|unauthori[sz]ed|forbidden|authentication|permission|billing|credit|payment|insufficient[_ -]?(?:quota|credit|funds?)|context length|maximum context|too (?:large|long)|model.*(?:not found|may not exist)|safety|blocked|content.?filter|권한|인증|결제|크레딧|잔액|컨텍스트.*초과/.test(text)) {
        return false;
    }
    return /\b(?:408|425|429|500|502|503|504)\b|resource exhausted|rate.?limit|too many requests|requests per minute|\brpm\b|\btpm\b|quota|overload|capacity|at capacity|server (?:is )?busy|temporar(?:y|ily) unavailable|try again later|internal server error|bad gateway|service unavailable|gateway timeout|upstream|timed? out|timeout|econnreset|econnrefused|connection reset|connection refused|network error|fetch failed|socket hang up|empty response|no response|빈 응답|응답 대기 시간.*초과|시간 초과|네트워크.*(?:오류|실패)|연결.*(?:재설정|실패)|서버.*(?:혼잡|과부하)|일시적.*(?:오류|실패)/.test(text);
}

function retryAfterHeader(headers) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get('retry-after') ?? headers.get('Retry-After');
    if (typeof headers === 'object') return headers['retry-after'] ?? headers['Retry-After'];
    return null;
}

function retryAfterMs(error) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        seen.add(current);
        const candidates = [
            current.retryAfter,
            current.retry_after,
            retryAfterHeader(current.headers),
            retryAfterHeader(current.response?.headers),
        ];
        for (const candidate of candidates) {
            if (candidate === undefined || candidate === null || candidate === '') continue;
            const numeric = Number(candidate);
            const parsed = Number.isFinite(numeric) && numeric >= 0
                ? Math.round(numeric * 1000)
                : Math.max(0, Date.parse(String(candidate)) - Date.now());
            if (Number.isFinite(parsed) && parsed > 0) return Math.min(120000, Math.max(1000, parsed));
        }
        current = current.cause;
    }
    return 0;
}

function abortError() {
    return new DOMException('번역 요청이 중단되었습니다.', 'AbortError');
}

function outputAbortReason(code, message, silent = true) {
    return {
        name: 'AbortError',
        verbaCode: String(code || 'VERBA_OUTPUT_ABORTED'),
        message: String(message || '출력 번역이 중단되었습니다.'),
        silent: Boolean(silent),
    };
}

function abortPendingOutput(messageId, reason) {
    const pending = pendingOutputs.get(Number(messageId));
    if (!pending || pending.controller.signal.aborted) return;
    pending.controller.abort(reason || outputAbortReason(
        'VERBA_OUTPUT_ABORTED',
        '출력 번역이 중단되었습니다.',
        false,
    ));
}

function wait(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

async function sendProfileRequest(prompt, options = {}) {
    const profileId = String(options.profileId ?? settings.profileId ?? '');
    if (!profileId) throw new Error('번역기 전용 연결 프로필을 선택해 주세요.');
    const profileSlot = String(options.profileSlot || profileSlotForId(profileId));
    const availableProfiles = profileList();
    if (availableProfiles.length && !availableProfiles.some(profile => profile.id === profileId)) {
        throw new Error(`프로필 ${profileSlot}의 저장된 연결 프로필을 찾을 수 없습니다. 새로고침 후 다시 선택해 주세요.`);
    }
    const startedAt = performance.now();
    let attemptSucceeded = false;
    let attemptError = null;
    const outerSignal = options.signal || null;
    if (outerSignal?.aborted) throw abortError();

    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    outerSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    const timeoutSeconds = Math.min(300, Math.max(20, Number(settings.timeoutSeconds) || 120));
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutSeconds * 1000);

    try {
        const executeRequest = async () => {
            if (controller.signal.aborted) throw abortError();
            const service = liveContext().ConnectionManagerRequestService;
            if (!service?.sendRequest) throw new Error('실리태번 연결 관리자 요청 기능을 찾을 수 없습니다.');
            const response = await service.sendRequest(
                profileId,
                [{ role: 'user', content: prompt }],
                Math.min(32768, Math.max(512, Number(settings.maxTokens) || 15000)),
                { signal: controller.signal },
            );
            if (!extractResponseText(response).trim()) throw new Error('AI가 빈 응답을 반환했습니다.');
            attemptSucceeded = true;
            return response;
        };

        return await (
            options.parallelRequest === true
                ? enqueueScopedParallelRequest(executeRequest)
                : enqueueRequest(executeRequest)
        );
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error(`응답 대기 시간 ${timeoutSeconds}초를 초과했습니다.`);
            timeoutError.code = 'VERBA_TIMEOUT';
            timeoutError.cause = error;
            attemptError = timeoutError;
            throw timeoutError;
        }
        if (controller.signal.aborted) {
            attemptError = abortError();
            throw attemptError;
        }
        attemptError = error;
        throw error;
    } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener?.('abort', forwardAbort);
        recordProfileAttempt(profileSlot, {
            success: attemptSucceeded,
            elapsedMs: performance.now() - startedAt,
            retry: Number(options.retryAttempt) > 0,
            fallback: Boolean(options.fallback),
            error: attemptError,
            stage: options.stage || 'request',
        });
    }
}

function fallbackEligibleError(error) {
    // A fallback profile is useful only for temporary server/network/quota
    // failures. Authentication, invalid project/profile, billing, model and
    // request errors must stay on the selected profile so an unrelated old
    // B/C credential cannot hide the real cause.
    return transientError(error);
}

function activeProfileSlot() {
    const configured = configuredProfiles();
    const requested = String(settings.activeProfileSlot || 'A');
    return configured.some(profile => profile.slot === requested) ? requested : 'A';
}

function configuredProfiles() {
    const candidates = [
        { slot: 'A', id: String(settings.profileId || '') },
        { slot: 'B', id: String(settings.fallbackProfileId || '') },
        { slot: 'C', id: String(settings.thirdProfileId || '') },
    ];
    const seen = new Set();
    return candidates.filter(profile => {
        if (!profile.id || seen.has(profile.id)) return false;
        seen.add(profile.id);
        return true;
    });
}

function configuredProfileCycle() {
    const configured = configuredProfiles();
    const slot = activeProfileSlot();
    const activeIndex = Math.max(0, configured.findIndex(profile => profile.slot === slot));
    const ordered = configured.slice(activeIndex).concat(configured.slice(0, activeIndex));
    return {
        slot: ordered[0]?.slot || 'A',
        active: ordered[0]?.id || '',
        fallbacks: settings.autoProfileFallback !== false ? ordered.slice(1) : [],
    };
}

function profileDisplayName(profileId) {
    return profileList().find(profile => profile.id === String(profileId))?.name || '보조 프로필';
}

let lastFallbackNoticeAt = 0;

function notifyFallbackUsed(profileId) {
    const now = Date.now();
    if (now - lastFallbackNoticeAt < 8000) return;
    lastFallbackNoticeAt = now;
    notify(`현재 프로필 연결 실패로 다른 프로필 “${profileDisplayName(profileId)}”을 사용했어요.`, 'warning');
}

async function sendWithRetry(prompt, options = {}) {
    const transientDelays = [3000, 5000, 8000, 12000, 18000];
    const generalDelays = [800, 1200, 1800, 2600, 4000];
    const maxRetries = 5;
    const token = Symbol('verba-translation-retry');
    const outerSignal = options.signal || null;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (outerSignal) {
        if (outerSignal.aborted) forwardAbort();
        else outerSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    const requestOptions = { ...options, signal: controller.signal };
    let lastError;

    try {
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            if (controller.signal.aborted) throw abortError();

            const profiles = configuredProfileCycle();
            const primaryProfileId = profiles.active;

            try {
                return await sendProfileRequest(prompt, {
                    ...requestOptions,
                    profileId: primaryProfileId,
                    profileSlot: profiles.slot,
                    retryAttempt: attempt,
                    fallback: false,
                });
            } catch (primaryError) {
                if (isAbort(primaryError, controller.signal)) throw primaryError;

                let cycleError = primaryError;
                const errors = [primaryError];

                // Existing fallback-profile policy stays conservative:
                // only temporary server/network/quota errors use B/C profiles.
                // But the active profile itself is retried for EVERY non-abort
                // failure, as requested.
                if (profiles.fallbacks.length && fallbackEligibleError(primaryError)) {
                    for (const fallback of profiles.fallbacks) {
                        console.warn(
                            `[베르바] 현재 선택 프로필 실패 — 프로필 ${fallback.slot} ${profileDisplayName(fallback.id)}(으)로 임시 전환`,
                            errors.at(-1),
                        );
                        try {
                            const response = await sendProfileRequest(prompt, {
                                ...requestOptions,
                                profileId: fallback.id,
                                profileSlot: fallback.slot,
                                retryAttempt: attempt,
                                fallback: true,
                            });
                            notifyFallbackUsed(fallback.id);
                            return response;
                        } catch (fallbackError) {
                            if (isAbort(fallbackError, controller.signal)) throw fallbackError;
                            console.warn(`[베르바] 연결 프로필 ${fallback.slot} 요청도 실패했습니다.`, fallbackError);
                            errors.push(fallbackError);
                        }
                    }
                    cycleError = [...errors].reverse().find(transientError) || errors.at(-1);
                }

                lastError = cycleError;
                if (attempt === maxRetries) break;

                const transient = transientError(cycleError);
                const fallbackDelay = transient
                    ? transientDelays[attempt]
                    : generalDelays[attempt];
                const delay = transient
                    ? (retryAfterMs(cycleError) || fallbackDelay)
                    : fallbackDelay;

                const state = {
                    controller,
                    retryCount: attempt + 1,
                    maxRetries,
                    delayMs: delay,
                    updatedAt: Date.now(),
                    transient,
                };
                serverRetryStates.set(token, state);
                updateServerRetryIndicator();

                console.warn(
                    `[베르바] 번역 요청 실패 — ${state.retryCount}/${state.maxRetries}회 재시도 예정`,
                    cycleError,
                );

                await wait(delay, controller.signal);
                state.delayMs = 0;
                state.updatedAt = Date.now();
                updateServerRetryIndicator();
            }
        }

        throw new Error(
            `번역 자동 재시도 ${maxRetries}회를 모두 사용했습니다: ${errorText(lastError)}`,
            { cause: lastError || undefined },
        );
    } finally {
        serverRetryStates.delete(token);
        updateServerRetryIndicator();
        outerSignal?.removeEventListener?.('abort', forwardAbort);
    }
}

function collectPartialSegmentTranslations(raw, expectedSegments) {
    const partial = new Map();
    let parseError = null;

    for (const segment of expectedSegments || []) {
        try {
            const one = parseSegmentResponse(raw, [segment]);
            const value = String(one.get(segment.id) || '');
            if (value.trim()) partial.set(segment.id, value);
        } catch (error) {
            parseError ||= error;
        }
    }

    return { partial, parseError };
}

async function requestSegments(prompt, expectedSegments, options = {}) {
    const maxRetries = 5;
    const parseRetryDelays = [500, 700, 1000, 1400, 2000];
    const completed = new Map();
    let pending = [...(expectedSegments || [])];
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (!pending.length) return completed;

        const missingIds = pending.map(segment => segment.id);
        const repair = attempt
            ? `

Your previous response was invalid or incomplete.
This is retry ${attempt}/${maxRetries}.
KEEP all previously successful segment translations unchanged on the client side.
Return STRICT JSON only for the STILL-MISSING segment ids listed below.
STILL-MISSING IDS: ${JSON.stringify(missingIds)}
Do not return already completed ids.
Include every still-missing id exactly once.
Do not add markdown fences, commentary, explanations, or extra ids.`
            : '';

        try {
            const response = await sendWithRetry(prompt + repair, options);
            const raw = extractResponseText(response);
            const { partial, parseError } = collectPartialSegmentTranslations(raw, pending);

            for (const [id, value] of partial) completed.set(id, value);
            pending = pending.filter(segment => !completed.has(segment.id));

            if (!pending.length) return completed;

            lastError = parseError || new Error(
                `번역 결과 누락: ${pending.map(segment => segment.id).join(', ')}`,
            );
        } catch (error) {
            if (isAbort(error, options.signal)) throw error;
            lastError = error;
        }

        if (attempt === maxRetries) break;

        console.warn(
            `[베르바] 번역 결과 일부 실패 — 성공 구간 ${completed.size}개 유지, 남은 ${pending.length}개만 ${attempt + 1}/${maxRetries}회 재시도`,
            lastError,
        );
        await wait(parseRetryDelays[attempt], options.signal);
    }

    const finalError = new Error(
        `번역 결과 자동 재시도 ${maxRetries}회를 모두 사용했습니다: ${errorText(lastError)}`,
        { cause: lastError || undefined },
    );
    finalError.partialTranslations = completed;
    finalError.missingSegments = pending;
    throw finalError;
}
async function requestSelectionCandidates(prompt, options = {}) {
    const maxRetries = 5;
    const parseRetryDelays = [500, 700, 1000, 1400, 2000];
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const repair = attempt
            ? `

Your previous response was invalid or incomplete.
This is retry ${attempt}/${maxRetries}.
Return STRICT JSON only with exactly three distinct candidates.
Do not add markdown fences, commentary, or explanations.`
            : '';

        try {
            const response = await sendWithRetry(prompt + repair, options);
            return parseSelectionCandidateResponse(extractResponseText(response), 3);
        } catch (error) {
            if (isAbort(error, options.signal)) throw error;

            lastError = error;
            if (attempt === maxRetries) break;

            console.warn(
                `[베르바] 선택 재번역 후보 해석 실패 — ${attempt + 1}/${maxRetries}회 재시도`,
                error,
            );
            await wait(parseRetryDelays[attempt], options.signal);
        }
    }

    throw new Error(
        `선택 재번역 후보 자동 재시도 ${maxRetries}회를 모두 사용했습니다: ${errorText(lastError)}`,
        { cause: lastError || undefined },
    );
}

function restoredSegmentText(value, segmented, useSourceNames = false) {
    const nameTokens = (segmented.nameTokens || []).map(entry => ({
        token: entry.token,
        value: useSourceNames ? entry.source : entry.value,
    }));
    const namesRestored = restoreProtected(value, nameTokens, { strict: false });
    const fullyRestored = restoreProtected(namesRestored, segmented.tokens, { strict: false });
    return useSourceNames ? fullyRestored : repairKoreanParticleAlternatives(fullyRestored);
}

function buildSourceMap(segmented, translations, completeTranslation) {
    const entries = [];
    let cursor = 0;
    for (const segment of segmented.segments || []) {
        const translated = restoredSegmentText(String(translations.get(segment.id) || ''), segmented, false);
        const source = restoredSegmentText(segment.text, segmented, true);
        if (!translated.trim() || !source.trim()) continue;
        let start = completeTranslation.indexOf(translated, cursor);
        if (start < 0) start = completeTranslation.indexOf(translated);
        if (start < 0) continue;
        const end = start + translated.length;
        entries.push({ id: segment.id, source, start, end });
        cursor = end;
    }
    return entries;
}

const CONSISTENCY_ROLE_TERMS = new Set([
    'manager', 'supervisor', 'boss', 'leader', 'director', 'executive', 'administrator',
    'chief', 'president', 'chairman', 'chairwoman', 'captain', 'commander', 'general',
    'officer', 'detective', 'agent', 'professor', 'teacher', 'doctor', 'nurse', 'coach',
    'secretary', 'assistant', 'attorney', 'lawyer', 'judge', 'prosecutor', 'owner',
    'master', 'mistress', 'lord', 'lady', 'king', 'queen', 'prince', 'princess',
    'duke', 'duchess', 'emperor', 'empress', 'father', 'mother', 'brother', 'sister',
    'uncle', 'aunt', 'husband', 'wife', 'boyfriend', 'girlfriend', 'fiance', 'fiancee',
]);

const CONSISTENCY_ROLE_PHRASES = [
    'team lead', 'team leader', 'project manager', 'general manager', 'team manager',
    'floor manager', 'shift manager', 'shift supervisor', 'department head', 'head nurse',
    'executive director', 'chief executive',
];

function normalizedRoleMention(raw) {
    let term = String(raw || '').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
    term = term.replace(/[’']s$/u, '').replace(/[’']$/u, '');
    if (CONSISTENCY_ROLE_PHRASES.includes(term)) return term;
    const singular = term.endsWith('s') ? term.slice(0, -1) : '';
    if (CONSISTENCY_ROLE_TERMS.has(term)) return term;
    if (singular && CONSISTENCY_ROLE_TERMS.has(singular)) return singular;
    return '';
}

function roleTermsForReferentConsistency(segments) {
    const phrasePattern = CONSISTENCY_ROLE_PHRASES
        .map(term => term.split(/\s+/u).map(escapeRegularExpression).join('\\s+'))
        .join('|');
    const matcher = new RegExp(`\\b(?:${phrasePattern}|[A-Za-z][A-Za-z'’-]{2,})\\b`, 'giu');
    const ordered = [];
    let totalMentions = 0;
    for (const segment of segments || []) {
        const source = String(segment?.text || '').replace(/@@VERBA_[A-Z0-9_]+@@/g, ' ');
        for (const match of source.matchAll(matcher)) {
            const term = normalizedRoleMention(match[0]);
            if (!term) continue;
            totalMentions += 1;
            if (!ordered.includes(term)) ordered.push(term);
        }
    }
    return totalMentions >= 2 ? ordered : [];
}

function repeatedRoleTerms(segments) {
    const counts = new Map();
    for (const segment of segments || []) {
        const source = String(segment?.text || '').replace(/@@VERBA_[A-Z0-9_]+@@/g, ' ');
        for (const match of source.matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)) {
            let term = match[0].toLocaleLowerCase();
            term = term.replace(/[’']s$/u, '').replace(/[’']$/u, '');
            const singular = term.endsWith('s') ? term.slice(0, -1) : '';
            if (!CONSISTENCY_ROLE_TERMS.has(term) && !CONSISTENCY_ROLE_TERMS.has(singular)) continue;
            counts.set(term, (counts.get(term) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([term]) => term);
}

function segmentContainsRoleTerm(segment, terms) {
    const source = String(segment?.text || '');
    return terms.some(term => {
        const pattern = String(term || '')
            .split(/\s+/u)
            .map(escapeRegularExpression)
            .join('\\s+');
        return new RegExp(`(^|[^A-Za-z])${pattern}(?=$|[^A-Za-z])`, 'i').test(source);
    });
}

async function planRepeatedRoleTermLocks(segmented, options = {}) {
    const terms = repeatedRoleTerms(segmented?.segments);
    if (!terms.length) return [];

    const sourceContext = (segmented.segments || [])
        .map(segment => String(segment.text || ''))
        .join('\n\n');
    const cacheKey = [
        hashText(sourceContext),
        sourceContext.length,
        terms.join('\u0001'),
        String(settings.bannedWords || ''),
    ].join('\u0000');

    const cached = roleTermPlanCache.get(cacheKey);
    if (cached) {
        // Refresh LRU position and clone so callers cannot mutate the cache.
        setBoundedCache(roleTermPlanCache, cacheKey, cached, 80);
        return cached.map(row => ({ ...row }));
    }

    const prompt = buildRoleTermPlanPrompt({ sourceContext, terms, settings });
    const expected = terms.map((term, index) => ({
        id: `role_${String(index).padStart(4, '0')}`,
        type: 'role_term',
        text: term,
    }));

    try {
        const planned = await requestSegments(prompt, expected, {
            ...options,
            stage: 'role-term-plan',
        });
        const locks = terms.flatMap((term, index) => {
            const target = String(planned.get(`role_${String(index).padStart(4, '0')}`) || '').trim();
            if (
                !target
                || target.length > 40
                || /[\r\n@]/.test(target)
                || !hasKorean(target)
                || findBannedWords(target, settings.bannedWords).length
            ) return [];
            return [{ source: term, target }];
        });

        setBoundedCache(
            roleTermPlanCache,
            cacheKey,
            locks.map(row => ({ ...row })),
            80,
        );
        return locks;
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;
        console.warn('[베르바] 반복 직책 표기 계획에 실패하여 번역 후 보정으로 전환합니다.', error);
        return [];
    }
}
function protectedTokensIntact(previous, next) {
    const collect = value => {
        const counts = new Map();
        for (const token of String(value || '').match(/@@VERBA_(?:NAME_)?\d{4}@@/g) || []) {
            counts.set(token, (counts.get(token) || 0) + 1);
        }
        return counts;
    };
    const before = collect(previous);
    const after = collect(next);
    if (before.size !== after.size) return false;
    return [...before].every(([token, count]) => after.get(token) === count);
}

async function repairRepeatedRoleTermConsistency(segmented, translations, options = {}) {
    // Unlike the pre-translation lock (which handles exact repeated source terms),
    // this final pass also compares different role/title words that may point to
    // the same person, e.g. manager -> team lead. If context confirms the same
    // referent/function, the earliest Korean rendering becomes canonical.
    const terms = roleTermsForReferentConsistency(segmented?.segments);
    if (!terms.length) return;
    const affected = (segmented.segments || []).filter(segment => segmentContainsRoleTerm(segment, terms));
    if (!affected.length) return;
    const rows = affected.map(segment => ({
        id: segment.id,
        type: segment.type,
        // Keep every protection/name token opaque during the repair pass. They
        // are restored only once, after all translation stages are complete.
        source: String(segment.text || ''),
        currentTranslation: String(translations.get(segment.id) || ''),
    }));
    const prompt = buildTermConsistencyRepairPrompt({ rows, terms, settings });
    const expected = affected.map(segment => ({
        id: segment.id,
        type: segment.type,
        text: String(translations.get(segment.id) || ''),
    }));
    try {
        const repaired = await requestSegments(prompt, expected, {
            ...options,
            stage: 'role-term-consistency-repair',
        });
        for (const segment of affected) {
            const value = String(repaired.get(segment.id) || '').trim();
            const previous = String(translations.get(segment.id) || '');
            if (
                !value
                || value.length > Math.max(500, previous.length * 1.35)
                || !protectedTokensIntact(previous, value)
            ) continue;
            translations.set(segment.id, value);
        }
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;
        console.warn('[베르바] 반복 직책 표기 통일을 완료하지 못해 기존 번역을 유지합니다.', error);
    }
}

function normalizedSourceMap(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry, index) => {
        const source = String(entry?.source || '').trim();
        const start = Number(entry?.start);
        const end = Number(entry?.end);
        if (!source || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return [];
        return [{
            id: String(entry?.id || `seg_${index}`),
            source,
            start,
            end,
        }];
    });
}

function normalizedLockedSegments(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap((entry, index) => {
        const id = String(entry?.id || `seg_${index}`);
        const source = String(entry?.source || '').trim();
        const translation = String(entry?.translation || '');
        const rawSentenceIndex = Number(entry?.sentenceIndex);
        const sentenceIndex = Number.isInteger(rawSentenceIndex) && rawSentenceIndex >= 0
            ? rawSentenceIndex
            : null;
        const key = `${id}\u0000${source}\u0000${sentenceIndex === null ? 'segment' : `sentence:${sentenceIndex}`}`;
        if (!source || !translation || seen.has(key)) return [];
        seen.add(key);
        return [{
            id,
            source,
            translation,
            ...(sentenceIndex === null ? {} : { sentenceIndex }),
        }];
    });
}

function lockedSegmentKey(entry) {
    const rawSentenceIndex = Number(entry?.sentenceIndex);
    const sentenceKey = Number.isInteger(rawSentenceIndex) && rawSentenceIndex >= 0
        ? `sentence:${rawSentenceIndex}`
        : 'segment';
    return `${String(entry?.id || '')}\u0000${String(entry?.source || '').trim()}\u0000${sentenceKey}`;
}

function sentenceRanges(value) {
    const text = String(value || '');
    if (!text) return [];
    const trimRange = (start, end) => {
        while (start < end && /\s/u.test(text[start])) start += 1;
        while (end > start && /\s/u.test(text[end - 1])) end -= 1;
        return end > start ? { start, end } : null;
    };

    try {
        const Segmenter = globalThis.Intl?.Segmenter;
        if (typeof Segmenter === 'function') {
            const ranges = [];
            const segmenter = new Segmenter('ko', { granularity: 'sentence' });
            for (const part of segmenter.segment(text)) {
                const start = Number(part.index) || 0;
                const range = trimRange(start, start + String(part.segment || '').length);
                if (range) ranges.push(range);
            }
            if (ranges.length) return ranges;
        }
    } catch {
        // Fall through to the punctuation-based sentence splitter.
    }

    const ranges = [];
    let start = 0;
    let index = 0;
    const closingMarks = /["'”’」』】）\]\}]/u;
    const terminalMarks = /[.!?…。！？]/u;
    while (index < text.length) {
        const character = text[index];
        const hardBreak = character === '\n';
        if (!terminalMarks.test(character) && !hardBreak) {
            index += 1;
            continue;
        }

        let end = index + 1;
        if (!hardBreak) {
            while (end < text.length && terminalMarks.test(text[end])) end += 1;
            while (end < text.length && closingMarks.test(text[end])) end += 1;
        }
        const range = trimRange(start, end);
        if (range) ranges.push(range);
        start = end;
        while (start < text.length && /\s/u.test(text[start])) start += 1;
        index = start;
    }
    const tail = trimRange(start, text.length);
    if (tail) ranges.push(tail);
    return ranges;
}

function lockedRangeInTranslation(sourceMap, translation, lock) {
    const rows = normalizedSourceMap(sourceMap);
    const row = rows.find(candidate => (
        candidate.id === lock.id
        && candidate.source === lock.source
    ));
    if (!row) return null;

    const rawSentenceIndex = Number(lock?.sentenceIndex);
    if (!Number.isInteger(rawSentenceIndex) || rawSentenceIndex < 0) {
        return { start: row.start, end: row.end };
    }

    const rowText = String(translation || '').slice(row.start, row.end);
    const ranges = sentenceRanges(rowText);
    if (!ranges.length) return null;

    // On the currently displayed translation, prefer the exact locked sentence.
    // After a full retranslation that wording changes, fall back to the same
    // sentence ordinal inside the same source-mapped segment.
    const exact = ranges.find(range => rowText.slice(range.start, range.end) === lock.translation);
    const target = exact || ranges[rawSentenceIndex];
    if (!target) return null;
    return {
        start: row.start + target.start,
        end: row.start + target.end,
    };
}

function translationWithLockedSegments(translated, lockedSegments) {
    const locks = normalizedLockedSegments(lockedSegments);
    let translation = String(translated?.translation || '');
    let sourceMap = normalizedSourceMap(translated?.sourceMap);
    if (!locks.length || !sourceMap.length) return { translation, sourceMap, lockedSegments: locks };

    const replacements = locks.flatMap(lock => {
        const range = lockedRangeInTranslation(sourceMap, translation, lock);
        return range ? [{ ...range, replacement: lock.translation }] : [];
    }).sort((left, right) => right.start - left.start);

    for (const replacement of replacements) {
        translation = translation.slice(0, replacement.start)
            + replacement.replacement
            + translation.slice(replacement.end);
        sourceMap = sourceMapAfterSelection(
            sourceMap,
            replacement.start,
            replacement.end,
            replacement.replacement,
        );
    }
    return { translation, sourceMap, lockedSegments: locks };
}

function sourceMapAfterSelection(sourceMap, start, end, replacement) {
    const rows = normalizedSourceMap(sourceMap);
    const delta = String(replacement).length - (end - start);
    const overlapping = rows.filter(row => start < row.end && end > row.start);
    if (overlapping.length !== 1 || start < overlapping[0].start || end > overlapping[0].end) {
        return rows.flatMap(row => {
            if (row.end <= start) return [row];
            if (row.start >= end) return [{ ...row, start: row.start + delta, end: row.end + delta }];
            return [];
        });
    }
    const target = overlapping[0];
    return rows.map(row => {
        if (row.id === target.id && row.start === target.start && row.end === target.end) {
            return { ...row, end: row.end + delta };
        }
        if (row.start >= end) return { ...row, start: row.start + delta, end: row.end + delta };
        return row;
    });
}

function refreshedSourceMap(sourceMap, translation) {
    const rows = Array.isArray(sourceMap) ? sourceMap : [];
    let cursor = 0;
    return rows.flatMap(row => {
        const translatedSegment = String(row?.translation || '');
        const source = String(row?.source || '').trim();
        if (!translatedSegment || !source) return [];
        let start = String(translation).indexOf(translatedSegment, cursor);
        if (start < 0) start = String(translation).indexOf(translatedSegment);
        if (start < 0) return [];
        const end = start + translatedSegment.length;
        cursor = end;
        return [{ id: String(row?.id || `seg_${cursor}`), source, start, end }];
    });
}

function sourceMapAfterGlobalReplacements(sourceMap, previousTranslation, nextTranslation, replacements) {
    const rows = normalizedSourceMap(sourceMap).map(row => {
        let translated = String(previousTranslation).slice(row.start, row.end);
        for (const replacement of replacements || []) {
            const search = String(replacement?.search || '');
            if (search) translated = replaceOutsideProtected(translated, search, replacement?.value || '');
        }
        return { ...row, translation: translated };
    });
    return refreshedSourceMap(rows, nextTranslation);
}

const KOREAN_NAME_PARTICLE_LIKE_ENDINGS = new Set(['은', '는', '이', '가', '을', '를', '의', '에', '도', '만', '와', '과', '로']);

function escapeRegularExpression(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Korean names such as "혜담은" are sometimes misread by a model as
 * "혜담" + topic particle "은". Protect already-correct full spellings, then
 * repair only a standalone shortened form followed by a Korean particle,
 * vocative ending, whitespace, punctuation, or the end of the segment.
 */
function repairIndivisibleIdentityNames(value, speakerIdentity = {}) {
    let result = String(value || '');
    const names = [...new Set([
        String(speakerIdentity.userName || '').trim(),
        String(speakerIdentity.characterName || '').trim(),
    ])].filter(name => /^[가-힣]{3,6}$/u.test(name) && KOREAN_NAME_PARTICLE_LIKE_ENDINGS.has(name.slice(-1)));

    names.forEach((name, index) => {
        const shortened = name.slice(0, -1);
        if (!shortened || !result.includes(shortened)) return;
        const token = `\uE000VERBA_IDENTITY_${index}\uE001`;
        result = result.split(name).join(token);
        const suffix = '(?:에게서|에게|한테서|한테|께서|께|으로부터|으로|로부터|로|에서|보다|처럼|만큼|까지|부터|하고|이랑|랑|과|와|의|은|는|이|가|을|를|도|만|아|야)?';
        const shortenedPattern = new RegExp(`${escapeRegularExpression(shortened)}(?=${suffix}(?:[^가-힣]|$))`, 'gu');
        result = result.replace(shortenedPattern, name);
        result = result.split(token).join(name);
    });
    return result;
}

function hasKoreanFinalConsonant(value) {
    const chars = [...String(value || '').trim()];
    const last = chars.at(-1) || '';
    const code = last.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return null;
    return (code - 0xAC00) % 28 !== 0;
}

function repairKoreanParticleAlternatives(value) {
    const particlePairs = [
        ['이랑', '랑'],
        ['으로', '로'],
        ['과', '와'],
        ['을', '를'],
        ['은', '는'],
        ['이', '가'],
    ];
    let result = String(value || '');

    const desiredParticle = (noun, withBatchim, withoutBatchim) => {
        const hasBatchim = hasKoreanFinalConsonant(noun);
        if (hasBatchim === null) return null;
        if (withBatchim === '으로' && withoutBatchim === '로') {
            const last = [...noun].at(-1);
            const jong = (last.charCodeAt(0) - 0xAC00) % 28;
            return jong === 0 || jong === 8 ? '로' : '으로';
        }
        return hasBatchim ? withBatchim : withoutBatchim;
    };

    for (const [withBatchim, withoutBatchim] of particlePairs) {
        const left = escapeRegularExpression(withBatchim);
        const right = escapeRegularExpression(withoutBatchim);

        // Models sometimes return grammar placeholders literally:
        // 담은이(가), 매니저은(는), 담은(은)는, 매니저(은)는,
        // or slash variants such as 담은(은/는).
        const variants = [
            new RegExp(`([가-힣]+)\\s*${left}\\s*\\(\\s*${right}\\s*\\)`, 'gu'),
            new RegExp(`([가-힣]+)\\s*${right}\\s*\\(\\s*${left}\\s*\\)`, 'gu'),
            new RegExp(`([가-힣]+)\\s*\\(\\s*${left}\\s*\\)\\s*${right}`, 'gu'),
            new RegExp(`([가-힣]+)\\s*\\(\\s*${right}\\s*\\)\\s*${left}`, 'gu'),
            new RegExp(`([가-힣]+)\\s*${left}\\s*\\/\\s*${right}`, 'gu'),
            new RegExp(`([가-힣]+)\\s*${right}\\s*\\/\\s*${left}`, 'gu'),
            new RegExp(`([가-힣]+)\\s*\\(\\s*${left}\\s*\\/\\s*${right}\\s*\\)`, 'gu'),
            new RegExp(`([가-힣]+)\\s*\\(\\s*${right}\\s*\\/\\s*${left}\\s*\\)`, 'gu'),
        ];

        for (const pattern of variants) {
            result = result.replace(pattern, (whole, noun) => {
                const desired = desiredParticle(noun, withBatchim, withoutBatchim);
                return desired ? noun + desired : whole;
            });
        }
    }

    return result;
}


function outputScopeForSegment(segment, speakerScopes = {}) {
    if (segment?.type === 'info_block') return 'info_block';
    if (segment?.type !== 'dialogue_candidate') return 'narration';
    return speakerScopes?.[segment.id] === 'target_dialogue'
        ? 'target_dialogue'
        : 'other_dialogue';
}

function segmentsGroupedByOutputScope(segments, speakerScopes = {}) {
    const groups = new Map();
    for (const segment of segments || []) {
        const scope = outputScopeForSegment(segment, speakerScopes);
        if (!groups.has(scope)) groups.set(scope, []);
        groups.get(scope).push(segment);
    }
    return groups;
}

function nameTokensForSegments(segmented, segments) {
    const source = (segments || []).map(segment => String(segment?.text || '')).join('\n');
    return (segmented?.nameTokens || []).filter(entry => source.includes(String(entry?.token || '')));
}

function speakerAttributionCacheKey(segmented, speakerIdentity = {}) {
    const dialogue = (segmented?.segments || [])
        .filter(segment => segment.type === 'dialogue_candidate')
        .map(segment => `${segment.id}\u0002${String(segment.text || '')}`)
        .join('\u0003');
    const source = String(segmented?.protectedText || '');
    const characterName = String(speakerIdentity.characterName || '').trim();
    const characterGender = String(speakerIdentity.characterGender || 'unknown').trim();
    const userName = String(speakerIdentity.userName || '').trim();

    return [
        hashText(`${source}\u0000${dialogue}\u0000${characterName}\u0000${characterGender}\u0000${userName}`),
        source.length,
        dialogue.length,
        characterName,
        characterGender,
        userName,
    ].join('\u0001');
}

async function classifyOutputDialogueSpeakers(segmented, speakerIdentity, options = {}) {
    const dialogueSegments = (segmented?.segments || []).filter(segment => segment.type === 'dialogue_candidate');
    const scopes = Object.fromEntries(dialogueSegments.map(segment => [segment.id, 'other_dialogue']));

    const needsSpeakerIsolation = Boolean(
        (settings.dialoguePromptEnabled !== false && String(settings.dialoguePrompt || '').trim())
        || (settings.otherDialoguePromptEnabled !== false && String(settings.otherDialoguePrompt || '').trim())
        || String(settings.dialogueEndingPreferred || '').trim()
        || String(settings.dialogueEndingAvoid || '').trim()
        || settings.dialogueEndingRepetitionReduction !== false
    );
    if (!dialogueSegments.length || !needsSpeakerIsolation) return scopes;

    const cacheKey = speakerAttributionCacheKey(segmented, speakerIdentity);
    const cached = speakerAttributionCache.get(cacheKey);
    if (cached) {
        setBoundedCache(speakerAttributionCache, cacheKey, cached, 120);
        return { ...cached };
    }

    try {
        const prompt = buildSpeakerAttributionPrompt(segmented, speakerIdentity);
        const classified = await requestSegments(prompt, dialogueSegments, {
            ...options,
            stage: 'speaker-attribution',
        });

        for (const segment of dialogueSegments) {
            const value = String(classified.get(segment.id) || '').trim().toLocaleLowerCase();
            scopes[segment.id] = value === 'target' ? 'target_dialogue' : 'other_dialogue';
        }

        setBoundedCache(speakerAttributionCache, cacheKey, { ...scopes }, 120);
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;
        // Conservative fallback is NOT cached. A later retranslation may
        // successfully classify the speakers.
        console.warn('[베르바] 대사 화자 분류 실패 — 캐릭터 전용 프롬프트를 보수적으로 제외합니다.', error);
        debugCaptureError?.(error, 'speaker-attribution');
    }

    return scopes;
}

async function requestScopedGroupTranslations({
    segmented,
    scope,
    segments,
    options,
}) {
    const buildPrompt = targetSegments => buildScopedOutputPrompt({
        segments: targetSegments,
        sourceContext: segmented.protectedText,
        settings,
        oneTimeInstruction: options.oneTimeInstruction || '',
        nameTokens: nameTokensForSegments(segmented, targetSegments),
        tuning: options.tuning || null,
        scope,
    });

    try {
        return await requestSegments(buildPrompt(segments), segments, {
            ...options,
            parallelRequest: true,
            stage: `${options.stage || 'output-translation'}:${scope}`,
        });
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;

        const recovered = error.partialTranslations instanceof Map
            ? new Map(error.partialTranslations)
            : new Map();
        const missing = Array.isArray(error.missingSegments) && error.missingSegments.length
            ? error.missingSegments
            : segments.filter(segment => !recovered.has(segment.id));

        if (!missing.length) return recovered;

        console.warn(
            `[베르바] ${scope} 범위에서 ${recovered.size}개 성공 구간은 유지하고, 실패한 ${missing.length}개 구간만 개별 복구합니다.`,
            error,
        );

        const rows = await runWithConcurrency(
            missing,
            SCOPED_PARALLEL_REQUEST_LIMIT,
            async segment => {
                // Full message context is deliberately retained. No context
                // shrinking or prompt compression is used by this optimization.
                const single = await requestSegments(buildPrompt([segment]), [segment], {
                    ...options,
                    parallelRequest: true,
                    stage: `${options.stage || 'output-translation'}:${scope}:single`,
                });
                return [segment.id, single.get(segment.id)];
            },
        );

        for (const [id, value] of rows) recovered.set(id, value);
        return recovered;
    }
}
async function requestScopedOutputTranslations(segmented, speakerScopes, options = {}) {
    const translations = new Map();
    const groups = segmentsGroupedByOutputScope(segmented.segments, speakerScopes);
    const strictIsolationNeeded = Boolean(
        (settings.dialoguePromptEnabled !== false && String(settings.dialoguePrompt || '').trim())
        || (settings.otherDialoguePromptEnabled !== false && String(settings.otherDialoguePrompt || '').trim())
        || String(settings.dialogueEndingPreferred || '').trim()
        || String(settings.dialogueEndingAvoid || '').trim()
        || settings.dialogueEndingRepetitionReduction !== false
    );

    // A shared ALL-DIALOGUE prompt does not require separate API calls by
    // itself. Keep one request unless speaker-specific TARGET/NPC-USER prompts
    // actually need hard isolation.
    if (!strictIsolationNeeded) {
        const prompt = buildOutputPrompt(
            segmented,
            settings,
            options.oneTimeInstruction || '',
            options.speakerIdentity || {},
            options.tuning || null,
        );
        return requestSegments(prompt, segmented.segments, {
            ...options,
            stage: options.stage || 'output-translation',
        });
    }

    const scopeJobs = [...groups.entries()].filter(([, segments]) => segments.length);
    const scopeResults = await runWithConcurrency(
        scopeJobs,
        SCOPED_PARALLEL_REQUEST_LIMIT,
        async ([scope, segments]) => {
            const result = await requestScopedGroupTranslations({
                segmented,
                scope,
                segments,
                options,
            });
            return [scope, result];
        },
    );

    for (const [, result] of scopeResults) {
        for (const [id, value] of result) translations.set(id, value);
    }

    return translations;
}

async function repairSegmentsByOutputScope({
    invalid,
    segmented,
    translations,
    speakerScopes,
    options,
    buildPrompt,
    stage,
}) {
    const groups = [...segmentsGroupedByOutputScope(invalid, speakerScopes).entries()]
        .filter(([, segments]) => segments.length);

    const results = await runWithConcurrency(
        groups,
        SCOPED_PARALLEL_REQUEST_LIMIT,
        async ([scope, segments]) => {
            const prompt = buildPrompt(
                segments,
                translations,
                settings,
                options.speakerIdentity || {},
                nameTokensForSegments(segmented, segments),
                options.tuning || null,
                scope,
            );
            const repaired = await requestSegments(prompt, segments, {
                ...options,
                parallelRequest: true,
                stage: `${stage}:${scope}`,
            });
            return [segments, repaired];
        },
    );

    for (const [segments, repaired] of results) {
        for (const segment of segments) {
            translations.set(segment.id, repaired.get(segment.id));
        }
    }
}
async function repairProtectedTokenIntegrity(segmented, translations, options = {}) {
    const speakerIdentity = options.speakerIdentity || {};
    const speakerScopes = options.speakerScopes || {};
    for (let repairAttempt = 0; repairAttempt < 5; repairAttempt += 1) {
        const invalid = findProtectedTokenIntegrityProblems(segmented.segments, translations);
        if (!invalid.length) return;
        await repairSegmentsByOutputScope({
            invalid,
            segmented,
            translations,
            speakerScopes,
            options: { ...options, speakerIdentity },
            buildPrompt: buildProtectedTokenRepairPrompt,
            stage: 'protected-token-repair',
        });
    }

    const remaining = findProtectedTokenIntegrityProblems(segmented.segments, translations);
    if (remaining.length) {
        console.error('[베르바] 보호 요소 자동 복구 실패', remaining.map(row => row.id));
        throw new Error('보호 요소 자동 복구에 실패했습니다. 다시 번역해 주세요.');
    }
}


function normalizedNumberTokens(value) {
    return (String(value || '').match(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*(?![\p{L}\p{N}_])/gu) || [])
        .map(item => item.replace(/,/g, ''))
        .sort();
}

function sameStringArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addQualitySuspicion(map, segment, check, reason) {
    if (!segment?.id) return;
    if (!map.has(segment.id)) {
        map.set(segment.id, {
            segment,
            checks: new Set(),
            reasons: [],
        });
    }
    const row = map.get(segment.id);
    row.checks.add(check);
    if (reason && !row.reasons.includes(reason)) row.reasons.push(reason);
}

function koreanPoliteEndingCount(value) {
    return (String(value || '').match(/(?:요|습니다|습니까|세요|십시오)(?=[.!?…。？！"'”’)\]}]*\s*(?:$|\n))/gmu) || []).length;
}

function koreanCasualEndingCount(value) {
    return (String(value || '').match(/(?:잖아|거든|구나|군|냐|니|네|지|어|아|야|해|래|대|데|거야|겠어)(?=[.!?…。？！"'”’)\]}]*\s*(?:$|\n))/gmu) || []).length;
}

function localQualityAuditCandidates(segmented, translations, speakerScopes) {
    const enabled = new Set(enabledQualityAuditChecks());
    const suspects = new Map();
    if (!enabled.size) return suspects;

    const charStyle = `${settings.dialoguePrompt || ''}\n${settings.allDialoguePrompt || ''}`.toLocaleLowerCase();

    for (const segment of segmented.segments || []) {
        const source = String(segment.text || '');
        const translation = String(translations.get(segment.id) || '');
        const scope = speakerScopes?.[segment.id] || (
            segment.type === 'dialogue_candidate' ? 'other_dialogue' : 'narration'
        );

        if (enabled.has('meaning')) {
            const sourceNumbers = normalizedNumberTokens(source);
            const targetNumbers = normalizedNumberTokens(translation);
            if (!sameStringArray(sourceNumbers, targetNumbers)) {
                addQualitySuspicion(suspects, segment, 'meaning', '숫자/수치 대응 확인 필요');
            }

            const strongNegation = /\b(?:not|never|no|nothing|nobody|nowhere|without|cannot|can't|won't|wouldn't|shouldn't|mustn't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|refuse(?:d|s|ing)?|forbid(?:den|s|ding)?)\b/iu.test(source);
            const koreanNegation = /(?:안\s|않|못\s|없|아니|말(?:아|라고|라|자|지)|금지|거절|절대)/u.test(translation);
            if (strongNegation && !koreanNegation) {
                addQualitySuspicion(suspects, segment, 'meaning', '부정/금지 극성 확인 필요');
            }

            if (/\b(?:allow|permission|permit|consent|refuse|forbid|don't dare|do not dare|must not|mustn't)\b/iu.test(source)) {
                addQualitySuspicion(suspects, segment, 'meaning', '허락·거절·금지 발화 의도 확인 필요');
            }
        }

        if (enabled.has('referent')) {
            const hasHe = /\b(?:he|him|his|himself)\b/iu.test(source);
            const hasShe = /\b(?:she|her|hers|herself)\b/iu.test(source);
            const hasThey = /\b(?:they|them|their|theirs|themselves)\b/iu.test(source);
            const distinctPronounGroups = [hasHe, hasShe, hasThey].filter(Boolean).length;
            const properNames = new Set(
                (source.match(/\b[A-Z][a-z]{2,}\b/g) || [])
                    .filter(name => !/^(?:The|This|That|When|Then|But|And|He|She|They|His|Her|Their)$/u.test(name)),
            );

            if (
                distinctPronounGroups >= 2
                || (properNames.size >= 2 && (hasHe || hasShe || hasThey))
            ) {
                addQualitySuspicion(suspects, segment, 'referent', '여러 인물·대명사 지칭 확인 필요');
            }
        }

        if (enabled.has('voice') && scope === 'target_dialogue') {
            const polite = koreanPoliteEndingCount(translation);
            const casual = koreanCasualEndingCount(translation);
            const wantsBanmal = /(?:\bbanmal\b|반말|casual\s+korean)/iu.test(charStyle);
            const wantsPolite = /(?:존댓말|\bjondaetmal\b|polite\s+(?:speech|korean)|honorific)/iu.test(charStyle);

            if (wantsBanmal && polite >= 2) {
                addQualitySuspicion(suspects, segment, 'voice', '반말 지시 대비 존댓말 종결 다수');
            } else if (wantsPolite && casual >= 2 && polite === 0) {
                addQualitySuspicion(suspects, segment, 'voice', '존댓말 지시 대비 반말 종결 다수');
            } else if (polite >= 2 && casual >= 2) {
                addQualitySuspicion(suspects, segment, 'voice', '대사 안 존댓말·반말 혼재');
            }
        }

        if (enabled.has('translationese')) {
            const patterns = [
                /그것에\s*대해/u,
                /그것은\s+내가/u,
                /나는\s+.+?(?:하기를|되는\s*것을)\s*원/u,
                /무엇을\s+.+?원하/u,
                /그가\s+그녀를\s+바라보/u,
                /그녀가\s+그를\s+바라보/u,
                /(?:것이다|것이었다)(?:[.!?…。？！]|$)/u,
            ];
            if (patterns.some(pattern => pattern.test(translation))) {
                addQualitySuspicion(suspects, segment, 'translationese', '직역투/영어식 문장 구조 의심');
            }
        }

        if (enabled.has('continuity')) {
            const checks = [
                [/\bleft\b/iu, /왼/u, 'left/왼쪽'],
                [/\bright\b/iu, /오른/u, 'right/오른쪽'],
                [/\binside\b/iu, /(?:안|속|내부)/u, 'inside/안쪽'],
                [/\boutside\b/iu, /(?:밖|바깥|외부)/u, 'outside/바깥'],
                [/\bbefore\b/iu, /(?:전|앞서|이전)/u, 'before/이전'],
                [/\bafter\b/iu, /(?:후|뒤|나서|이후)/u, 'after/이후'],
                [/\bopen(?:ed|ing)?\b/iu, /(?:열|벌어)/u, 'open/열림'],
                [/\bclos(?:e|ed|ing)\b/iu, /(?:닫|감)/u, 'close/닫힘'],
            ];
            for (const [sourcePattern, targetPattern, label] of checks) {
                if (sourcePattern.test(source) && !targetPattern.test(translation)) {
                    addQualitySuspicion(suspects, segment, 'continuity', `${label} 방향·상태 확인 필요`);
                    break;
                }
            }
        }
    }

    return suspects;
}

async function runExperimentalQualityAudit({
    segmented,
    translations,
    speakerScopes,
    speakerIdentity,
    options,
}) {
    if (!settings.developerMode || !settings.qualityAuditEnabled) return { checked: 0, changed: 0 };

    const suspects = localQualityAuditCandidates(segmented, translations, speakerScopes);
    if (!suspects.size) {
        lastQualityAuditSummary = '로컬 이상 없음 · AI 검수 생략';
        renderQualityAuditStatus();
        return { checked: 0, changed: 0 };
    }

    const rows = [...suspects.values()];
    const candidates = rows.map(row => ({
        ...row.segment,
        qualityChecks: [...row.checks],
        qualityReasons: [...row.reasons],
        outputScope: speakerScopes?.[row.segment.id] || (
            row.segment.type === 'dialogue_candidate' ? 'other_dialogue' : 'narration'
        ),
    }));
    const categories = [...new Set(rows.flatMap(row => [...row.checks]))];

    lastQualityAuditSummary = `의심 ${candidates.length}구간 · ${categories.join('/')}`;
    renderQualityAuditStatus();

    try {
        const prompt = buildQualityAuditPrompt({
            segments: candidates,
            currentTranslations: translations,
            sourceContext: segmented.protectedText,
            settings,
            speakerIdentity,
            nameTokens: nameTokensForSegments(segmented, candidates),
            tuning: options.tuning || null,
            enabledChecks: enabledQualityAuditChecks(),
        });
        const reviewed = await requestSegments(prompt, candidates, {
            ...options,
            stage: 'quality-audit',
        });

        const changed = [];
        for (const segment of candidates) {
            const before = String(translations.get(segment.id) || '');
            const after = String(reviewed.get(segment.id) || '');
            if (!after.trim() || after === before) continue;
            translations.set(segment.id, after);
            changed.push(segment);
        }

        if (changed.length) {
            for (const [id, translation] of translations) {
                translations.set(
                    id,
                    repairKoreanParticleAlternatives(
                        repairIndivisibleIdentityNames(translation, speakerIdentity),
                    ),
                );
            }

            const banned = changed.filter(segment =>
                findBannedWords(translations.get(segment.id), settings.bannedWords).length,
            );
            if (banned.length) {
                await repairSegmentsByOutputScope({
                    invalid: banned,
                    segmented,
                    translations,
                    speakerScopes,
                    options: { ...options, speakerIdentity },
                    buildPrompt: buildBannedRepairPrompt,
                    stage: 'quality-audit-banned-repair',
                });
            }

            const untranslated = findUntranslatedSegments(changed, translations, settings, speakerScopes);
            if (untranslated.length) {
                await repairSegmentsByOutputScope({
                    invalid: untranslated,
                    segmented,
                    translations,
                    speakerScopes,
                    options: { ...options, speakerIdentity },
                    buildPrompt: buildUntranslatedRepairPrompt,
                    stage: 'quality-audit-untranslated-repair',
                });
            }

            await repairProtectedTokenIntegrity(segmented, translations, {
                ...options,
                speakerIdentity,
                speakerScopes,
            });
        }

        lastQualityAuditSummary = `AI 통합 검수 ${candidates.length}구간 · 수정 ${changed.length}구간 · ${categories.join('/')}`;
        renderQualityAuditStatus();
        console.info(`[베르바] 품질 검수 완료: ${lastQualityAuditSummary}`);
        return { checked: candidates.length, changed: changed.length };
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;
        lastQualityAuditSummary = '검수 실패 · 원래 번역 유지';
        renderQualityAuditStatus();
        console.warn('[베르바] 개발자 품질 검수 실패 — 기존 번역을 그대로 유지합니다.', error);
        return { checked: candidates.length, changed: 0, error };
    }
}

async function translateOutputText(source, options = {}) {
    const characterNameLocks = normalizedCharacterNameLocks();
    const initialSegmented = segmentSource(source, characterNameLocks);
    const roleTermLocks = await planRepeatedRoleTermLocks(initialSegmented, {
        signal: options.signal,
    });
    const segmented = roleTermLocks.length
        ? segmentSource(source, [...characterNameLocks, ...roleTermLocks])
        : initialSegmented;
    if (!segmented.segments.length) {
        const translation = assembleTranslation(segmented, new Map());
        return { translation, sourceMap: [] };
    }
    const speakerIdentity = options.speakerIdentity || {};
    const speakerScopes = await classifyOutputDialogueSpeakers(segmented, speakerIdentity, {
        ...options,
        speakerIdentity,
    });
    const translations = await requestScopedOutputTranslations(segmented, speakerScopes, {
        ...options,
        speakerIdentity,
        stage: options.stage || 'output-translation',
    });

    for (let repairAttempt = 0; repairAttempt < 5; repairAttempt += 1) {
        const invalid = segmented.segments.filter(segment =>
            findBannedWords(translations.get(segment.id), settings.bannedWords).length,
        );
        if (!invalid.length) break;
        await repairSegmentsByOutputScope({
            invalid,
            segmented,
            translations,
            speakerScopes,
            options: { ...options, speakerIdentity },
            buildPrompt: buildBannedRepairPrompt,
            stage: 'banned-word-repair',
        });
    }

    for (let repairAttempt = 0; repairAttempt < 5; repairAttempt += 1) {
        const invalid = findUntranslatedSegments(segmented.segments, translations, settings, speakerScopes);
        if (!invalid.length) break;
        await repairSegmentsByOutputScope({
            invalid,
            segmented,
            translations,
            speakerScopes,
            options: { ...options, speakerIdentity },
            buildPrompt: buildUntranslatedRepairPrompt,
            stage: 'untranslated-repair',
        });
    }

    // Planned terms are protected and no longer appear as plain source words
    // here. The fallback therefore checks only any repeated roles that could
    // not be planned, without touching already locked terminology.
    await repairRepeatedRoleTermConsistency(segmented, translations, {
        signal: options.signal,
    });

    // Validate against the original protected source, not merely against the
    // previous repair result. A missing NAME token can otherwise survive every
    // post-processing pass and only fail during final assembly.
    await repairProtectedTokenIntegrity(segmented, translations, {
        ...options,
        speakerIdentity,
        speakerScopes,
    });

    for (const [id, translation] of translations) {
        translations.set(id, repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(translation, speakerIdentity)));
    }

    await runExperimentalQualityAudit({
        segmented,
        translations,
        speakerScopes,
        speakerIdentity,
        options,
    });

    const remaining = [...translations.values()].flatMap(text => findBannedWords(text, settings.bannedWords));
    if (remaining.length) {
        throw new Error(`금지어가 계속 남아 번역을 적용하지 않았습니다: ${[...new Set(remaining)].join(', ')}`);
    }
    const untranslated = findUntranslatedSegments(segmented.segments, translations, settings, speakerScopes);
    if (untranslated.length) {
        if (untranslated.length === segmented.segments.length) {
            throw new Error('전체 번역 결과가 외국어 원문으로 남아 번역을 적용하지 않았습니다.');
        }
        console.warn('[베르바] 일부 구간의 미번역 의심이 해소되지 않아 나머지 번역 결과를 우선 적용합니다.', untranslated);
    }
    const result = assembleTranslation(segmented, translations);
    if (!result.trim()) throw new Error('완성된 번역문이 비어 있습니다.');
    return {
        translation: result,
        sourceMap: buildSourceMap(segmented, translations, result),
    };
}

async function translateInputText(source, options = {}) {
    const expected = [{ id: 'seg_0000', type: 'user_input', text: source }];
    const targetGender = detectCharacterGender(currentCharacterReference()?.character);
    const prompt = buildInputPrompt(source, settings, targetGender);
    const translations = await requestSegments(prompt, expected, { ...options, stage: options.stage || 'input-translation' });
    const result = String(translations.get('seg_0000') || '').trim();
    if (!result) throw new Error('인풋 번역 결과가 비어 있습니다.');
    return result;
}

function currentSwipeId(message) {
    if (message?.swipe_id === undefined || message?.swipe_id === null || message?.swipe_id === '') return null;
    const value = Number(message?.swipe_id);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function currentSwipeSlot(message) {
    const swipeId = currentSwipeId(message);
    const swipes = message?.swipes;
    if (swipeId === null || !Array.isArray(swipes)) {
        return {
            hasIndexedSwipe: false,
            exists: true,
            source: String(message?.mes || ''),
        };
    }
    const exists = Object.hasOwn(swipes, swipeId) && swipes[swipeId] !== undefined && swipes[swipeId] !== null;
    if (!exists) return { hasIndexedSwipe: true, exists: false, source: '' };
    const raw = swipes[swipeId];
    const source = typeof raw === 'string'
        ? raw
        : String(raw?.mes ?? raw?.text ?? raw?.content ?? raw?.message ?? '');
    return { hasIndexedSwipe: true, exists: Boolean(source.trim()), source };
}

function messageVersionSignature(message) {
    if (!message) return '';
    return `${currentSwipeId(message) ?? 'none'}:${hashText(messageSource(message))}`;
}

function storedRecordSignature(record) {
    if (!record || typeof record.sourceHash !== 'string') return '';
    return `${record.swipeId ?? 'none'}:${record.sourceHash}`;
}

function messageSource(message) {
    return currentSwipeSlot(message).source;
}

function outputSpeakerIdentity(message) {
    const context = liveContext();
    const character = currentCharacterReference()?.character;
    return {
        characterName: String(message?.name || context.name2 || '').trim(),
        characterGender: detectCharacterGender(character),
        userName: String(context.name1 || '').trim(),
    };
}

function currentRecord(message) {
    const source = messageSource(message);
    if (!source.trim()) return null;
    const swipeId = currentSwipeId(message);
    const sourceHash = hashText(source);
    const normalize = record => {
        if (
            !record
            || typeof record !== 'object'
            || record.sourceHash !== sourceHash
            || !String(record.translation || '').trim()
        ) return null;

        // Deleting a swipe shifts every following swipe index. The translation
        // still belongs to this source, so repair its stored index instead of
        // discarding the cache and translating it again.
        return record.swipeId === swipeId ? record : { ...record, swipeId };
    };

    const activeRecord = normalize(message?.extra?.[STATE_KEY]);
    if (activeRecord) return activeRecord;

    // Some SillyTavern swipe transitions replace message.extra a frame later.
    // Read the authoritative current swipe slot directly so a saved translation
    // is restored instead of being sent to the API again.
    const swipeExtra = currentSwipeExtra(message, false);
    const swipeRecord = normalize(swipeExtra?.[STATE_KEY]);
    if (swipeRecord) return swipeRecord;

    // Older translation versions may have only SillyTavern's display_text and
    // no Verba record. Treat the active display as a translation so selection
    // actions remain available without mistaking a stale swipe display for it.
    const displayExtras = [...new Set([swipeExtra, message?.extra].filter(Boolean))];
    for (const displayExtra of displayExtras) {
        const displayText = typeof displayExtra?.display_text === 'string' ? displayExtra.display_text : '';
        const displayRecord = displayExtra?.[STATE_KEY];
        if (
            displayText.trim()
            && displayText !== source
            && (!displayRecord || String(displayRecord.translation || '') === displayText)
        ) {
            return {
                swipeId,
                sourceHash,
                translation: displayText,
            };
        }
    }
    return null;
}

function currentSelectionRecord(message) {
    const record = currentRecord(message);
    if (record) return record;

    // A model may already return Korean-English bilingual dialogue. Automatic
    // translation can then skip the message as Korean-dominant, leaving no Verba
    // cache record even though the mixed-language text still needs selection tools.
    const source = messageSource(message);
    if (!hasKorean(source) || !/[A-Za-z]/.test(source)) return null;
    return {
        swipeId: currentSwipeId(message),
        sourceHash: hashText(source),
        translation: source,
        sourceMap: [],
        lockedSegments: [],
        rawBilingual: true,
    };
}

function currentSwipeExtra(message, create = true) {
    const swipeId = currentSwipeId(message);
    if (swipeId === null || !Array.isArray(message?.swipe_info)) return null;
    const swipeInfo = message.swipe_info[swipeId];
    if (!swipeInfo || typeof swipeInfo !== 'object') return null;
    if (!swipeInfo.extra || typeof swipeInfo.extra !== 'object') {
        if (!create) return null;
        swipeInfo.extra = {};
    }
    return swipeInfo.extra;
}

function repairSwipeTranslationIndexes(message) {
    if (!Array.isArray(message?.swipes) || !Array.isArray(message?.swipe_info)) return false;
    let changed = false;
    for (let index = 0; index < message.swipes.length; index += 1) {
        const swipeInfo = message.swipe_info[index];
        const extra = swipeInfo?.extra;
        const record = extra?.[STATE_KEY];
        if (!record || typeof record !== 'object' || !String(record.translation || '').trim()) continue;
        const raw = message.swipes[index];
        const source = typeof raw === 'string'
            ? raw
            : String(raw?.mes ?? raw?.text ?? raw?.content ?? raw?.message ?? '');
        if (!source.trim() || record.sourceHash !== hashText(source) || record.swipeId === index) continue;
        const previousSignature = storedRecordSignature(record);
        const repaired = { ...record, swipeId: index };
        const repairedSignature = storedRecordSignature(repaired);
        extra[STATE_KEY] = repaired;
        if (extra[SOURCE_VIEW_KEY] === previousSignature) extra[SOURCE_VIEW_KEY] = repairedSignature;
        if (currentSwipeId(message) === index && message.extra?.[STATE_KEY]?.sourceHash === record.sourceHash) {
            message.extra[STATE_KEY] = { ...repaired };
            if (message.extra[SOURCE_VIEW_KEY] === previousSignature) {
                message.extra[SOURCE_VIEW_KEY] = repairedSignature;
            }
        }
        changed = true;
    }
    return changed;
}

function sameTranslationRecord(left, right) {
    const leftMap = normalizedSourceMap(left?.sourceMap);
    const rightMap = normalizedSourceMap(right?.sourceMap);
    const sameMap = leftMap.length === rightMap.length && leftMap.every((row, index) => {
        const other = rightMap[index];
        return row.id === other?.id
            && row.source === other?.source
            && row.start === other?.start
            && row.end === other?.end;
    });
    const leftLocks = normalizedLockedSegments(left?.lockedSegments);
    const rightLocks = normalizedLockedSegments(right?.lockedSegments);
    const sameLocks = leftLocks.length === rightLocks.length && leftLocks.every((lock, index) => {
        const other = rightLocks[index];
        return lock.id === other?.id
            && lock.source === other?.source
            && lock.translation === other?.translation
            && (lock.sentenceIndex ?? null) === (other?.sentenceIndex ?? null);
    });
    return Boolean(
        left
        && right
        && left.swipeId === right.swipeId
        && left.sourceHash === right.sourceHash
        && left.translation === right.translation
        && sameMap
        && sameLocks
    );
}

/**
 * SillyTavern stores each swipe's `extra` independently. Mirror Verba's owned
 * display state into the active swipe immediately so returning to that swipe
 * can restore the translation without another API request.
 */
function syncOwnedTranslationToCurrentSwipe(message, record) {
    const swipeExtra = currentSwipeExtra(message);
    if (!swipeExtra) return false;
    let changed = false;
    if (!sameTranslationRecord(swipeExtra[STATE_KEY], record)) {
        swipeExtra[STATE_KEY] = { ...record };
        changed = true;
    }
    if (swipeExtra.display_text !== record.translation) {
        swipeExtra.display_text = record.translation;
        changed = true;
    }
    if (swipeExtra[SOURCE_VIEW_KEY]) {
        delete swipeExtra[SOURCE_VIEW_KEY];
        changed = true;
    }
    return changed;
}

function renderVerbaDisplayFallback(messageId, message, mounted = null) {
    const id = Number(messageId);
    const messageElement = mounted || (
        Number.isInteger(id)
            ? document.querySelector(`.mes[mesid="${id}"]`)
            : null
    );
    if (!messageElement) return false;

    const textElement = messageElement.querySelector(
        '.mes_text:not(.verba-swipe-hold-content)',
    );
    if (!textElement) return false;

    const displayText = String(
        message?.extra?.display_text
        ?? currentRecord(message)?.translation
        ?? messageSource(message)
        ?? '',
    );
    if (!displayText.trim()) return false;

    try {
        // Important: render only the message text. Do NOT call SillyTavern's
        // full updateMessageBlock again here, because the full update also
        // initializes the Reasoning UI and that is exactly where some ST/mobile
        // layouts throw on missing reasoning DOM nodes.
        const html = messageFormatting(
            displayText,
            String(message?.name || ''),
            false,
            false,
            id,
            {},
            false,
        );
        textElement.innerHTML = String(html || '');
        textElement.classList.remove('verba-render-fallback-failed');
        messageElement.classList.add('verba-render-fallback-used');
        setTimeout(() => messageElement.classList.remove('verba-render-fallback-used'), 900);
        setTimeout(refreshTranslationClasses, 0);
        return true;
    } catch (error) {
        console.error(`[베르바] 메시지 #${id} 직접 표시 fallback 실패`, error);
        textElement.classList.add('verba-render-fallback-failed');
        return false;
    }
}

function updateMessageBlock(messageId, message) {
    const id = Number(messageId);
    const mounted = Number.isInteger(id)
        ? document.querySelector(`.mes[mesid="${id}"]`)
        : null;

    // Off-screen old messages are allowed to stay unmounted. Their Verba cache
    // and display_text are already saved and they will render when ST loads them.
    if (!mounted) {
        setTimeout(refreshTranslationClasses, 40);
        return { status: 'not-mounted', rendered: false };
    }

    try {
        liveContext().updateMessageBlock?.(id, message);
        setTimeout(refreshTranslationClasses, 40);
        return { status: 'updated', rendered: true };
    } catch (error) {
        console.warn(
            `[베르바] SillyTavern 메시지 #${id} 전체 재렌더링 실패 — 베르바 직접 표시 fallback을 시도합니다.`,
            error,
        );

        const fallbackRendered = renderVerbaDisplayFallback(id, message, mounted);
        if (fallbackRendered) {
            console.warn(
                `[베르바] 메시지 #${id}는 ST 전체 렌더러 대신 베르바 직접 표시 fallback으로 적용했습니다.`,
            );
            return {
                status: 'fallback',
                rendered: true,
                error,
            };
        }

        const renderError = new Error(
            `번역은 생성·저장됐지만 메시지 #${id}를 화면에 표시하지 못했습니다: ${errorText(error)}`,
            { cause: error },
        );
        reportError(
            'output-render',
            renderError,
            `번역은 저장됐지만 화면 표시 실패: ${errorText(error)}`,
        );
        setTimeout(refreshTranslationClasses, 40);
        return {
            status: 'failed',
            rendered: false,
            error: renderError,
        };
    }
}
function renderedTranslationKey(messageId, record) {
    const signature = storedRecordSignature(record);
    return signature ? `${Number(messageId)}:${signature}` : '';
}

function cacheRenderedTranslation(messageId, message, record) {
    const key = renderedTranslationKey(messageId, record);
    if (!key) return;
    setTimeout(() => {
        const current = liveContext().chat?.[messageId];
        const currentRecordValue = current && currentRecord(current);
        if (
            current !== message
            || !sameTranslationRecord(currentRecordValue, record)
            || current.extra?.display_text !== record.translation
        ) return;
        const textElement = document.querySelector(`.mes[mesid="${Number(messageId)}"] .mes_text`);
        if (!textElement || textElement.closest('.mes')?.classList.contains('verba-swipe-hold-active')) return;
        const html = textElement.innerHTML;
        if (!html.trim()) return;
        renderedTranslationCache.set(key, html);
        lastRenderedTranslationByMessage.set(Number(messageId), {
            signature: storedRecordSignature(record),
            record: { ...record },
            html,
        });
    }, 80);
}

function captureSwipeHold(messageId, message) {
    const id = Number(messageId);
    const slot = currentSwipeSlot(message);
    const ownedRecord = message?.extra?.[STATE_KEY];
    const lastRendered = lastRenderedTranslationByMessage.get(id);
    const matchedRecord = message && currentRecord(message);
    const record = matchedRecord || (
        ownedRecord && String(ownedRecord.translation || '').trim()
            ? ownedRecord
            : slot.hasIndexedSwipe && !slot.exists
                ? lastRendered?.record
                : null
    );
    if (!record) return null;
    const signature = storedRecordSignature(record);
    const key = renderedTranslationKey(id, record);
    let html = renderedTranslationCache.get(key)
        || (lastRendered?.record?.sourceHash === record.sourceHash ? lastRendered.html : '');
    if (!html && message?.extra?.display_text === record.translation) {
        html = document.querySelector(`.mes[mesid="${id}"] .mes_text`)?.innerHTML || '';
    }
    if (!html) return null;
    return { signature, html };
}

function renderSwipeHold(messageId, job) {
    if (!job?.hold?.html) return;
    const messageElement = document.querySelector(`.mes[mesid="${Number(messageId)}"]`);
    const textElement = messageElement?.querySelector('.mes_text:not(.verba-swipe-hold-content)');
    if (!messageElement || !textElement) return;
    let holdElement = messageElement.querySelector('.verba-swipe-hold-content');
    if (!holdElement) {
        holdElement = document.createElement('div');
        holdElement.className = 'mes_text verba-swipe-hold-content';
        textElement.insertAdjacentElement('afterend', holdElement);
    }
    if (holdElement.innerHTML !== job.hold.html) holdElement.innerHTML = job.hold.html;
    messageElement.classList.add('verba-swipe-hold-active');
}

function releaseSwipeHold(messageId) {
    const messageElement = document.querySelector(`.mes[mesid="${Number(messageId)}"]`);
    messageElement?.classList.remove('verba-swipe-hold-active');
    messageElement?.querySelectorAll('.verba-swipe-hold-content').forEach(element => element.remove());
}

function finishSwipeTranslationJob(messageId, job) {
    const id = Number(messageId);
    if (swipeTranslationJobs.get(id) !== job) return;
    if (job.timer) clearTimeout(job.timer);
    swipeTranslationJobs.delete(id);
    releaseSwipeHold(id);
}

function clearOwnedDisplay(message) {
    if (!message?.extra) return false;
    const record = message.extra[STATE_KEY];
    if (record && message.extra.display_text === record.translation) delete message.extra.display_text;
    delete message.extra[STATE_KEY];
    delete message.extra[SOURCE_VIEW_KEY];
    const swipeExtra = currentSwipeExtra(message);
    if (swipeExtra) {
        if (record && swipeExtra.display_text === record.translation) delete swipeExtra.display_text;
        delete swipeExtra[STATE_KEY];
        delete swipeExtra[SOURCE_VIEW_KEY];
    }
    return Boolean(record);
}

function applyTranslation(messageId, message, source, translation, chatReference, metadata = {}) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    const previousRecord = currentRecord(message);
    const sourceMap = metadata.sourceMap !== undefined
        ? normalizedSourceMap(metadata.sourceMap)
        : previousRecord?.translation === translation
            ? normalizedSourceMap(previousRecord.sourceMap)
            : [];
    const lockedSegments = metadata.lockedSegments !== undefined
        ? normalizedLockedSegments(metadata.lockedSegments)
        : previousRecord?.sourceHash === hashText(source)
            ? normalizedLockedSegments(previousRecord.lockedSegments)
            : [];
    const record = {
        swipeId: currentSwipeId(message),
        sourceHash: hashText(source),
        translation,
        sourceMap,
        lockedSegments,
        updatedAt: new Date().toISOString(),
    };
    message.extra[STATE_KEY] = record;
    message.extra.display_text = translation;
    delete message.extra[SOURCE_VIEW_KEY];
    syncOwnedTranslationToCurrentSwipe(message, record);
    if (
        multiSelectionState?.messageId === Number(messageId)
        && multiSelectionState.translation !== translation
    ) clearMultiSelection();
    const renderResult = updateMessageBlock(messageId, message);
    cacheRenderedTranslation(messageId, message, record);
    scheduleChatSave(chatReference);
    return {
        record,
        renderResult,
    };
}

function sourceViewRequested(message, record) {
    if (!message || !record) return false;
    const signature = storedRecordSignature(record);
    const swipeExtra = currentSwipeExtra(message, false);
    return message.extra?.[SOURCE_VIEW_KEY] === signature
        || swipeExtra?.[SOURCE_VIEW_KEY] === signature;
}

function showOriginalDisplay(messageId, message, record) {
    if (!message || !record) return;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    const signature = storedRecordSignature(record);
    let changed = false;
    if (!sameTranslationRecord(message.extra[STATE_KEY], record)) {
        message.extra[STATE_KEY] = { ...record };
        changed = true;
    }
    if (message.extra.display_text === record.translation) {
        delete message.extra.display_text;
        changed = true;
    }
    if (message.extra[SOURCE_VIEW_KEY] !== signature) {
        message.extra[SOURCE_VIEW_KEY] = signature;
        changed = true;
    }
    const swipeExtra = currentSwipeExtra(message);
    if (swipeExtra) {
        if (!sameTranslationRecord(swipeExtra[STATE_KEY], record)) {
            swipeExtra[STATE_KEY] = { ...record };
            changed = true;
        }
        if (swipeExtra.display_text === record.translation) {
            delete swipeExtra.display_text;
            changed = true;
        }
        if (swipeExtra[SOURCE_VIEW_KEY] !== signature) {
            swipeExtra[SOURCE_VIEW_KEY] = signature;
            changed = true;
        }
    }
    if (changed) {
        updateMessageBlock(messageId, message);
        scheduleChatSave(liveContext().chat);
    }
}

function restoreCurrentDisplay(messageId, message, record) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    if (sourceViewRequested(message, record)) {
        showOriginalDisplay(messageId, message, record);
        return;
    }
    const recordChanged = !sameTranslationRecord(message.extra[STATE_KEY], record);
    if (recordChanged) message.extra[STATE_KEY] = { ...record };
    const displayChanged = message.extra.display_text !== record.translation;
    if (displayChanged) message.extra.display_text = record.translation;
    const sourceViewChanged = Boolean(message.extra[SOURCE_VIEW_KEY]);
    if (sourceViewChanged) delete message.extra[SOURCE_VIEW_KEY];
    const cacheChanged = syncOwnedTranslationToCurrentSwipe(message, record);
    if (displayChanged || recordChanged) updateMessageBlock(messageId, message);
    cacheRenderedTranslation(messageId, message, record);
    if (displayChanged || recordChanged || sourceViewChanged || cacheChanged) scheduleChatSave(liveContext().chat);
}

function showTranslationDisplay(messageId, message, record) {
    if (!message || !record) return;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    delete message.extra[SOURCE_VIEW_KEY];
    const swipeExtra = currentSwipeExtra(message, false);
    if (swipeExtra) delete swipeExtra[SOURCE_VIEW_KEY];
    restoreCurrentDisplay(messageId, message, record);
}


const COMMON_DIALOGUE_ENDINGS = [
    '잖아요', '거든요', '는데요', '네요', '군요', '구나', '군', '잖아', '거든', '는데', '네',
    '라고요', '라고', '냐고', '냐', '니', '지', '죠', '지요', '나요', '가요', '까요',
    '어요', '아요', '해요', '예요', '이에요', '입니다', '습니다', '습니까',
    '어', '아', '야', '해', '래', '대', '데', '걸', '거야', '거냐', '건가', '겠어',
    '겠네', '겠지', '했어', '했지', '했네', '하자', '하지', '하네', '하냐', '하니',
];

function normalizedEndingPattern(value) {
    return String(value || '')
        .trim()
        .replace(/^[~～]+/u, '')
        .replace(/[.!?…。？！~～"'“”‘’)\]}]+$/gu, '')
        .trim();
}

function dialogueEndingCandidates() {
    const preferred = String(settings.dialogueEndingPreferred || '')
        .split(/\r?\n/u)
        .map(normalizedEndingPattern)
        .filter(Boolean);
    const avoided = String(settings.dialogueEndingAvoid || '')
        .split(/\r?\n/u)
        .map(normalizedEndingPattern)
        .filter(Boolean);

    return [...new Set([...preferred, ...avoided, ...COMMON_DIALOGUE_ENDINGS])]
        .filter(item => item.length >= 1)
        .sort((a, b) => b.length - a.length);
}

function endingFromDialogueSentence(sentence, candidates) {
    const cleaned = String(sentence || '')
        .replace(/^[\s"'“”‘’「」『』()[\]{}]+/gu, '')
        .replace(/[\s"'“”‘’「」『』()[\]{}.!?…。？！~～]+$/gu, '')
        .trim();
    if (!cleaned || !/[가-힣]/u.test(cleaned)) return '';

    for (const ending of candidates) {
        if (cleaned.endsWith(ending)) return ending;
    }
    return '';
}

function translatedDialogueEndings(translation) {
    const segmented = segmentSource(String(translation || ''), []);
    const candidates = dialogueEndingCandidates();
    const endings = [];

    for (const segment of segmented.segments || []) {
        if (segment.type !== 'dialogue_candidate') continue;
        const dialogue = String(segment.text || '')
            .replace(/^[\s"'“”‘’「」『』]+/u, '')
            .replace(/[\s"'“”‘’「」『』]+$/u, '');

        const sentences = dialogue
            .split(/(?<=[.!?…。？！])\s+|\n+/u)
            .map(item => item.trim())
            .filter(Boolean);

        for (const sentence of sentences) {
            const ending = endingFromDialogueSentence(sentence, candidates);
            if (ending) endings.push(ending);
        }
    }

    return endings;
}

function recentDialogueEndingRepeatHints(beforeMessageId) {
    if (settings.dialogueEndingRepetitionReduction === false) return [];

    const chat = liveContext().chat || [];
    const beforeId = Number(beforeMessageId);
    const collected = [];

    // Use only saved Verba translations from recent assistant outputs.
    // Hidden/ghosted assistant outputs count too; user inputs do not.
    for (let id = Math.min(chat.length - 1, beforeId - 1); id >= 0 && collected.length < 28; id -= 1) {
        const message = chat[id];
        if (!message || message.is_user || !isNameReplacementMessage(message)) continue;

        // Character-only preference history: count only outputs whose speaker
        // identity resolves to the current target character. NPC/USER outputs
        // must not influence the character's ending preference hints.
        const speaker = outputSpeakerIdentity(message);
        if (!speaker?.isTargetCharacter) continue;

        const record = currentRecord(message);
        if (!record?.translation) continue;

        const endings = translatedDialogueEndings(record.translation);
        for (let i = endings.length - 1; i >= 0 && collected.length < 28; i -= 1) {
            collected.push(endings[i]);
        }
    }

    if (collected.length < 4) return [];

    const recent = collected.slice(0, 20);
    const counts = new Map();
    for (const ending of recent) counts.set(ending, (counts.get(ending) || 0) + 1);

    // A repeated ending becomes a prompt hint only when it is genuinely
    // noticeable: 3+ uses in the recent window or a 2-sentence streak.
    const streaked = new Set();
    for (let i = 0; i < recent.length - 1; i += 1) {
        if (recent[i] && recent[i] === recent[i + 1]) streaked.add(recent[i]);
    }

    return [...counts.entries()]
        .filter(([ending, count]) => count >= 3 || (count >= 2 && streaked.has(ending)))
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, 3)
        .map(([ending, count]) => ({ ending: `~${ending}`, count }));
}

async function translateMessage(messageId, options = {}) {
    const id = Number(messageId);
    if (!Number.isInteger(id)) return;
    const context = liveContext();
    const chatReference = context.chat;
    const message = chatReference?.[id];
    if (!message || message.is_user || !isNameReplacementMessage(message)) return;
    const source = messageSource(message);
    if (!source.trim()) return;

    if (options.automatic && isPredominantlyKorean(source)) {
        console.log(`[베르바] 한국어 중심 출력 자동 제외 #${id}`);
        return;
    }
    if (!hasForeignText(source)) {
        if (!options.automatic) notify('번역할 외국어 원문이 없어요.', 'warning');
        return;
    }
    if (!settings.profileId) {
        if (!options.automatic) notify('먼저 번역기 전용 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }

    const record = currentRecord(message);
    if (!options.force && record) {
        failedOutputSignatures.delete(id);
        restoreCurrentDisplay(id, message, record);
        return;
    }
    if (pendingOutputs.has(id)) {
        if (!options.force) return pendingOutputs.get(id).work;
        abortPendingOutput(id, outputAbortReason(
            'VERBA_OUTPUT_REPLACED',
            '새 전체 재번역 요청으로 이전 작업을 교체했습니다.',
            true,
        ));
    }

    const outputJobStartedAt = performance.now();
    const outputJobSlot = activeProfileSlot();
    let outputJobSuccess = null;
    const controller = new AbortController();
    const snapshot = {
        chatReference,
        message,
        source,
        sourceHash: hashText(source),
        swipeId: currentSwipeId(message),
        previousRecord: record ? {
            ...record,
            sourceMap: normalizedSourceMap(record.sourceMap),
            lockedSegments: normalizedLockedSegments(record.lockedSegments),
        } : null,
    };
    let toast = showProgress(options.force ? '아웃풋 전체를 다시 번역 중입니다…' : '아웃풋을 자동 번역 중입니다…');
    const work = (async () => {
        try {
            const translated = await translateOutputText(source, {
                signal: controller.signal,
                oneTimeInstruction: options.oneTimeInstruction || '',
                tuning: {
                    ...(options.tuning && typeof options.tuning === 'object' ? options.tuning : {}),
                    dialogueEndingRepeatHints: recentDialogueEndingRepeatHints(id),
                },
                speakerIdentity: outputSpeakerIdentity(message),
                stage: options.force ? 'output-retranslation' : 'output-translation',
            });
            if (controller.signal.aborted) throw controller.signal.reason || abortError();
            const latestContext = liveContext();
            const latest = latestContext.chat?.[id];
            if (
                latestContext.chat !== snapshot.chatReference
                || latest !== snapshot.message
                || currentSwipeId(latest) !== snapshot.swipeId
                || hashText(messageSource(latest)) !== snapshot.sourceHash
            ) {
                const stillSameChat = latestContext.chat === snapshot.chatReference;
                const canRetryLatest = stillSameChat
                    && latest
                    && !latest.is_user
                    && !latest.is_system
                    && messageSource(latest).trim();
                const staleRetryCount = Math.max(0, Number(options.staleRetryCount) || 0);
                if (canRetryLatest && staleRetryCount < 1) {
                    scheduleAutomaticTranslation(id, 180, { staleRetryCount: staleRetryCount + 1 });
                }
                throw new Error(
                    canRetryLatest && staleRetryCount < 1
                        ? '번역 도중 메시지 또는 스와이프가 바뀌어 이전 결과를 폐기하고 최신 답변 번역을 다시 예약했습니다.'
                        : '번역 도중 메시지 또는 스와이프가 바뀌어 결과를 적용하지 못했습니다.',
                );
            }
            const finalTranslation = translationWithLockedSegments(
                translated,
                snapshot.previousRecord?.lockedSegments,
            );
            const applied = applyTranslation(
                id,
                latest,
                source,
                finalTranslation.translation,
                snapshot.chatReference,
                {
                    sourceMap: finalTranslation.sourceMap,
                    lockedSegments: [],
                },
            );
            clearTransientTranslationSelections();

            if (applied?.renderResult?.status === 'failed') {
                // The translated text is preserved in Verba storage, but the
                // user must not see the progress toast simply disappear while
                // the visible message remains unchanged.
                outputJobSuccess = false;
                failedOutputSignatures.set(id, `${snapshot.swipeId ?? 'none'}:${snapshot.sourceHash}`);
                return;
            }

            failedOutputSignatures.delete(id);
            outputJobSuccess = true;
            notify(options.force ? '전체 재번역을 적용했어요.' : '자동 번역을 적용했어요.', 'success');
        } catch (error) {
            if (isAbort(error, controller.signal)) {
                const reason = controller.signal.reason;
                const silentCode = String(reason?.verbaCode || '');
                const allowedSilentAbort = reason?.silent === true && [
                    'VERBA_OUTPUT_REPLACED',
                    'VERBA_SWIPE_CHANGED',
                    'VERBA_CHAT_CHANGED',
                ].includes(silentCode);

                if (allowedSilentAbort) {
                    console.info(`[베르바] 의도된 내부 번역 교체/전환으로 작업 종료: ${silentCode}`);
                    outputJobSuccess = false;
                } else {
                    outputJobSuccess = false;
                    failedOutputSignatures.set(id, `${snapshot.swipeId ?? 'none'}:${snapshot.sourceHash}`);
                    const reasonMessage = String(reason?.message || error?.message || '알 수 없는 이유');
                    console.warn('[베르바] 출력 번역 중단', reason || error);
                    reportError('output-aborted', reason || error, `출력 번역 중단: ${reasonMessage}`);
                }
            } else {
                outputJobSuccess = false;
                failedOutputSignatures.set(id, `${snapshot.swipeId ?? 'none'}:${snapshot.sourceHash}`);
                console.error('[베르바] 출력 번역 실패', error);
                reportError(options.force ? 'output-retranslation' : 'output-translation', error, `출력 번역 실패: ${errorText(error)}`);
            }
        } finally {
            if (outputJobSuccess === null && !controller.signal.aborted) {
                outputJobSuccess = false;
                failedOutputSignatures.set(id, `${snapshot.swipeId ?? 'none'}:${snapshot.sourceHash}`);
                console.error('[베르바] 출력 번역이 결과 없이 종료되었습니다.');
                reportError('output-no-result', new Error('출력 번역 작업이 결과 없이 종료되었습니다.'), '출력 번역 실패: 작업이 결과 없이 종료되었습니다. 다시 시도해 주세요.');
            }
            if (outputJobSuccess !== null) {
                recordOutputTranslation(outputJobSlot, {
                    success: outputJobSuccess,
                    elapsedMs: performance.now() - outputJobStartedAt,
                });
            }
            clearProgress(toast);
            if (pendingOutputs.get(id)?.controller === controller) pendingOutputs.delete(id);
            refreshRetranslateButton();
        }
        return outputJobSuccess === true;
    })();
    pendingOutputs.set(id, { controller, work });
    refreshRetranslateButton();
    return work;
}

function latestAssistantMessage() {
    const chat = liveContext().chat || [];
    for (let id = chat.length - 1; id >= 0; id -= 1) {
        const message = chat[id];
        if (message && isNameReplacementMessage(message) && messageSource(message).trim()) {
            return { id, message };
        }
    }
    return null;
}


function rememberRetranslationInstruction(value) {
    const instruction = String(value || '').trim();
    if (!instruction) return;
    settings.retranslationInstructionHistory = [
        instruction,
        ...settings.retranslationInstructionHistory.filter(item => item !== instruction),
    ].slice(0, 5);
    saveSettings();
}

function retranslationInstructionHistoryMarkup() {
    const history = Array.isArray(settings.retranslationInstructionHistory)
        ? settings.retranslationInstructionHistory.slice(0, 5)
        : [];
    if (!history.length) return '';

    return `
        <div class="verba-request-history">
            <div class="verba-request-history-header">
                <span>최근 요구사항</span>
                <button type="button" class="verba-request-history-clear">기록 지우기</button>
            </div>
            <div class="verba-request-history-list">
                ${history.map((item, index) => `
                    <button type="button" class="verba-request-history-chip" data-history-index="${index}" title="${escapeHtml(item)}">
                        ${escapeHtml(item)}
                    </button>`).join('')}
            </div>
        </div>`;
}

function requestOneTimeInstruction(scope, preview = '', titleOverride = '') {
    if (document.querySelector('#verba-request-overlay')) return Promise.resolve(null);
    const isSelection = scope === 'selection';
    const isMultiSelection = scope === 'multi';
    const isPartialSelection = isSelection || isMultiSelection;
    const showContextChoice = isPartialSelection;
    const showTuning = true;
    const defaultTuning = normalizedTranslationTuning(settings);
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>${escapeHtml(titleOverride || (isMultiSelection ? '여러 구간 묶음 재번역' : isSelection ? '선택 부분 재번역' : '최근 아웃풋 전체 재번역'))}</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                ${preview ? `<div class="verba-target-preview"><b>대상</b><span>${escapeHtml(preview)}</span></div>` : ''}
                <label for="verba-request-text">이번 번역에만 적용할 요구사항</label>
                <textarea id="verba-request-text" class="text_pole" rows="5" maxlength="1200" placeholder="예: 더 직설적으로 번역해 줘 / 존댓말로 바꿔 줘"></textarea>
                <small>비워두면 현재 전역 설정대로 다시 번역해요.</small>
                ${retranslationInstructionHistoryMarkup()}
                ${showTuning ? `
                    <fieldset class="verba-tuning-choice">
                        <legend>번역 미세 조정 <small>이번 요청에만 적용</small></legend>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-request-relation-temperature-enabled" ${defaultTuning.relationTemperatureEnabled ? 'checked' : ''}>
                            <span>관계 온도·현지화 적용</span>
                        </label>
                        <div id="verba-request-fine-tuning-controls" class="verba-tuning-control-group ${defaultTuning.relationTemperatureEnabled ? '' : 'verba-control-disabled'}">
                            <span class="verba-tuning-label">관계 온도 <small>대사만</small></span>
                            ${tuningChoiceMarkup('verba-request-relation-temperature', RELATION_TEMPERATURE_OPTIONS, defaultTuning.relationTemperature)}
                            <span class="verba-tuning-label">서술 현지화</span>
                            ${tuningChoiceMarkup('verba-request-narration-localization-level', LOCALIZATION_LEVEL_OPTIONS, defaultTuning.narrationLocalizationLevel)}
                            <span class="verba-tuning-label">대사 현지화</span>
                            ${tuningChoiceMarkup('verba-request-dialogue-localization-level', LOCALIZATION_LEVEL_OPTIONS, defaultTuning.dialogueLocalizationLevel)}
                        </div>
                    </fieldset>
                    <small>원문 유지부터 네이티브 한국어까지 표현 강도만 조절하며 인명·지명·숫자·사실관계는 바꾸지 않아요.</small>
                ` : ''}
                ${showContextChoice ? `
                    <fieldset class="verba-context-choice">
                        <legend>AI가 참고할 현재 메시지 문맥</legend>
                        <label><input type="radio" name="verba-context-mode" value="narrow"> 선택 주변</label>
                        <label><input type="radio" name="verba-context-mode" value="paragraph" checked> 현재 문단</label>
                        <label><input type="radio" name="verba-context-mode" value="message"> 메시지 전체</label>
                    </fieldset>
                    <small>실제로 교체되는 범위는 선택한 부분뿐이에요.</small>
                ` : ''}
                <div class="verba-modal-actions">
                    <button type="button" class="menu_button verba-submit">${isSelection && settings.selectionCandidates ? '후보 만들기' : '재번역 시작'}</button>
                </div>
            </section>`;
        // SillyTavern themes and mobile drawers sometimes create their own stacking
        // contexts. Mount the dialog at the document root and force its geometry so
        // it stays centred in the viewport regardless of those parent styles.
        document.documentElement.append(overlay);
        const forcedOverlayStyles = {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100dvh',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'none',
            zIndex: '2147483646',
        };
        Object.entries(forcedOverlayStyles).forEach(([property, value]) => {
            overlay.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), value, 'important');
        });
        const modal = overlay.querySelector('.verba-modal');
        ['position', 'inset', 'margin', 'transform'].forEach((property, index) => {
            modal.style.setProperty(property, ['relative', 'auto', 'auto', 'none'][index], 'important');
        });
        try {
            overlay.showPopover?.();
        } catch {
            // Older mobile browsers simply use the fixed-position fallback.
        }
        let settled = false;
        let finish = value => {
            if (settled) return;
            settled = true;
            try {
                overlay.hidePopover?.();
            } catch {
                // It may already have left the top layer.
            }
            overlay.remove();
            resolve(value);
        };
        const textarea = overlay.querySelector('#verba-request-text');
        const submit = () => {
            const instruction = String(textarea.value || '').trim();
            if (instruction) rememberRetranslationInstruction(instruction);
            if (!showContextChoice && !showTuning) {
                finish(instruction);
                return;
            }
            finish({
                instruction,
                contextMode: overlay.querySelector('input[name="verba-context-mode"]:checked')?.value || 'paragraph',
                tuning: showTuning ? normalizedTranslationTuning({
                    relationTemperatureEnabled: overlay.querySelector('#verba-request-relation-temperature-enabled')?.checked,
                    relationTemperature: overlay.querySelector('input[name="verba-request-relation-temperature"]:checked')?.value,
                    narrationLocalizationLevel: overlay.querySelector('input[name="verba-request-narration-localization-level"]:checked')?.value,
                    dialogueLocalizationLevel: overlay.querySelector('input[name="verba-request-dialogue-localization-level"]:checked')?.value,
                }) : null,
            });
        };
        overlay.querySelector('.verba-close').addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-submit').addEventListener('click', submit);
        overlay.querySelectorAll('.verba-request-history-chip').forEach(button => {
            button.addEventListener('click', () => {
                const index = Number(button.dataset.historyIndex);
                const value = settings.retranslationInstructionHistory[index];
                if (!value) return;
                textarea.value = value;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
                textarea.setSelectionRange?.(textarea.value.length, textarea.value.length);
            });
        });
        overlay.querySelector('.verba-request-history-clear')?.addEventListener('click', () => {
            settings.retranslationInstructionHistory = [];
            saveSettings();
            overlay.querySelector('.verba-request-history')?.remove();
            textarea.focus();
        });
        if (showTuning) {
            const relationToggle = overlay.querySelector('#verba-request-relation-temperature-enabled');
            const relationControls = overlay.querySelector('#verba-request-fine-tuning-controls');
            const relationInputs = [
                ...overlay.querySelectorAll('input[name="verba-request-relation-temperature"]'),
                ...overlay.querySelectorAll('input[name="verba-request-narration-localization-level"]'),
                ...overlay.querySelectorAll('input[name="verba-request-dialogue-localization-level"]'),
            ];
            const syncRelationControls = () => {
                const enabled = Boolean(relationToggle?.checked);
                relationControls?.classList.toggle('verba-control-disabled', !enabled);
                relationInputs.forEach(input => { input.disabled = !enabled; });
            };
            relationToggle?.addEventListener('change', syncRelationControls);
            syncRelationControls();
        }
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(null);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') finish(null);
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit();
        });
        requestAnimationFrame(() => textarea.focus());
    });
}

function requestNameLockTarget(sourceName, currentName) {
    if (document.querySelector('#verba-request-overlay')) return Promise.resolve(null);
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>캐릭터 이름으로 고정</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                <div class="verba-name-match">
                    <span>원문에서 찾은 이름</span><b>${escapeHtml(sourceName)}</b>
                    <span>현재 번역 표기</span><b>${escapeHtml(currentName)}</b>
                </div>
                <label for="verba-name-lock-target">앞으로 사용할 표기</label>
                <input id="verba-name-lock-target" class="text_pole" maxlength="120" value="${escapeHtml(currentName)}">
                <label class="verba-check-row">
                    <input type="checkbox" id="verba-name-lock-history" checked>
                    <span>현재 채팅 전체의 이름 표기 모두 변경</span>
                </label>
                <small>원문에서 같은 이름을 찾아 이전 메시지와 다른 스와이프에 서로 다르게 번역된 표기까지 자동으로 통일합니다.</small>
                <div class="verba-modal-actions">
                    <button type="button" class="menu_button verba-cancel">취소</button>
                    <button type="button" class="menu_button verba-submit">이름 고정</button>
                </div>
            </section>`;
        document.documentElement.append(overlay);
        try {
            overlay.showPopover?.();
        } catch {
            // Fixed-position fallback.
        }
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            try {
                overlay.hidePopover?.();
            } catch {
                // It may already be closed.
            }
            overlay.remove();
            resolve(value);
        };
        const input = overlay.querySelector('#verba-name-lock-target');
        const history = overlay.querySelector('#verba-name-lock-history');
        const submit = () => {
            const value = String(input.value || '').trim();
            if (!value) {
                notify('고정할 이름 표기를 입력해 주세요.', 'warning');
                return;
            }
            finish({
                targetName: value,
                replaceHistory: Boolean(history.checked),
            });
        };
        overlay.querySelector('.verba-close').addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-cancel').addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-submit').addEventListener('click', submit);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(null);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') finish(null);
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    });
}

function sourceContainsExactName(source, sourceName) {
    const text = String(source || '');
    const name = String(sourceName || '').trim();
    if (!text || !name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
    } catch {
        return text.toLocaleLowerCase().includes(name.toLocaleLowerCase());
    }
}

function isNameReplacementMessage(message) {
    if (!message || message.is_user) return false;
    if (!message.is_system) return true;
    const context = liveContext();
    const messageName = String(message.name || '').trim();
    const characterName = String(context.name2 || '').trim();
    const hasCharacterTranslation = Boolean(
        message.extra?.[STATE_KEY]
        || String(message.extra?.display_text || '').trim()
        || Array.isArray(message.swipes),
    );
    return hasCharacterTranslation || Boolean(messageName && characterName && messageName === characterName);
}

function validStoredTranslationRecord(extra, source) {
    const record = extra?.[STATE_KEY];
    if (
        !record
        || typeof record !== 'object'
        || record.sourceHash !== hashText(source)
        || !String(record.translation || '').trim()
    ) return null;
    return record;
}

function storedTranslationView(extra, source) {
    if (!extra || typeof extra !== 'object') return null;
    const record = validStoredTranslationRecord(extra, source);
    if (record) {
        return {
            record,
            translation: String(record.translation),
        };
    }

    const displayText = typeof extra.display_text === 'string' ? extra.display_text : '';
    if (!displayText.trim() || displayText === String(source || '')) return null;
    return {
        record: null,
        translation: displayText,
    };
}

function stripKoreanNameSuffixes(word) {
    const suffixes = [
        '으로부터', '에게서', '한테서', '에서부터', '이라고', '이라며', '이라는', '이라면',
        '으로', '에게', '한테', '께서', '부터', '까지', '처럼', '보다', '라고', '라며', '라는', '라면',
        '이랑', '하고', '에서', '께', '에', '와', '과', '랑', '은', '는', '이', '가', '을', '를', '의', '도', '만', '씨', '님',
    ].sort((left, right) => right.length - left.length);
    const forms = new Set([word]);
    let current = word;
    while (current.length > 1) {
        const suffix = suffixes.find(item => current.endsWith(item) && current.length - item.length >= 2);
        if (!suffix) break;
        current = current.slice(0, -suffix.length);
        forms.add(current);
    }
    return [...forms];
}

function stringDistance(left, right) {
    const a = [...String(left || '')];
    const b = [...String(right || '')];
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const saved = row[j];
            row[j] = Math.min(
                row[j] + 1,
                row[j - 1] + 1,
                previous + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            previous = saved;
        }
    }
    return row[b.length];
}

function collectHistoricalNameCandidates(sourceName, currentName) {
    const chat = liveContext().chat;
    if (!Array.isArray(chat)) return { candidates: [currentName], translations: [] };
    const translations = [];
    const seenRecords = new Set();
    const addTranslation = (translation, key) => {
        const text = String(translation || '');
        if (!text.trim() || seenRecords.has(key)) return;
        seenRecords.add(key);
        translations.push(text);
    };
    const addRecord = (extra, source) => {
        if (!sourceContainsExactName(source, sourceName)) return;
        const stored = storedTranslationView(extra, source);
        if (!stored) return;
        const translation = stored.translation;
        const key = `${hashText(source)}\u0000${translation}`;
        addTranslation(translation, key);
    };

    for (const message of chat) {
        if (!isNameReplacementMessage(message)) continue;
        if (Array.isArray(message.swipes)) {
            message.swipes.forEach((rawSource, swipeId) => {
                const source = typeof rawSource === 'string'
                    ? rawSource
                    : String(rawSource?.mes ?? rawSource?.text ?? rawSource?.content ?? rawSource?.message ?? '');
                addRecord(message.swipe_info?.[swipeId]?.extra, source);
                if (isPredominantlyKorean(source)) addTranslation(source, `raw:${hashText(source)}`);
            });
        }
        const activeSource = messageSource(message);
        addRecord(message.extra, activeSource);
        if (isPredominantlyKorean(activeSource)) addTranslation(activeSource, `raw:${hashText(activeSource)}`);
    }

    const frequency = new Map();
    const addCandidate = value => {
        const candidate = String(value || '').trim();
        if (!candidate || candidate.length > 120) return;
        frequency.set(candidate, (frequency.get(candidate) || 0) + 1);
    };
    addCandidate(currentName);
    for (const translation of translations) {
        for (const match of translation.matchAll(/[\p{Script=Hangul}]{2,30}/gu)) {
            for (const form of stripKoreanNameSuffixes(match[0])) addCandidate(form);
        }
        for (const match of translation.matchAll(/[A-Za-z][A-Za-z'’-]{1,40}/g)) addCandidate(match[0]);
    }

    const candidates = [...frequency.keys()].sort((left, right) => {
        if (left === currentName) return -1;
        if (right === currentName) return 1;
        const distance = stringDistance(left, currentName) - stringDistance(right, currentName);
        if (distance) return distance;
        const count = (frequency.get(right) || 0) - (frequency.get(left) || 0);
        return count || left.localeCompare(right, 'ko');
    }).slice(0, 800);
    return { candidates, translations };
}

async function detectHistoricalNameForms(sourceName, currentName, knownNames = [], options = {}) {
    const collected = collectHistoricalNameCandidates(sourceName, currentName);
    const forms = new Set(
        [currentName, ...knownNames].map(value => String(value || '').trim()).filter(Boolean),
    );
    if (!collected.translations.length || !collected.candidates.length) return [...forms];
    const prompt = buildNameHistoryFormsPrompt({
        sourceName,
        currentName,
        candidates: collected.candidates,
    });
    const expected = [{ id: 'seg_0000', type: 'name_history', text: currentName }];
    const result = await requestSegments(prompt, expected, options);
    const detected = String(result.get('seg_0000') || '')
        .split(/\|\|\||[,，;；\n]/)
        .map(value => value.trim())
        .filter(value => value && value !== 'NO_MATCH');
    const allowed = new Set(collected.candidates);
    for (const value of detected) {
        if (allowed.has(value) && collected.translations.some(text => text.includes(value))) forms.add(value);
    }
    return [...forms];
}

function replaceStoredNameInExtra(extra, source, oldNames, targetName, swipeId = null) {
    if (!extra || typeof extra !== 'object') return false;
    const stored = storedTranslationView(extra, source);
    if (!stored) return false;
    const previousTranslation = stored.translation;
    let nextTranslation = previousTranslation;
    for (const oldName of oldNames) {
        if (oldName && oldName !== targetName) {
            nextTranslation = replaceOutsideProtected(nextTranslation, oldName, targetName);
        }
    }
    if (nextTranslation === previousTranslation) return false;
    const replacements = oldNames
        .filter(oldName => oldName && oldName !== targetName)
        .map(oldName => ({ search: oldName, value: targetName }));
    const nextSourceMap = sourceMapAfterGlobalReplacements(
        stored.record?.sourceMap,
        previousTranslation,
        nextTranslation,
        replacements,
    );
    const nextLockedSegments = normalizedLockedSegments(stored.record?.lockedSegments).map(lock => {
        let translation = lock.translation;
        for (const replacement of replacements) {
            translation = replaceOutsideProtected(translation, replacement.search, replacement.value);
        }
        return { ...lock, translation };
    });
    extra[STATE_KEY] = {
        ...(stored.record || {}),
        swipeId: stored.record?.swipeId ?? swipeId,
        sourceHash: hashText(source),
        translation: nextTranslation,
        sourceMap: nextSourceMap,
        lockedSegments: nextLockedSegments,
        updatedAt: new Date().toISOString(),
    };
    if (!stored.record || extra.display_text === previousTranslation) extra.display_text = nextTranslation;
    return true;
}

function replaceNameInKoreanRawSource(rawSource, oldNames, targetName) {
    const previous = typeof rawSource === 'string'
        ? rawSource
        : String(rawSource?.mes ?? rawSource?.text ?? rawSource?.content ?? rawSource?.message ?? '');
    if (!previous.trim() || !isPredominantlyKorean(previous)) return { changed: false, value: rawSource };
    let next = previous;
    for (const oldName of oldNames) {
        if (oldName && oldName !== targetName) next = replaceOutsideProtected(next, oldName, targetName);
    }
    if (next === previous) return { changed: false, value: rawSource };
    if (typeof rawSource === 'string') return { changed: true, value: next };
    const value = { ...rawSource };
    const key = ['mes', 'text', 'content', 'message'].find(name => Object.hasOwn(value, name));
    if (key) value[key] = next;
    else return { changed: false, value: rawSource };
    return { changed: true, value };
}

function replaceNameAcrossChatTranslations(oldNames, targetName) {
    const context = liveContext();
    const chat = context.chat;
    if (!Array.isArray(chat)) return { changedRecords: 0, changedMessages: 0 };
    const candidates = [...new Set(oldNames.map(value => String(value || '').trim()).filter(Boolean))];
    const changedMessageIds = new Set();
    let changedRecords = 0;

    chat.forEach((message, messageId) => {
        if (!isNameReplacementMessage(message)) return;
        let messageChanged = false;
        let currentSwipeWasCounted = false;
        let currentRawSwipeWasCounted = false;
        const originalActiveSource = messageSource(message);
        const activeStoredTranslation = storedTranslationView(message.extra, originalActiveSource)
            || storedTranslationView(currentSwipeExtra(message, false), originalActiveSource);
        if (Array.isArray(message.swipes)) {
            message.swipes.forEach((rawSource, swipeId) => {
                const source = typeof rawSource === 'string'
                    ? rawSource
                    : String(rawSource?.mes ?? rawSource?.text ?? rawSource?.content ?? rawSource?.message ?? '');
                const extra = message.swipe_info?.[swipeId]?.extra;
                if (!replaceStoredNameInExtra(extra, source, candidates, targetName, swipeId)) return;
                changedRecords += 1;
                messageChanged = true;
                if (swipeId === currentSwipeId(message)) currentSwipeWasCounted = true;
            });
        }

        if (Array.isArray(message.swipes)) {
            message.swipes.forEach((rawSource, swipeId) => {
                const source = typeof rawSource === 'string'
                    ? rawSource
                    : String(rawSource?.mes ?? rawSource?.text ?? rawSource?.content ?? rawSource?.message ?? '');
                const swipeStoredTranslation = storedTranslationView(message.swipe_info?.[swipeId]?.extra, source)
                    || (swipeId === currentSwipeId(message)
                        ? storedTranslationView(message.extra, source)
                        : null);
                if (swipeStoredTranslation) return;
                const replaced = replaceNameInKoreanRawSource(rawSource, candidates, targetName);
                if (!replaced.changed) return;
                message.swipes[swipeId] = replaced.value;
                changedRecords += 1;
                messageChanged = true;
                if (swipeId === currentSwipeId(message)) {
                    message.mes = typeof replaced.value === 'string'
                        ? replaced.value
                        : String(
                            replaced.value?.mes
                            ?? replaced.value?.text
                            ?? replaced.value?.content
                            ?? replaced.value?.message
                            ?? '',
                        );
                    currentRawSwipeWasCounted = true;
                }
            });
        }

        if (!activeStoredTranslation) {
            const activeRawChanged = replaceNameInKoreanRawSource(message.mes, candidates, targetName);
            if (activeRawChanged.changed) {
                message.mes = activeRawChanged.value;
                if (!currentRawSwipeWasCounted) changedRecords += 1;
                messageChanged = true;
            }
        }

        const activeSource = messageSource(message);
        const activeChanged = replaceStoredNameInExtra(
            message.extra,
            activeSource,
            candidates,
            targetName,
            currentSwipeId(message),
        );
        if (activeChanged) {
            if (!currentSwipeWasCounted) changedRecords += 1;
            messageChanged = true;
        }

        if (!messageChanged) return;
        changedMessageIds.add(messageId);
        lastRenderedTranslationByMessage.delete(messageId);
        if (document.querySelector(`.mes[mesid="${messageId}"]`)) updateMessageBlock(messageId, message);
    });

    if (changedMessageIds.size) {
        renderedTranslationCache.clear();
        scheduleChatSave(chat);
    }
    return { changedRecords, changedMessages: changedMessageIds.size };
}

function requestSelectionCandidateChoice(candidates, currentText) {
    if (document.querySelector('#verba-request-overlay')) return Promise.resolve(null);
    const choices = Array.isArray(candidates) ? candidates.filter(Boolean).slice(0, 3) : [];
    if (!choices.length) return Promise.resolve(null);
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal verba-candidate-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>선택 재번역 후보</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                <div class="verba-target-preview"><b>현재 번역</b><span>${escapeHtml(currentText)}</span></div>
                <small>사용할 후보를 누르면 선택한 부분만 교체됩니다.</small>
                <div class="verba-candidate-list"></div>
                <div class="verba-modal-actions">
                    <button type="button" class="menu_button verba-cancel">기존 번역 유지</button>
                </div>
            </section>`;
        const list = overlay.querySelector('.verba-candidate-list');
        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu_button verba-candidate-option';
            const number = document.createElement('b');
            number.textContent = `후보 ${index + 1}`;
            const text = document.createElement('span');
            text.textContent = choice;
            button.append(number, text);
            list.append(button);
        });
        document.documentElement.append(overlay);
        try {
            overlay.showPopover?.();
        } catch {
            // Fixed-position fallback.
        }
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            try {
                overlay.hidePopover?.();
            } catch {
                // It may already be closed.
            }
            overlay.remove();
            resolve(value);
        };
        overlay.querySelectorAll('.verba-candidate-option').forEach((button, index) => {
            button.addEventListener('click', () => finish(choices[index]));
        });
        overlay.querySelector('.verba-close').addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-cancel').addEventListener('click', () => finish(null));
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(null);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') finish(null);
        });
        requestAnimationFrame(() => overlay.querySelector('.verba-candidate-option')?.focus());
    });
}

function resolveExactSourceName(source, candidate) {
    const raw = String(candidate || '').trim();
    if (!raw || raw.length > 120 || /[\r\n]/.test(raw)) return '';
    const text = String(source || '');
    const exact = text.indexOf(raw);
    if (exact >= 0) return text.slice(exact, exact + raw.length);
    const foldedIndex = text.toLocaleLowerCase().indexOf(raw.toLocaleLowerCase());
    return foldedIndex >= 0 ? text.slice(foldedIndex, foldedIndex + raw.length) : '';
}

function previousAssistantMessages(beforeId = Number.POSITIVE_INFINITY) {
    const chat = liveContext().chat || [];
    const rows = [];
    for (let id = Math.min(chat.length - 1, Number.isFinite(beforeId) ? beforeId - 1 : chat.length - 1); id >= 0; id -= 1) {
        const message = chat[id];
        if (!message || !isNameReplacementMessage(message)) continue;
        const source = messageSource(message);
        if (!source.trim()) continue;
        rows.push({ id, message, source });
    }
    return rows;
}

function requestRetranslateTargetChoice(target, button = document.querySelector('#verba-retranslate-latest')) {
    document.querySelector('#verba-retranslate-target-menu')?.remove();
    if (!button || !target?.message) return Promise.resolve(null);

    const record = currentRecord(target.message);
    const swipeExtra = currentSwipeExtra(target.message, false);
    const showingTranslation = Boolean(
        record
        && !sourceViewRequested(target.message, record)
        && (
            target.message.extra?.display_text === record.translation
            || swipeExtra?.display_text === record.translation
        )
    );
    const viewLabel = showingTranslation ? '원문' : '번역본';

    return new Promise(resolve => {
        const menu = document.createElement('div');
        menu.id = 'verba-retranslate-target-menu';
        menu.className = 'verba-retranslate-target-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" class="menu_button" data-target="recent">최근</button>
            <button type="button" class="menu_button" data-target="previous">이전</button>
            <button type="button" class="menu_button" data-target="toggle-view">${viewLabel}</button>`;
        (document.body || document.documentElement).append(menu);

        const buttonRect = button.getBoundingClientRect();
        const viewport = globalThis.visualViewport;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width || innerWidth;
        const menuRect = menu.getBoundingClientRect();
        const width = menuRect.width || 156;
        const height = menuRect.height || 38;
        const centered = buttonRect.left + buttonRect.width / 2 - width / 2;
        const left = Math.min(
            Math.max(viewportLeft + 8, centered),
            viewportLeft + viewportWidth - width - 8,
        );
        const above = buttonRect.top - height - 7;
        const top = above >= viewportTop + 8 ? above : buttonRect.bottom + 7;
        menu.style.setProperty('left', `${left}px`, 'important');
        menu.style.setProperty('top', `${top}px`, 'important');

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            menu.remove();
            resolve(value);
        };
        const onOutside = event => {
            if (!menu.contains(event.target) && event.target !== button) finish(null);
        };
        const onKey = event => {
            if (event.key === 'Escape') finish(null);
        };

        menu.querySelectorAll('[data-target]').forEach(option => {
            option.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                finish(option.dataset.target || null);
            });
        });
        requestAnimationFrame(() => {
            document.addEventListener('pointerdown', onOutside, true);
            document.addEventListener('keydown', onKey, true);
            menu.querySelector('[data-target="recent"]')?.focus?.();
        });
    });
}

const PREVIOUS_OUTPUT_PAGE_SIZE = 20;

function visiblePreviousOutputPreview(target) {
    const id = Number(target?.id);
    const message = target?.message;
    if (!message || !Number.isInteger(id)) return '';

    const liveText = document.querySelector(
        `.mes[mesid="${id}"] .mes_text:not(.verba-swipe-hold-content)`,
    )?.innerText?.trim();
    if (liveText) return liveText.replace(/\s+/g, ' ');

    const displayText = message?.extra?.display_text ?? messageSource(message);
    try {
        // Hidden/ghosted character outputs may be marked is_system by
        // SillyTavern. For preview purposes they are still character outputs,
        // so render them as assistant text while preserving the same regex and
        // Markdown pipeline the chat uses.
        const html = messageFormatting(
            String(displayText || ''),
            String(message.name || ''),
            false,
            false,
            id,
            {},
            false,
        );
        const holder = document.createElement('div');
        holder.innerHTML = String(html || '');
        const rendered = String(holder.innerText || holder.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (rendered) return rendered;
    } catch (error) {
        console.warn('[베르바] 이전 아웃풋 미리보기 렌더링 실패', error);
    }

    return String(displayText || '')
        .replace(/<(?:think|thinking|thought|analysis|reasoning|scratchpad|start|starter)\b[^>]*>[\s\S]*?<\/(?:think|thinking|thought|analysis|reasoning|scratchpad|start|starter)\s*>/giu, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function previousOutputOptionMarkup(target, index, previewText = '') {
    const preview = String(previewText || visiblePreviousOutputPreview(target)).slice(0, 180) || '(표시할 내용 없음)';
    return `<button type="button" class="menu_button verba-previous-output-option" data-target-index="${index}">
        <span class="verba-previous-output-meta"><b>#${target.id}</b></span>
        <span>${escapeHtml(preview)}</span>
    </button>`;
}


function centerPreviousOutputModal(overlay) {
    const modal = overlay?.querySelector?.('.verba-previous-output-modal');
    if (!modal) return;

    const viewport = globalThis.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;

    const horizontalCenter = viewportLeft + (viewportWidth / 2);
    const verticalCenter = viewportTop + (viewportHeight / 2);
    const safeHeight = Math.max(220, viewportHeight - 24);
    const maxHeight = Math.min(680, safeHeight);

    // Force the picker itself to the visual viewport center. This avoids
    // SillyTavern/mobile theme rules that override flex centering on popovers.
    modal.style.setProperty('position', 'fixed', 'important');
    modal.style.setProperty('left', `${horizontalCenter}px`, 'important');
    modal.style.setProperty('top', `${verticalCenter}px`, 'important');
    modal.style.setProperty('right', 'auto', 'important');
    modal.style.setProperty('bottom', 'auto', 'important');
    modal.style.setProperty('margin', '0', 'important');
    modal.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
    modal.style.setProperty('width', `min(620px, ${Math.max(240, viewportWidth - 18)}px)`, 'important');
    modal.style.setProperty('max-height', `${maxHeight}px`, 'important');
    modal.style.setProperty('overflow', 'hidden', 'important');

    const list = modal.querySelector('.verba-previous-output-list');
    if (list) {
        // Reserve room for header + "더 보기" while making only the list scroll.
        const reserved = 112;
        list.style.setProperty('max-height', `${Math.max(120, maxHeight - reserved)}px`, 'important');
        list.style.setProperty('overflow-y', 'auto', 'important');
        list.style.setProperty('-webkit-overflow-scrolling', 'touch');
    }
}

function requestPreviousOutputTarget(beforeId) {
    if (document.querySelector('#verba-request-overlay')) return Promise.resolve(null);

    // Includes normal and SillyTavern-hidden/ghosted assistant outputs, while
    // still excluding user inputs and genuine system notices.
    const targets = previousAssistantMessages(beforeId);
    if (!targets.length) {
        notify('선택할 이전 아웃풋이 없어요.', 'info');
        return Promise.resolve(null);
    }

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay verba-previous-output-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal verba-previous-output-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>이전 아웃풋 선택</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                <input type="search" class="text_pole verba-previous-output-search"
                    placeholder="내용 또는 #번호 검색" autocomplete="off" enterkeyhint="search">
                <fieldset class="verba-previous-output-action">
                    <legend>번역 완료 후</legend>
                    <label>
                        <input type="radio" name="verba-previous-output-action" value="jump"
                            ${settings.previousOutputCompletionAction === 'jump' ? 'checked' : ''}>
                        <span>해당 메시지로 이동</span>
                    </label>
                    <label>
                        <input type="radio" name="verba-previous-output-action" value="stay"
                            ${settings.previousOutputCompletionAction === 'stay' ? 'checked' : ''}>
                        <span>현재 위치 유지</span>
                    </label>
                </fieldset>
                <div class="verba-previous-output-list"></div>
                <button type="button" class="menu_button verba-previous-output-more">더 보기</button>
            </section>`;

        const searchInput = overlay.querySelector('.verba-previous-output-search');
        const list = overlay.querySelector('.verba-previous-output-list');
        const moreButton = overlay.querySelector('.verba-previous-output-more');
        const previewCache = new Map();
        let filteredTargets = targets;
        let renderedCount = 0;
        let settled = false;
        let recenter = null;
        let searchTimer = null;

        const previewFor = target => {
            const key = Number(target.id);
            if (!previewCache.has(key)) previewCache.set(key, visiblePreviousOutputPreview(target));
            return previewCache.get(key) || '';
        };

        const cleanup = () => {
            clearTimeout(searchTimer);
            if (!recenter) return;
            globalThis.visualViewport?.removeEventListener?.('resize', recenter);
            globalThis.visualViewport?.removeEventListener?.('scroll', recenter);
            window.removeEventListener('resize', recenter);
        };

        const finish = value => {
            if (settled) return;
            settled = true;
            cleanup();
            try {
                overlay.hidePopover?.();
            } catch {
                // It may already be closed.
            }
            overlay.remove();
            resolve(value);
        };

        const renderEmpty = message => {
            list.innerHTML = `<div class="verba-previous-output-empty">${escapeHtml(message)}</div>`;
            moreButton.hidden = true;
        };

        const renderMore = () => {
            if (!filteredTargets.length) {
                renderEmpty('검색 결과가 없어요.');
                return;
            }

            const nextEnd = Math.min(
                filteredTargets.length,
                renderedCount + PREVIOUS_OUTPUT_PAGE_SIZE,
            );
            const fragment = document.createDocumentFragment();

            for (let index = renderedCount; index < nextEnd; index += 1) {
                const target = filteredTargets[index];
                const wrapper = document.createElement('div');
                wrapper.innerHTML = previousOutputOptionMarkup(target, index, previewFor(target));
                const button = wrapper.firstElementChild;
                if (!button) continue;
                button.addEventListener('click', () => {
                    const completionAction = overlay.querySelector(
                        'input[name="verba-previous-output-action"]:checked',
                    )?.value === 'stay'
                        ? 'stay'
                        : 'jump';

                    settings.previousOutputCompletionAction = completionAction;
                    saveSettings();

                    finish(target
                        ? { target, completionAction }
                        : null);
                });
                fragment.append(button);
            }

            if (renderedCount === 0) list.replaceChildren(fragment);
            else list.append(fragment);

            renderedCount = nextEnd;
            moreButton.hidden = renderedCount >= filteredTargets.length;
            if (!moreButton.hidden) {
                moreButton.textContent = `더 보기 · ${renderedCount}/${filteredTargets.length}`;
            }
        };

        const applySearch = () => {
            const query = String(searchInput.value || '').trim().toLocaleLowerCase();
            renderedCount = 0;

            if (!query) {
                filteredTargets = targets;
            } else {
                const numeric = query.replace(/^#/, '');
                filteredTargets = targets.filter(target => {
                    if (
                        numeric
                        && /^\d+$/.test(numeric)
                        && String(target.id).includes(numeric)
                    ) return true;
                    return previewFor(target).toLocaleLowerCase().includes(query);
                });
            }

            list.replaceChildren();
            renderMore();
            list.scrollTop = 0;
            requestAnimationFrame(() => centerPreviousOutputModal(overlay));
        };

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(applySearch, 120);
        });

        overlay.querySelectorAll('input[name="verba-previous-output-action"]').forEach(input => {
            input.addEventListener('change', () => {
                settings.previousOutputCompletionAction = input.value === 'stay' ? 'stay' : 'jump';
                saveSettings();
            });
        });

        moreButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            renderMore();
            requestAnimationFrame(() => centerPreviousOutputModal(overlay));
        });

        overlay.querySelector('.verba-close').addEventListener('click', () => finish(null));
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(null);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') finish(null);
        });

        renderMore();
        document.documentElement.append(overlay);

        try {
            overlay.showPopover?.();
        } catch {
            // Fixed-position fallback.
        }

        recenter = () => centerPreviousOutputModal(overlay);
        requestAnimationFrame(recenter);
        setTimeout(recenter, 60);
        globalThis.visualViewport?.addEventListener?.('resize', recenter);
        globalThis.visualViewport?.addEventListener?.('scroll', recenter);
        window.addEventListener('resize', recenter);
    });
}

async function translateUntranslatedOutput(target) {
    if (!target) return;
    if (pendingOutputs.has(target.id)) {
        notify('선택한 아웃풋을 아직 번역 중이에요.', 'info');
        return;
    }
    const source = messageSource(target.message);
    const failed = failedOutputSignatures.get(target.id) === messageVersionSignature(target.message);
    if (isPredominantlyKorean(source) && !failed) {
        notify('선택한 아웃풋이 이미 한국어라 번역할 필요가 없어요.', 'info');
        return;
    }
    return await translateMessage(target.id, { force: failed });
}

async function retranslateOutputTarget(target, title = '아웃풋 전체 재번역') {
    if (!target) return;
    if (pendingOutputs.has(target.id)) {
        notify('선택한 아웃풋을 아직 번역 중이에요.', 'info');
        return;
    }
    const source = messageSource(target.message);
    const failedSignature = failedOutputSignatures.get(target.id);
    const isFailedOutput = failedSignature === messageVersionSignature(target.message);
    const record = currentRecord(target.message);
    if (!record) {
        return await translateUntranslatedOutput(target);
    }

    const snapshot = {
        chat: liveContext().chat,
        message: target.message,
        sourceHash: hashText(source),
        swipeId: currentSwipeId(target.message),
    };
    const preview = source.replace(/\s+/g, ' ').trim().slice(0, 110);
    const request = await requestOneTimeInstruction('message', preview, title);
    if (request === null) return;
    const latest = liveContext().chat?.[target.id];
    if (
        liveContext().chat !== snapshot.chat
        || latest !== snapshot.message
        || currentSwipeId(latest) !== snapshot.swipeId
        || hashText(messageSource(latest)) !== snapshot.sourceHash
    ) {
        notify('요구사항을 적는 동안 선택한 아웃풋이 바뀌었어요. 다시 눌러 주세요.', 'warning');
        return;
    }
    const oneTimeInstruction = typeof request === 'object' ? request.instruction : String(request || '');
    const sourceHasDialogue = selectionTouchesDialogue(source, 0, source.length);
    warnTranslationPromptConflicts({
        oneTimeInstruction,
        includeDialogue: sourceHasDialogue,
        includeCharacterDialogue: sourceHasDialogue,
    });
    return await translateMessage(target.id, {
        force: true,
        oneTimeInstruction,
        tuning: typeof request === 'object' ? request.tuning : null,
    });
}


function captureChatViewportPosition() {
    const chatScroller = document.querySelector('#chat');
    const viewportHeight = globalThis.visualViewport?.height || innerHeight;
    const centerY = viewportHeight / 2;

    const candidates = [...document.querySelectorAll('#chat .mes[mesid], .mes[mesid]')]
        .map(element => {
            const id = Number(element.getAttribute('mesid'));
            const rect = element.getBoundingClientRect();
            return { id, rect };
        })
        .filter(item =>
            Number.isInteger(item.id)
            && item.rect.height > 0
            && item.rect.bottom >= 0
            && item.rect.top <= viewportHeight
        );

    candidates.sort((left, right) => {
        const leftCenter = left.rect.top + (left.rect.height / 2);
        const rightCenter = right.rect.top + (right.rect.height / 2);
        return Math.abs(leftCenter - centerY) - Math.abs(rightCenter - centerY);
    });

    // Keep both an anchor message and the raw chat scroll position. On some
    // mobile layouts no .mes rect is considered visible while the picker is
    // closing, so scrollTop gives us a reliable fallback and avoids returning
    // null (which previously prevented the return button from being created).
    return {
        messageId: candidates[0]?.id ?? null,
        scrollTop: chatScroller ? Number(chatScroller.scrollTop) || 0 : null,
        block: 'center',
    };
}

function positionPreviousOutputReturnButton(host) {
    if (!host) return;

    const viewport = globalThis.visualViewport;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;

    const textarea = document.querySelector('#send_textarea');
    const sendButton = document.querySelector('#send_but');

    let anchorRect = null;
    if (textarea) {
        const rect = textarea.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) anchorRect = rect;
    }
    if (!anchorRect && sendButton) {
        const rect = sendButton.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) anchorRect = rect;
    }

    const hostRect = host.getBoundingClientRect();
    const width = hostRect.width || Math.min(200, viewportWidth - 16);
    const height = hostRect.height || 34;
    const gap = 8;

    // Keep the control literally above the composer instead of overlapping it.
    let centerX = viewportLeft + (viewportWidth / 2);
    let top = viewportTop + viewportHeight - height - 96;
    if (anchorRect) {
        centerX = anchorRect.left + (anchorRect.width / 2);
        top = anchorRect.top - height - gap;
    }

    const minLeft = viewportLeft + 8;
    const maxLeft = viewportLeft + viewportWidth - width - 8;
    const left = Math.min(
        Math.max(minLeft, centerX - (width / 2)),
        Math.max(minLeft, maxLeft),
    );

    const minTop = viewportTop + 8;
    const maxTop = viewportTop + viewportHeight - height - 8;
    top = Math.min(Math.max(minTop, top), Math.max(minTop, maxTop));

    host.style.setProperty('left', `${left}px`, 'important');
    host.style.setProperty('top', `${top}px`, 'important');
    host.style.setProperty('right', 'auto', 'important');
    host.style.setProperty('bottom', 'auto', 'important');
    host.style.setProperty('transform', 'none', 'important');
}
function dismissPreviousOutputReturnButton() {
    const host = document.querySelector('#verba-return-position');
    if (!host) return;

    host.__verbaCleanup?.();
    delete host.__verbaCleanup;

    try {
        host.hidePopover?.();
    } catch {
        // It may not be in the top layer.
    }
    host.remove();
}

async function restorePreviousOutputReturnPosition(position) {
    if (!position) return false;

    const id = Number(position.messageId);
    let element = Number.isInteger(id)
        ? document.querySelector(`.mes[mesid="${id}"]`)
        : null;

    for (let attempt = 0; Number.isInteger(id) && !element && attempt < 8; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 80));
        element = document.querySelector(`.mes[mesid="${id}"]`);
    }

    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: position.block || 'center',
            inline: 'nearest',
        });
        return true;
    }

    const chatScroller = document.querySelector('#chat');
    if (chatScroller && Number.isFinite(Number(position.scrollTop))) {
        chatScroller.scrollTo({
            top: Math.max(0, Number(position.scrollTop)),
            behavior: 'smooth',
        });
        return true;
    }

    notify('원래 보던 위치를 다시 찾지 못했어요.', 'warning');
    return false;
}

function showPreviousOutputReturnButton(position) {
    dismissPreviousOutputReturnButton();
    if (!position) return;

    const host = document.createElement('div');
    host.id = 'verba-return-position';
    host.className = 'verba-return-position';
    if ('showPopover' in HTMLElement.prototype) host.setAttribute('popover', 'manual');

    host.innerHTML = `
        <button type="button" class="verba-return-position-main">원래 위치</button>
        <button type="button" class="verba-return-position-close" aria-label="닫기">✕</button>`;

    (document.body || document.documentElement).append(host);

    // Put it in the browser's top layer where possible. This avoids it being
    // hidden behind SillyTavern mobile docks, transformed containers, or theme
    // stacking contexts.
    try {
        host.showPopover?.();
    } catch {
        // Fixed-position fallback below is enough on browsers without popover.
    }

    const recalc = () => positionPreviousOutputReturnButton(host);
    requestAnimationFrame(() => {
        recalc();
        requestAnimationFrame(recalc);
    });
    setTimeout(recalc, 80);
    setTimeout(recalc, 260);

    globalThis.visualViewport?.addEventListener?.('resize', recalc);
    globalThis.visualViewport?.addEventListener?.('scroll', recalc);
    window.addEventListener('resize', recalc);

    const textarea = document.querySelector('#send_textarea');
    const resizeObserver = typeof ResizeObserver !== 'undefined' && textarea
        ? new ResizeObserver(recalc)
        : null;
    resizeObserver?.observe(textarea);

    host.__verbaCleanup = () => {
        globalThis.visualViewport?.removeEventListener?.('resize', recalc);
        globalThis.visualViewport?.removeEventListener?.('scroll', recalc);
        window.removeEventListener('resize', recalc);
        resizeObserver?.disconnect();
    };

    host.querySelector('.verba-return-position-main')?.addEventListener('click', async () => {
        const button = host.querySelector('.verba-return-position-main');
        if (button) button.disabled = true;
        const restored = await restorePreviousOutputReturnPosition(position);
        if (restored) dismissPreviousOutputReturnButton();
        else if (button) button.disabled = false;
    });

    host.querySelector('.verba-return-position-close')?.addEventListener('click', dismissPreviousOutputReturnButton);
}


async function jumpToOutputMessage(messageId) {
    const id = Number(messageId);
    if (!Number.isInteger(id)) return false;

    const findElement = () => document.querySelector(`.mes[mesid="${id}"]`);
    let element = findElement();

    for (let pass = 0; !element && pass < 80; pass += 1) {
        const firstDisplayed = Number(
            document.querySelector('#chat .mes[mesid], .mes[mesid]')?.getAttribute('mesid'),
        );

        const amount = Number.isFinite(firstDisplayed)
            ? Math.min(100, Math.max(20, Math.abs(firstDisplayed - id) + 1))
            : 100;

        try {
            await showMoreMessages(amount);
        } catch (error) {
            console.warn('[베르바] 이전 메시지 자동 불러오기 실패', error);
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 60));
        element = findElement();

        // If history already reaches past the target and the exact element still
        // does not exist, it may be a SillyTavern-hidden message.
        if (!element && Number.isFinite(firstDisplayed) && firstDisplayed <= id) break;
    }

    for (let attempt = 0; !element && attempt < 10; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 80));
        element = findElement();
    }

    if (!element) {
        notify('번역은 저장됐지만 해당 메시지가 현재 채팅 화면에 표시되지 않아 자동 이동하지 못했어요.', 'warning');
        return false;
    }

    // The translation may have completed while the old message was off-screen.
    // Force one rerender only after the message has actually been mounted.
    const message = liveContext().chat?.[id];
    if (message) updateMessageBlock(id, message);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    element = findElement() || element;
    const chatScroller = document.querySelector('#chat');
    let scrolled = false;

    if (chatScroller && chatScroller.scrollHeight > chatScroller.clientHeight) {
        try {
            const chatRect = chatScroller.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const delta = (elementRect.top + elementRect.height / 2)
                - (chatRect.top + chatRect.height / 2);
            const targetTop = Math.max(0, chatScroller.scrollTop + delta);
            chatScroller.scrollTo({ top: targetTop, behavior: 'smooth' });
            scrolled = true;
        } catch (error) {
            console.warn('[베르바] 채팅 컨테이너 직접 이동 실패 — 기본 이동으로 전환합니다.', error);
        }
    }

    if (!scrolled) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest',
        });
    }

    element.classList.add('verba-jump-highlight');
    setTimeout(() => element.classList.remove('verba-jump-highlight'), 1800);
    return true;
}

async function retranslateLatestOutput() {
    const target = latestAssistantMessage();
    if (!target) {
        notify('번역할 AI 아웃풋이 없어요.', 'warning');
        return;
    }
    if (pendingOutputs.has(target.id)) {
        notify('최근 아웃풋을 아직 번역 중이에요.', 'info');
        return;
    }

    // The fast path stays one tap: if the latest output has never been
    // translated (including a failed attempt), immediately translate/retry it.
    if (!currentRecord(target.message)) {
        await translateUntranslatedOutput(target);
        return;
    }

    const choice = await requestRetranslateTargetChoice(target);
    if (choice === 'toggle-view') {
        const record = currentRecord(target.message);
        if (!record) {
            notify('전환할 저장 번역본을 찾지 못했어요.', 'warning');
            return;
        }
        const swipeExtra = currentSwipeExtra(target.message, false);
        const showingTranslation = Boolean(
            !sourceViewRequested(target.message, record)
            && (
                target.message.extra?.display_text === record.translation
                || swipeExtra?.display_text === record.translation
            )
        );
        if (showingTranslation) showOriginalDisplay(target.id, target.message, record);
        else showTranslationDisplay(target.id, target.message, record);
        refreshRetranslateButton();
        return;
    }
    if (choice === 'recent') {
        await retranslateOutputTarget(target, '최근 아웃풋 전체 재번역');
        return;
    }
    if (choice !== 'previous') return;

    const previousChoice = await requestPreviousOutputTarget(target.id);
    if (!previousChoice?.target) return;

    const previous = previousChoice.target;
    const completionAction = previousChoice.completionAction === 'stay' ? 'stay' : 'jump';

    const returnPosition = completionAction === 'jump'
        ? captureChatViewportPosition()
        : null;

    const success = !currentRecord(previous.message)
        ? await translateUntranslatedOutput(previous)
        : await retranslateOutputTarget(previous, '이전 아웃풋 전체 재번역');

    // translateMessage/retranslateOutputTarget already reports the final error
    // through reportError after all automatic retries are exhausted.
    if (!success) return;

    if (completionAction === 'jump') {
        const jumped = await jumpToOutputMessage(previous.id);
        if (jumped) showPreviousOutputReturnButton(returnPosition);
    }
}

function setTextareaValue(textarea, value) {
    textarea.dataset.verbaInternalUpdate = 'true';
    textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    delete textarea.dataset.verbaInternalUpdate;
}

async function translateInputAndSend(textarea, sendButton, source) {
    if (inputBusy) return;
    inputBusy = true;
    const controller = new AbortController();
    pendingInputControllers.add(controller);
    const toast = showInputProgress(controller);
    try {
        const translated = await translateInputText(source, { signal: controller.signal });
        if (document.querySelector('#send_textarea') !== textarea || textarea.value !== source) {
            notify('번역 중 입력 내용이 바뀌어 전송하지 않았어요.', 'warning');
            return;
        }
        setTextareaValue(textarea, translated);
        bypassSendClick = true;
        sendButton.click();
    } catch (error) {
        if (!isAbort(error)) {
            console.error('[베르바] 인풋 번역 실패', error);
            reportError('input-translate-and-send', error, `인풋 번역 실패로 전송하지 않았어요: ${errorText(error)}`);
        }
    } finally {
        clearProgress(toast);
        pendingInputControllers.delete(controller);
        inputBusy = false;
    }
}

function blockGenerationAndRestore(textarea, source) {
    const marker = '/abort quiet=true verba-input-translation-failed';
    setTextareaValue(textarea, marker);
    const restore = () => {
        const current = document.querySelector('#send_textarea');
        if (!current || (current.value && current.value !== marker)) return;
        setTextareaValue(current, source);
    };
    setTimeout(restore, 250);
    setTimeout(restore, 1000);
}

async function translateInputBeforeGeneration(type, _options, dryRun) {
    if (!settings.autoInput || dryRun || (type && type !== 'normal')) return;
    const textarea = document.querySelector('#send_textarea');
    const source = String(textarea?.value || '');
    if (!textarea || !source.trim() || source.trimStart().startsWith('/') || !hasKorean(source)) return;
    if (inputBusy) {
        blockGenerationAndRestore(textarea, source);
        return;
    }
    inputBusy = true;
    const controller = new AbortController();
    pendingInputControllers.add(controller);
    const toast = showInputProgress(controller);
    try {
        const translated = await translateInputText(source, { signal: controller.signal });
        if (textarea.value !== source) {
            blockGenerationAndRestore(textarea, source);
            return;
        }
        setTextareaValue(textarea, translated);
    } catch (error) {
        if (!isAbort(error)) {
            console.error('[베르바] 생성 전 인풋 번역 실패', error);
            reportError('input-before-generation', error, `인풋 번역 실패로 생성을 중단했어요: ${errorText(error)}`);
        }
        blockGenerationAndRestore(textarea, source);
    } finally {
        clearProgress(toast);
        pendingInputControllers.delete(controller);
        inputBusy = false;
    }
}

async function translateSentInputMessage(payload) {
    if (!settings.autoInput) return;
    const id = normalizedMessageId(payload);
    const context = liveContext();
    const message = context.chat?.[id];
    if (!message?.is_user || pendingSentInputs.has(message)) return;
    const source = String(message.mes || '');
    if (!source.trim() || !hasKorean(source)) return;

    const controller = new AbortController();
    pendingInputControllers.add(controller);
    const toast = showInputProgress(controller);
    const work = (async () => {
        try {
            const translated = await translateInputText(source, { signal: controller.signal });
            if (liveContext().chat !== context.chat || context.chat?.[id] !== message || message.mes !== source) return;
            message.mes = translated;
            updateMessageBlock(id, message);
            scheduleChatSave(context.chat);
        } catch (error) {
            if (!isAbort(error)) {
                console.error('[베르바] 전송된 인풋 번역 실패', error);
                reportError('sent-input-translation', error, `인풋 번역 실패로 뒤따르는 생성을 중단했어요: ${errorText(error)}`);
            }
            try {
                await liveContext().executeSlashCommandsWithOptions?.('/abort quiet=true verba-input-translation-failed');
            } catch {
                // 중단 명령을 지원하지 않는 환경에서는 원문만 입력창에 복원한다.
            }
            const textarea = document.querySelector('#send_textarea');
            if (textarea && !textarea.value) setTextareaValue(textarea, source);
        }
    })();
    pendingSentInputs.set(message, work);
    try {
        await work;
    } finally {
        clearProgress(toast);
        pendingInputControllers.delete(controller);
        pendingSentInputs.delete(message);
    }
}

function setupAutoInput() {
    document.addEventListener('click', event => {
        const sendButton = event.target?.closest?.('#send_but');
        if (!sendButton) return;
        if (bypassSendClick) {
            bypassSendClick = false;
            return;
        }
        if (!settings.autoInput) return;
        const textarea = document.querySelector('#send_textarea');
        const source = String(textarea?.value || '');
        if (!textarea || !source.trim() || source.trimStart().startsWith('/') || !hasKorean(source)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        translateInputAndSend(textarea, sendButton, source);
    }, true);
}

function textOffsetWithin(root, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
        range.setEnd(container, offset);
        return range.toString().length;
    } catch {
        return -1;
    }
}

function occurrenceIndexes(value, needle) {
    const indexes = [];
    let cursor = 0;
    while (needle && cursor <= value.length - needle.length) {
        const found = value.indexOf(needle, cursor);
        if (found < 0) break;
        indexes.push(found);
        cursor = found + Math.max(1, needle.length);
    }
    return indexes;
}

function comparableTextWithMap(value) {
    const raw = String(value || '');
    let text = '';
    const starts = [];
    const ends = [];
    let index = 0;
    let pendingSpace = null;

    const flushSpace = () => {
        if (!pendingSpace || !text || text.endsWith(' ')) {
            pendingSpace = null;
            return;
        }
        text += ' ';
        starts.push(pendingSpace.start);
        ends.push(pendingSpace.end);
        pendingSpace = null;
    };

    while (index < raw.length) {
        const rest = raw.slice(index);
        const htmlTag = rest.match(/^<\/?[A-Za-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/);
        if (htmlTag) {
            if (/^<\/?(?:br|p|div|li|blockquote|h[1-6])\b/i.test(htmlTag[0])) {
                pendingSpace = pendingSpace || { start: index, end: index + htmlTag[0].length };
                pendingSpace.end = index + htmlTag[0].length;
            }
            index += htmlTag[0].length;
            continue;
        }

        const markdown = rest.match(/^(?:\*\*|__|~~|`{1,3})/);
        if (markdown) {
            index += markdown[0].length;
            continue;
        }

        const character = raw[index];
        if (/\s/u.test(character)) {
            pendingSpace = pendingSpace || { start: index, end: index + 1 };
            pendingSpace.end = index + 1;
            index += 1;
            continue;
        }

        flushSpace();
        text += character;
        starts.push(index);
        ends.push(index + 1);
        index += 1;
    }

    return { text: text.trim(), starts, ends };
}

function looseComparableTextWithMap(value) {
    const comparable = comparableTextWithMap(value);
    let text = '';
    const starts = [];
    const ends = [];
    for (let index = 0; index < comparable.text.length; index += 1) {
        const normalized = comparable.text[index].normalize('NFKC').toLocaleLowerCase();
        for (const character of normalized) {
            if (!/[\p{L}\p{N}]/u.test(character)) continue;
            text += character;
            starts.push(comparable.starts[index]);
            ends.push(comparable.ends[index]);
        }
    }
    return { text, starts, ends };
}

function mappedOccurrenceRange(storedComparable, selectedComparable, beforeComparable) {
    if (!selectedComparable.text) return null;
    const candidateIndexes = occurrenceIndexes(storedComparable.text, selectedComparable.text);
    if (!candidateIndexes.length) return null;
    const ordinal = occurrenceIndexes(beforeComparable.text, selectedComparable.text).length;
    const comparableStart = candidateIndexes[ordinal]
        ?? (candidateIndexes.length === 1 ? candidateIndexes[0] : candidateIndexes.at(-1));
    const comparableEnd = comparableStart + selectedComparable.text.length - 1;
    const start = storedComparable.starts[comparableStart];
    const end = storedComparable.ends[comparableEnd];
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end };
}

function resolveStoredSelection(storedValue, visibleSelected, visibleBefore) {
    const stored = String(storedValue || '');
    const exactIndexes = occurrenceIndexes(stored, visibleSelected);
    if (exactIndexes.length) {
        // Short Korean selections often repeat inside one message. Resolve the
        // exact occurrence by counting the same text before the visible range
        // instead of rejecting anything except a unique match.
        const ordinal = occurrenceIndexes(String(visibleBefore || ''), visibleSelected).length;
        const exactStart = exactIndexes[ordinal]
            ?? (exactIndexes.length === 1 ? exactIndexes[0] : exactIndexes.at(-1));
        if (Number.isInteger(exactStart)) {
            return {
                start: exactStart,
                end: exactStart + visibleSelected.length,
            };
        }
    }

    const storedComparable = comparableTextWithMap(stored);
    const selectedComparable = comparableTextWithMap(visibleSelected);
    const beforeComparable = comparableTextWithMap(visibleBefore);
    const comparableRange = mappedOccurrenceRange(storedComparable, selectedComparable, beforeComparable);
    if (comparableRange) return comparableRange;

    // Rendered bilingual dialogue can differ only in quotes, parentheses,
    // Markdown escapes, or other punctuation. Match its letters and numbers as
    // a final fallback while preserving offsets into the stored translation.
    const storedLoose = looseComparableTextWithMap(stored);
    const selectedLoose = looseComparableTextWithMap(visibleSelected);
    const beforeLoose = looseComparableTextWithMap(visibleBefore);
    // Even a single Hangul syllable can be a deliberate selection. The exact
    // and occurrence-aware mapping above already guards against random matches.
    if (!selectedLoose.text.length) return null;
    return mappedOccurrenceRange(storedLoose, selectedLoose, beforeLoose);
}

function visibleRangeForStoredOffsets(storedValue, start, end, visibleValue) {
    const stored = String(storedValue || '');
    const visible = String(visibleValue || '');
    const selected = stored.slice(start, end);
    if (!selected || !visible) return null;

    const exactCandidates = occurrenceIndexes(visible, selected);
    if (exactCandidates.length) {
        const ordinal = occurrenceIndexes(stored.slice(0, start), selected).length;
        const visibleStart = exactCandidates[ordinal]
            ?? (exactCandidates.length === 1 ? exactCandidates[0] : exactCandidates.at(-1));
        return { start: visibleStart, end: visibleStart + selected.length };
    }

    const mapComparableRange = mapper => {
        const visibleComparable = mapper(visible);
        const selectedComparable = mapper(selected);
        const beforeComparable = mapper(stored.slice(0, start));
        if (!selectedComparable.text) return null;
        const candidates = occurrenceIndexes(visibleComparable.text, selectedComparable.text);
        if (!candidates.length) return null;
        const ordinal = occurrenceIndexes(beforeComparable.text, selectedComparable.text).length;
        const comparableStart = candidates[ordinal]
            ?? (candidates.length === 1 ? candidates[0] : candidates.at(-1));
        const comparableEnd = comparableStart + selectedComparable.text.length - 1;
        const visibleStart = visibleComparable.starts[comparableStart];
        const visibleEnd = visibleComparable.ends[comparableEnd];
        if (!Number.isInteger(visibleStart) || !Number.isInteger(visibleEnd) || visibleEnd <= visibleStart) {
            return null;
        }
        return { start: visibleStart, end: visibleEnd };
    };

    return mapComparableRange(comparableTextWithMap)
        || mapComparableRange(looseComparableTextWithMap);
}

function textPositionAtOffset(root, requestedOffset) {
    const targetOffset = Math.max(0, Number(requestedOffset) || 0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let lastNode = null;
    let node;
    while ((node = walker.nextNode())) {
        lastNode = node;
        const length = node.nodeValue?.length || 0;
        if (targetOffset <= consumed + length) {
            return { node, offset: Math.max(0, Math.min(length, targetOffset - consumed)) };
        }
        consumed += length;
    }
    return lastNode ? { node: lastNode, offset: lastNode.nodeValue?.length || 0 } : null;
}

function highlightRangeForStoredOffsets(messageId, translation, start, end) {
    const textElement = document.querySelector(
        `.mes[mesid="${Number(messageId)}"] .mes_text:not(.verba-swipe-hold-content)`,
    );
    if (!textElement) return null;
    const visibleRange = visibleRangeForStoredOffsets(
        translation,
        start,
        end,
        textElement.textContent || '',
    );
    if (!visibleRange) return null;
    const startPosition = textPositionAtOffset(textElement, visibleRange.start);
    const endPosition = textPositionAtOffset(textElement, visibleRange.end);
    if (!startPosition || !endPosition) return null;
    try {
        const range = document.createRange();
        range.setStart(startPosition.node, startPosition.offset);
        range.setEnd(endPosition.node, endPosition.offset);
        return range.collapsed ? null : range;
    } catch {
        return null;
    }
}

function refreshSelectionHighlights() {
    clearTimeout(selectionHighlightTimer);
    selectionHighlightTimer = null;
    const highlights = globalThis.CSS?.highlights;
    const HighlightConstructor = globalThis.Highlight;
    if (!highlights || typeof HighlightConstructor !== 'function') return;

    highlights.delete('verba-locked-segments');
    highlights.delete('verba-bundle-selections');
    const lockedRanges = [];
    document.querySelectorAll('.mes[mesid]').forEach(element => {
        const messageId = Number(element.getAttribute('mesid'));
        const message = liveContext().chat?.[messageId];
        const record = message && currentRecord(message);
        if (!record || message.extra?.display_text !== record.translation) return;
        for (const lock of normalizedLockedSegments(record.lockedSegments)) {
            const lockedRange = lockedRangeInTranslation(record.sourceMap, record.translation, lock);
            if (!lockedRange) continue;
            const range = highlightRangeForStoredOffsets(
                messageId,
                record.translation,
                lockedRange.start,
                lockedRange.end,
            );
            if (range) lockedRanges.push(range);
        }
    });
    if (lockedRanges.length) {
        highlights.set('verba-locked-segments', new HighlightConstructor(...lockedRanges));
    }

    if (bundleStillCurrent()) {
        const bundleRanges = multiSelectionState.ranges.flatMap(row => {
            const range = highlightRangeForStoredOffsets(
                multiSelectionState.messageId,
                multiSelectionState.translation,
                row.start,
                row.end,
            );
            return range ? [range] : [];
        });
        if (bundleRanges.length) {
            highlights.set('verba-bundle-selections', new HighlightConstructor(...bundleRanges));
        }
    }
}

function scheduleSelectionHighlights(delay = 0) {
    clearTimeout(selectionHighlightTimer);
    selectionHighlightTimer = setTimeout(refreshSelectionHighlights, delay);
}

function hideSelectionButton() {
    ['#verba-selection-more-menu', '#verba-selection-actions'].forEach(selector => {
        const element = document.querySelector(selector);
        try {
            element?.hidePopover?.();
        } catch {
            // It may already be closed.
        }
        element?.remove();
    });
}

function showSelectionSource(snapshot) {
    if (!snapshot) return;
    const matches = normalizedSourceMap(snapshot.sourceMap)
        .filter(row => snapshot.start < row.end && snapshot.end > row.start);
    if (!matches.length) {
        notify('이 번역에는 구간 원문 정보가 없어요. v0.2.0 이후 새로 번역한 메시지부터 사용할 수 있어요.', 'warning');
        hideSelectionButton();
        return;
    }
    if (document.querySelector('#verba-request-overlay')) return;
    const source = matches.map(row => row.source).join('\n\n');
    const overlay = document.createElement('div');
    overlay.id = 'verba-request-overlay';
    overlay.className = 'verba-overlay';
    if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
    overlay.innerHTML = `
        <section class="verba-modal verba-source-lens-modal" role="dialog" aria-modal="true">
            <header class="verba-modal-header">
                <strong>선택 구간의 원문</strong>
                <button type="button" class="verba-close" aria-label="닫기">✕</button>
            </header>
            <div class="verba-target-preview"><b>선택한 번역</b><span>${escapeHtml(snapshot.selected)}</span></div>
            <pre class="verba-source-lens-text"></pre>
            <div class="verba-modal-actions">
                <button type="button" class="menu_button verba-copy-source">원문 복사</button>
            </div>
        </section>`;
    overlay.querySelector('.verba-source-lens-text').textContent = source;
    const close = () => {
        try {
            overlay.hidePopover?.();
        } catch {
            // It may already be closed.
        }
        overlay.remove();
    };
    overlay.querySelector('.verba-close').addEventListener('click', close);
    overlay.querySelector('.verba-copy-source').addEventListener('click', async () => {
        try {
            await copyText(source);
            notify('선택 구간의 원문을 복사했어요.', 'success');
        } catch (error) {
            reportError('source-copy', error, `원문 복사 실패: ${errorText(error)}`);
        }
    });
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    document.documentElement.append(overlay);
    try {
        overlay.showPopover?.();
    } catch {
        // Fixed-position fallback.
    }
    hideSelectionButton();
}

function selectionPlacementRect(range) {
    try {
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        if (rects.length) return rects.at(-1);
    } catch {
        // Fall through to the complete selection box.
    }
    return range.getBoundingClientRect();
}

function pointerPlacementRect(event) {
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
        left: x,
        right: x,
        top: y,
        bottom: y,
        width: 0,
        height: 0,
    };
}

function selectionFocusPlacementRect(selection = globalThis.getSelection?.()) {
    if (!selection?.focusNode) return null;
    try {
        const range = document.createRange();
        range.setStart(selection.focusNode, selection.focusOffset);
        range.collapse(true);
        const rects = [...range.getClientRects()].filter(rect => rect.height > 0);
        let rect = rects[0] || range.getBoundingClientRect();
        if ((!rect || (!rect.height && !rect.width)) && selection.focusNode.nodeType === Node.TEXT_NODE) {
            const length = selection.focusNode.textContent?.length || 0;
            if (length) {
                const character = document.createRange();
                const offset = Math.min(Math.max(0, selection.focusOffset), length);
                const start = offset > 0 ? offset - 1 : 0;
                const end = offset > 0 ? offset : Math.min(1, length);
                character.setStart(selection.focusNode, start);
                character.setEnd(selection.focusNode, end);
                rect = [...character.getClientRects()].find(item => item.height > 0)
                    || character.getBoundingClientRect();
                if (rect && rect.height) {
                    const x = offset > 0 ? rect.right : rect.left;
                    return {
                        left: x,
                        right: x,
                        top: rect.top,
                        bottom: rect.bottom,
                        width: 0,
                        height: rect.height,
                    };
                }
            }
        }
        if (!rect || (!rect.height && !rect.width)) return null;
        return {
            left: rect.left,
            right: rect.left,
            top: rect.top,
            bottom: rect.bottom || rect.top,
            width: 0,
            height: rect.height || 0,
        };
    } catch {
        return null;
    }
}

function rectInsideBounds(rect, bounds, padding = 24) {
    return Boolean(
        rect
        && bounds
        && Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && rect.left >= bounds.left - padding
        && rect.left <= bounds.right + padding
        && rect.top >= bounds.top - padding
        && rect.top <= bounds.bottom + padding
    );
}

function rangeEndPlacementRect(range) {
    if (!range) return null;
    try {
        let node = range.endContainer;
        let offset = range.endOffset;

        if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
            node = node.childNodes[offset - 1];
            while (node?.lastChild) node = node.lastChild;
            offset = node?.nodeType === Node.TEXT_NODE ? (node.textContent?.length || 0) : 0;
        }

        if (node?.nodeType === Node.TEXT_NODE && node.textContent?.length) {
            const length = node.textContent.length;
            const end = Math.min(Math.max(1, offset), length);
            const character = document.createRange();
            character.setStart(node, end - 1);
            character.setEnd(node, end);
            const rect = [...character.getClientRects()].find(item => item.width > 0 && item.height > 0)
                || character.getBoundingClientRect();
            if (rect?.height) {
                return {
                    left: rect.right,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: 0,
                    height: rect.height,
                };
            }
        }

        const endRange = range.cloneRange();
        endRange.collapse(false);
        const rect = [...endRange.getClientRects()].find(item => item.height > 0)
            || endRange.getBoundingClientRect();
        if (rect?.height || rect?.width) {
            return {
                left: rect.left,
                right: rect.left,
                top: rect.top,
                bottom: rect.bottom || rect.top,
                width: 0,
                height: rect.height || 0,
            };
        }
    } catch {
        // Fall through to the normal selection rectangles.
    }
    return null;
}

function liveSelectionPlacementRect(range, messageText = null) {
    if (!range) return null;
    const bounds = messageText?.getBoundingClientRect?.();
    const endRect = rangeEndPlacementRect(range);
    if (!bounds || rectInsideBounds(endRect, bounds, 2)) return endRect;
    try {
        const rects = [...range.getClientRects()].filter(rect => (
            rect.width > 0
            && rect.height > 0
            && (!bounds || rectInsideBounds(rect, bounds, 2))
        ));
        if (rects.length) return rects.at(-1);
    } catch {
        // Try the selection focus and the complete range below.
    }
    const focusRect = selectionFocusPlacementRect();
    if (!bounds || rectInsideBounds(focusRect, bounds, 2)) return focusRect;
    try {
        const rect = range.getBoundingClientRect();
        if (!bounds || rectInsideBounds(rect, bounds, 2)) return rect;
    } catch {
        // No usable live range rectangle.
    }
    return null;
}

function desktopSelectionPlacement(event) {
    const pointerRect = pointerPlacementRect(event);
    const selection = globalThis.getSelection?.();
    const focusElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE
        ? selection.focusNode
        : selection?.focusNode?.parentElement;
    const messageText = event?.target?.closest?.('.mes[mesid] .mes_text')
        || focusElement?.closest?.('.mes[mesid] .mes_text');
    const bounds = messageText?.getBoundingClientRect?.();
    const pointerInsideMessage = rectInsideBounds(pointerRect, bounds);
    if (pointerInsideMessage) return pointerRect;
    const focusRect = selectionFocusPlacementRect(selection);
    if (rectInsideBounds(focusRect, bounds)) return focusRect;
    if (bounds) {
        return {
            left: bounds.left + (bounds.width / 2),
            right: bounds.left + (bounds.width / 2),
            top: bounds.bottom,
            bottom: bounds.bottom,
            width: 0,
            height: 0,
        };
    }
    return focusRect || pointerRect;
}

function captureSelectionState() {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    try {
        const range = selection.getRangeAt(0);
        return {
            range: range.cloneRange(),
            text: selection.toString(),
            rect: selectionPlacementRect(range),
        };
    } catch {
        return null;
    }
}

function resolveSelection(preserved = null) {
    if (selectionBusy) return null;
    const selection = globalThis.getSelection?.();
    if (!preserved && (!selection || selection.rangeCount !== 1 || selection.isCollapsed)) return null;
    const range = preserved?.range || selection.getRangeAt(0);
    if (!range || range.collapsed) return null;
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer
        : range.endContainer.parentElement;
    const messageElement = startElement?.closest?.('.mes[mesid]');
    const messageText = startElement?.closest?.('.mes_text');
    if (!messageElement || !messageText) return null;
    if (endElement?.closest?.('.mes[mesid]') !== messageElement || endElement?.closest?.('.mes_text') !== messageText) return null;

    const messageId = Number(messageElement.getAttribute('mesid'));
    const message = liveContext().chat?.[messageId];
    const record = message && currentSelectionRecord(message);
    if (!message || !record) return null;

    const raw = String(preserved?.text ?? selection.toString());
    const leading = raw.match(/^\s*/)?.[0]?.length || 0;
    const trailing = raw.match(/\s*$/)?.[0]?.length || 0;
    const selected = raw.slice(leading, raw.length - trailing);
    if (!selected || selected.length > 2400) return null;

    const visibleStart = textOffsetWithin(messageText, range.startContainer, range.startOffset);
    if (visibleStart < 0) return null;
    const before = String(messageText.textContent || '').slice(0, visibleStart + leading);
    const storedRange = resolveStoredSelection(record.translation, selected, before);
    if (!storedRange) return null;
    const storedSelected = record.translation.slice(storedRange.start, storedRange.end);
    return {
        messageId,
        message,
        source: messageSource(message),
        sourceHash: hashText(messageSource(message)),
        swipeId: currentSwipeId(message),
        translation: record.translation,
        sourceMap: normalizedSourceMap(record.sourceMap),
        selected: storedSelected,
        start: storedRange.start,
        end: storedRange.end,
        rect: liveSelectionPlacementRect(range, messageText)
            || preserved?.rect
            || selectionPlacementRect(range),
        anchorRange: range.cloneRange(),
        messageText,
    };
}

function showSelectionButton(snapshot) {
    hideSelectionButton();
    // Re-measure the actual selected glyphs immediately before rendering.
    // Desktop event coordinates can be zero or belong to another overlay.
    const liveRect = liveSelectionPlacementRect(snapshot.anchorRange, snapshot.messageText);
    if (liveRect) snapshot.rect = liveRect;
    selectionSnapshot = snapshot;
    const actions = document.createElement('div');
    actions.id = 'verba-selection-actions';
    actions.className = 'verba-selection-actions';
    const desktopMenu = (
        Date.now() - lastDesktopSelectionAt < 2000
        || globalThis.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches
    ) && lastDesktopSelectionAt >= lastTouchSelectionAt;
    if (!desktopMenu && 'showPopover' in HTMLElement.prototype) actions.setAttribute('popover', 'manual');

    const createAction = (label, className, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `menu_button verba-selection-action ${className}`.trim();
        button.textContent = label;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            handler();
        });
        return button;
    };

    const retranslateButton = createAction('선택 부분 재번역', '', () => {
        retranslateSelection(selectionSnapshot);
    });
    const availableActions = [];
    if (settings.showSelectionName !== false) {
        availableActions.push(createAction('이름으로 고정', 'verba-name-lock-action', () => {
            lockSelectionName(selectionSnapshot);
        }));
    }
    if (settings.showSelectionSource !== false) {
        availableActions.push(createAction('원문 보기', 'verba-source-lens-action', () => {
            showSelectionSource(selectionSnapshot);
        }));
    }
    if (settings.showSelectionLock !== false) {
        availableActions.push(createAction(
            selectionIsLocked(snapshot) ? '잠금 해제' : '구간 잠금',
            'verba-segment-lock-action',
            () => toggleSelectionLock(selectionSnapshot),
        ));
    }
    if (settings.showSelectionBundle !== false) {
        availableActions.push(createAction(
            '묶음 추가',
            'verba-bundle-add-action',
            () => addSelectionToBundle(selectionSnapshot),
        ));
    }

    actions.append(retranslateButton);
    const quickCount = Math.min(5, Math.max(2, Number(settings.selectionQuickCount) || 2));
    const directActionCount = Math.max(0, quickCount - 1);
    const directActions = availableActions.slice(0, directActionCount);
    const overflowActions = availableActions.slice(directActionCount);
    directActions.forEach(button => actions.append(button));

    if (overflowActions.length) {
        const moreButton = document.createElement('button');
        moreButton.type = 'button';
        moreButton.className = 'menu_button verba-selection-action verba-selection-more-toggle';
        moreButton.textContent = '⋯';
        moreButton.title = '다른 기능';
        moreButton.setAttribute('aria-label', '다른 기능 열기');
        moreButton.setAttribute('aria-expanded', 'false');

        const moreMenu = document.createElement('div');
        moreMenu.id = 'verba-selection-more-menu';
        moreMenu.className = 'verba-selection-more-menu';
        if ('showPopover' in HTMLElement.prototype) moreMenu.setAttribute('popover', 'manual');
        overflowActions.forEach(button => {
            button.classList.add('verba-selection-more-action');
            moreMenu.append(button);
        });
        moreMenu.addEventListener('pointerdown', event => event.preventDefault());
        moreButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (moreMenu.isConnected) {
                try {
                    moreMenu.hidePopover?.();
                } catch {
                    // It may already be closed.
                }
                moreMenu.remove();
                moreButton.setAttribute('aria-expanded', 'false');
                return;
            }
            document.querySelector('#verba-selection-more-menu')?.remove();
            moreButton.setAttribute('aria-expanded', 'true');
            moreMenu.style.setProperty('visibility', 'hidden', 'important');
            document.documentElement.append(moreMenu);
            try {
                moreMenu.showPopover?.();
            } catch {
                moreMenu.removeAttribute('popover');
            }
            const viewport = globalThis.visualViewport;
            const viewportLeft = viewport?.offsetLeft || 0;
            const viewportTop = viewport?.offsetTop || 0;
            const viewportWidth = viewport?.width || innerWidth;
            const viewportBottom = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight);
            const actionRect = actions.getBoundingClientRect();
            const menuRect = moreMenu.getBoundingClientRect();
            const menuWidth = Math.min(menuRect.width || 142, viewportWidth - 16);
            const menuHeight = menuRect.height || moreMenu.scrollHeight || 40;
            const left = Math.min(
                Math.max(viewportLeft + 8, actionRect.right - menuWidth),
                viewportLeft + viewportWidth - menuWidth - 8,
            );
            const below = actionRect.bottom + 6;
            const top = below + menuHeight <= viewportBottom - 8
                ? below
                : Math.max(viewportTop + 8, actionRect.top - menuHeight - 6);
            moreMenu.style.setProperty('left', `${left}px`, 'important');
            moreMenu.style.setProperty('top', `${top}px`, 'important');
            moreMenu.style.setProperty('right', 'auto', 'important');
            moreMenu.style.setProperty('bottom', 'auto', 'important');
            moreMenu.style.setProperty('margin', '0', 'important');
            moreMenu.style.removeProperty('visibility');
        });
        actions.append(moreButton);
    }

    actions.addEventListener('pointerdown', event => event.preventDefault());
    actions.style.setProperty('visibility', 'hidden', 'important');
    if (desktopMenu) {
        // Do not use the browser top-layer popover on desktop. Some themes and
        // Chromium webviews reapply the popover's UA inset and force it left.
        actions.style.setProperty('position', 'fixed', 'important');
        (document.body || document.documentElement).append(actions);
    } else {
        document.documentElement.append(actions);
        try {
            actions.showPopover?.();
        } catch {
            // A declared but unopened popover is display:none in supporting browsers.
            // Remove the attribute so fixed positioning remains visible as a fallback.
            actions.removeAttribute('popover');
        }
    }

    const viewport = globalThis.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;
    const measured = actions.getBoundingClientRect();
    const buttonWidth = Math.min(measured.width || 420, viewportWidth - 16);
    const buttonHeight = Math.min(measured.height || 42, viewportHeight - 16);
    const centeredLeft = snapshot.rect.left + (snapshot.rect.width / 2) - (buttonWidth / 2);
    const left = Math.min(
        Math.max(viewportLeft + 8, centeredLeft),
        viewportLeft + viewportWidth - buttonWidth - 8,
    );
    const immediatelyBelow = snapshot.rect.bottom + 8;
    const top = Math.min(
        Math.max(viewportTop + 8, immediatelyBelow),
        viewportTop + viewportHeight - buttonHeight - 8,
    );
    actions.style.setProperty('left', `${left}px`, 'important');
    actions.style.setProperty('top', `${top}px`, 'important');
    actions.style.setProperty('right', 'auto', 'important');
    actions.style.setProperty('bottom', 'auto', 'important');
    actions.style.setProperty('transform', 'none', 'important');
    actions.style.setProperty('z-index', '2147483646', 'important');
    actions.style.setProperty('margin', '0', 'important');
    actions.style.removeProperty('visibility');
}

function selectionHasText() {
    const selection = globalThis.getSelection?.();
    return Boolean(
        selection
        && selection.rangeCount === 1
        && !selection.isCollapsed
        && selection.toString().trim()
    );
}

function touchSelectionRecentlyActive() {
    const coarseOnly = globalThis.matchMedia?.('(pointer: coarse)')?.matches
        && !globalThis.matchMedia?.('(hover: hover)')?.matches;
    return Boolean(
        selectionPointerType === 'touch'
        || selectionPointerType === 'pen'
        || Date.now() - lastTouchSelectionAt < 15000
        || coarseOnly
    );
}

function scheduleSelectionCapture(delay = 80, { hideOnFailure = true, preserved = null } = {}) {
    clearTimeout(selectionTimer);

    // Capture a fully resolved snapshot NOW, while mobile browsers still expose
    // the tiny selected range. Samsung/Chromium can collapse a 1–2 character
    // selection while its native selection toolbar is settling during the 2 s
    // quiet period; a cloned DOM Range alone is not always enough afterwards.
    const preservedSnapshot = preserved ? resolveSelection(preserved) : null;

    selectionTimer = setTimeout(() => {
        const liveSnapshot = resolveSelection();
        const snapshot = liveSnapshot
            || (preservedSnapshot && selectionStillCurrent(preservedSnapshot) ? preservedSnapshot : null)
            || (preserved ? resolveSelection(preserved) : null);
        if (snapshot) {
            showSelectionButton(snapshot);
        }
        else if (hideOnFailure && !selectionBusy) hideSelectionButton();
    }, delay);
}

function selectionStillCurrent(snapshot) {
    const message = liveContext().chat?.[snapshot.messageId];
    const record = message && currentSelectionRecord(message);
    return Boolean(
        message === snapshot.message
        && record
        && currentSwipeId(message) === snapshot.swipeId
        && hashText(messageSource(message)) === snapshot.sourceHash
        && record.translation === snapshot.translation
    );
}

function selectionSourceRows(snapshot) {
    return normalizedSourceMap(snapshot?.sourceMap)
        .filter(row => snapshot.start < row.end && snapshot.end > row.start);
}

function selectionSentenceTargets(snapshot) {
    if (!snapshot) return [];
    const targets = [];
    for (const row of selectionSourceRows(snapshot)) {
        const rowText = snapshot.translation.slice(row.start, row.end);
        const ranges = sentenceRanges(rowText);
        const relativeStart = Math.max(0, snapshot.start - row.start);
        const relativeEnd = Math.min(rowText.length, snapshot.end - row.start);
        const touched = ranges.flatMap((range, sentenceIndex) => (
            relativeStart < range.end && relativeEnd > range.start
                ? [{ range, sentenceIndex }]
                : []
        ));

        // If the browser selection lands only on spacing/punctuation between
        // sentences, use the nearest sentence instead of expanding to the row.
        const resolved = touched.length ? touched : ranges.flatMap((range, sentenceIndex) => {
            const distance = relativeStart < range.start
                ? range.start - relativeStart
                : relativeStart > range.end
                    ? relativeStart - range.end
                    : 0;
            return [{ range, sentenceIndex, distance }];
        }).sort((left, right) => left.distance - right.distance).slice(0, 1);

        for (const item of resolved) {
            const start = row.start + item.range.start;
            const end = row.start + item.range.end;
            if (end <= start) continue;
            targets.push({
                id: row.id,
                source: row.source,
                sentenceIndex: item.sentenceIndex,
                start,
                end,
                translation: snapshot.translation.slice(start, end),
            });
        }
    }
    return targets;
}

function selectionIsLocked(snapshot) {
    if (!snapshot) return false;
    const record = currentSelectionRecord(snapshot.message);
    const targets = selectionSentenceTargets(snapshot);
    if (!record || !targets.length) return false;
    const lockedKeys = new Set(normalizedLockedSegments(record.lockedSegments).map(lockedSegmentKey));
    return targets.every(target => lockedKeys.has(lockedSegmentKey(target)));
}

function selectionTouchesLocked(snapshot) {
    if (!snapshot) return false;
    const record = currentRecord(snapshot.message);
    if (!record) return false;
    const lockedKeys = new Set(normalizedLockedSegments(record.lockedSegments).map(lockedSegmentKey));
    return selectionSentenceTargets(snapshot).some(target => lockedKeys.has(lockedSegmentKey(target)));
}

function toggleSelectionLock(snapshot) {
    if (!snapshot || selectionBusy) return;
    if (!selectionStillCurrent(snapshot)) {
        notify('선택한 뒤 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    const targets = selectionSentenceTargets(snapshot);
    if (!targets.length) {
        notify('선택한 문장을 찾지 못해 잠글 수 없어요. 다시 드래그해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    const record = currentSelectionRecord(snapshot.message);
    const existing = normalizedLockedSegments(record.lockedSegments);
    const targetKeys = new Set(targets.map(lockedSegmentKey));
    const unlock = targets.every(target => existing.some(lock => lockedSegmentKey(lock) === lockedSegmentKey(target)));
    const nextLocks = unlock
        ? existing.filter(lock => !targetKeys.has(lockedSegmentKey(lock)))
        : [
            ...existing.filter(lock => !targetKeys.has(lockedSegmentKey(lock))),
            ...targets.map(target => ({
                id: target.id,
                source: target.source,
                sentenceIndex: target.sentenceIndex,
                translation: target.translation,
            })),
        ];
    const context = liveContext();
    const message = context.chat?.[snapshot.messageId];
    if (message !== snapshot.message) {
        notify('현재 메시지가 바뀌었어요.', 'warning');
        return;
    }
    applyTranslation(snapshot.messageId, message, snapshot.source, snapshot.translation, context.chat, {
        sourceMap: snapshot.sourceMap,
        lockedSegments: nextLocks,
    });
    if (nextLocks.length) transientLockedMessages.add(message);
    else transientLockedMessages.delete(message);
    globalThis.getSelection?.()?.removeAllRanges?.();
    selectionSnapshot = null;
    hideSelectionButton();
    notify(
        unlock
            ? (targets.length > 1 ? `선택한 문장 ${targets.length}개의 잠금을 해제했어요.` : '선택한 문장의 잠금을 해제했어요.')
            : (targets.length > 1 ? `선택한 문장 ${targets.length}개를 잠갔어요.` : '선택한 문장만 잠갔어요.'),
        'success',
    );
}

function selectionSourceContext(snapshot, contextMode) {
    if (contextMode === 'message') return snapshot.source;
    const rows = normalizedSourceMap(snapshot.sourceMap);
    const matchedIndexes = rows.flatMap((row, index) => (
        snapshot.start < row.end && snapshot.end > row.start ? [index] : []
    ));
    if (!matchedIndexes.length) return snapshot.source;
    let first = Math.min(...matchedIndexes);
    let last = Math.max(...matchedIndexes);
    if (contextMode === 'paragraph') {
        first = Math.max(0, first - 1);
        last = Math.min(rows.length - 1, last + 1);
    }
    return rows.slice(first, last + 1).map(row => row.source).join('\n\n');
}

function bundleStillCurrent(state = multiSelectionState) {
    if (!state) return false;
    const message = liveContext().chat?.[state.messageId];
    const record = message && currentSelectionRecord(message);
    return Boolean(
        message === state.message
        && record
        && currentSwipeId(message) === state.swipeId
        && hashText(messageSource(message)) === state.sourceHash
        && record.translation === state.translation
    );
}

function clearMultiSelection() {
    multiSelectionState = null;
    const tray = document.querySelector('#verba-multi-selection-tray');
    try {
        tray?.hidePopover?.();
    } catch {
        // It may already be closed.
    }
    tray?.remove();
    scheduleSelectionHighlights();
}

function clearTransientTranslationSelections() {
    const context = liveContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const visitedExtras = new Set();
    let changed = false;
    const clearLocksFromExtra = extra => {
        if (!extra || typeof extra !== 'object' || visitedExtras.has(extra)) return;
        visitedExtras.add(extra);
        const record = extra[STATE_KEY];
        if (!record || !normalizedLockedSegments(record.lockedSegments).length) return;
        extra[STATE_KEY] = { ...record, lockedSegments: [] };
        changed = true;
    };

    const messagesToClear = new Set([...chat, ...transientLockedMessages]);
    for (const message of messagesToClear) {
        clearLocksFromExtra(message?.extra);
        if (Array.isArray(message?.swipe_info)) {
            message.swipe_info.forEach(swipe => clearLocksFromExtra(swipe?.extra));
        }
    }
    transientLockedMessages.clear();
    for (const cached of lastRenderedTranslationByMessage.values()) {
        if (!normalizedLockedSegments(cached?.record?.lockedSegments).length) continue;
        cached.record = { ...cached.record, lockedSegments: [] };
    }

    selectionSnapshot = null;
    hideSelectionButton();
    globalThis.getSelection?.()?.removeAllRanges?.();
    clearMultiSelection();
    if (changed) scheduleChatSave(context.chat);
    scheduleSelectionHighlights();
}

function renderMultiSelectionTray() {
    document.querySelector('#verba-multi-selection-tray')?.remove();
    if (!multiSelectionState?.ranges?.length) return;
    const tray = document.createElement('div');
    tray.id = 'verba-multi-selection-tray';
    tray.className = 'verba-multi-selection-tray';
    tray.setAttribute('role', 'status');
    if ('showPopover' in HTMLElement.prototype) tray.setAttribute('popover', 'manual');
    tray.innerHTML = `
        <b>묶음 선택 ${multiSelectionState.ranges.length}개</b>
        <button type="button" class="menu_button verba-bundle-run">한꺼번에 재번역</button>
        <button type="button" class="menu_button verba-bundle-clear">초기화</button>`;
    tray.querySelector('.verba-bundle-run').addEventListener('click', retranslateSelectionBundle);
    tray.querySelector('.verba-bundle-clear').addEventListener('click', () => {
        clearMultiSelection();
        notify('묶음 선택을 비웠어요.', 'info');
    });
    // Mount inside body so fixed positioning and inherited theme variables work
    // consistently across mobile themes and WebView variants.
    (document.body || document.documentElement).append(tray);
    try {
        tray.showPopover?.();
    } catch {
        // Fixed positioning remains as a fallback on older WebViews.
        tray.removeAttribute('popover');
    }
}

function addSelectionToBundle(snapshot) {
    if (!snapshot || selectionBusy) return;
    if (!selectionStillCurrent(snapshot)) {
        notify('선택한 뒤 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        return;
    }
    if (selectionTouchesLocked(snapshot)) {
        notify('잠긴 번역 구간은 묶음 재번역에 추가할 수 없어요.', 'warning');
        return;
    }
    if (multiSelectionState && (
        multiSelectionState.messageId !== snapshot.messageId
        || multiSelectionState.message !== snapshot.message
        || multiSelectionState.translation !== snapshot.translation
    )) {
        notify('묶음 재번역은 한 메시지 안에서만 가능해요. 기존 묶음을 먼저 초기화해 주세요.', 'warning');
        return;
    }
    if (!multiSelectionState) {
        multiSelectionState = {
            messageId: snapshot.messageId,
            message: snapshot.message,
            source: snapshot.source,
            sourceHash: snapshot.sourceHash,
            swipeId: snapshot.swipeId,
            translation: snapshot.translation,
            sourceMap: normalizedSourceMap(snapshot.sourceMap),
            ranges: [],
        };
    }
    if (multiSelectionState.ranges.some(row => snapshot.start < row.end && snapshot.end > row.start)) {
        notify('이미 묶음에 포함된 범위와 겹쳐요.', 'warning');
        return;
    }
    if (multiSelectionState.ranges.length >= 12) {
        notify('한 번에 최대 12개 구간까지 묶을 수 있어요.', 'warning');
        return;
    }
    multiSelectionState.ranges.push({
        selected: snapshot.selected,
        start: snapshot.start,
        end: snapshot.end,
    });
    multiSelectionState.ranges.sort((left, right) => left.start - right.start);
    globalThis.getSelection?.()?.removeAllRanges?.();
    selectionSnapshot = null;
    hideSelectionButton();
    renderMultiSelectionTray();
    scheduleSelectionHighlights();
    notify(`묶음에 ${multiSelectionState.ranges.length}개 구간을 담았어요.`, 'success');
}

async function retranslateSelectionBundle() {
    const state = multiSelectionState;
    if (!state || selectionBusy) return;
    if (!settings.profileId) {
        notify('먼저 번역기 전용 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }
    if (!bundleStillCurrent(state)) {
        clearMultiSelection();
        notify('번역문이 바뀌어 묶음 선택을 초기화했어요.', 'warning');
        return;
    }
    if (state.ranges.some(range => selectionTouchesLocked({ ...state, ...range, message: state.message }))) {
        notify('묶음 안에 잠긴 번역 구간이 있어 재번역할 수 없어요.', 'warning');
        return;
    }

    selectionBusy = true;
    const request = await requestOneTimeInstruction('multi', `${state.ranges.length}개 선택 구간`);
    if (request === null) {
        selectionBusy = false;
        return;
    }
    const instruction = typeof request === 'object' ? request.instruction : String(request || '');
    const contextMode = typeof request === 'object' ? request.contextMode : 'paragraph';
    const tuning = typeof request === 'object' ? request.tuning : null;
    if (!bundleStillCurrent(state)) {
        selectionBusy = false;
        clearMultiSelection();
        notify('요구사항을 적는 동안 번역문이 바뀌었어요.', 'warning');
        return;
    }

    const bundleHasDialogue = state.ranges.some(range => selectionTouchesDialogue(
        state.translation,
        range.start,
        range.end,
    ));
    warnTranslationPromptConflicts({
        oneTimeInstruction: instruction,
        includeDialogue: bundleHasDialogue,
        includeCharacterDialogue: bundleHasDialogue,
    });
    const speakerIdentity = outputSpeakerIdentity(state.message);

    const selections = state.ranges.map((range, index) => ({
        ...range,
        id: `multi_${String(index).padStart(4, '0')}`,
        sourceContext: selectionSourceContext({ ...state, ...range }, contextMode),
    }));
    const expected = selections.map(row => ({ id: row.id, type: 'multi_selection', text: row.selected }));
    const prompt = buildMultiSelectionPrompt({
        source: state.source,
        translation: state.translation,
        selections,
        settings,
        oneTimeInstruction: instruction,
        speakerIdentity,
        contextMode,
        tuning,
    });
    const controller = new AbortController();
    let toast = showProgress(`선택한 ${selections.length}개 구간을 한꺼번에 다시 번역 중입니다…`);
    try {
        const result = await requestSegments(prompt, expected, {
            signal: controller.signal,
            stage: 'multi-selection-retranslation',
        });
        for (const row of selections) {
            result.set(
                row.id,
                repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(result.get(row.id), speakerIdentity)),
            );
        }
        const unchangedIds = selections
            .filter(row => sameRetranslationWording(result.get(row.id), row.selected))
            .map(row => row.id);
        if (unchangedIds.length) {
            const changedPrompt = `${prompt}\n\nMANDATORY BUNDLE RETRANSLATION CORRECTION
Your previous response echoed the existing Korean wording for these ids: ${JSON.stringify(unchangedIds)}.
- Return every required id again in the same JSON schema.
- For each listed id, the translation MUST differ from selected_korean after Unicode and whitespace normalization.
- Do not merely change spacing or punctuation.
- Rephrase wording, syntax, or rhythm while preserving the exact source meaning, referents, tense, intensity, explicitness, and grammatical role.
- Follow the user's one-time request. Do not return an unchanged selection.`;
            const retryResult = await requestSegments(changedPrompt, expected, {
                signal: controller.signal,
                stage: 'multi-selection-retranslation-unchanged-retry',
            });
            unchangedIds.forEach(id => result.set(
                id,
                repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(retryResult.get(id), speakerIdentity)),
            ));
        }
        const replacements = selections.map(row => {
            const replacement = String(result.get(row.id) || '').trim();
            if (!replacement) throw new Error('묶음 재번역 결과 중 비어 있는 구간이 있습니다.');
            if (sameRetranslationWording(replacement, row.selected)) {
                throw new Error(`AI가 두 번 모두 기존 번역과 같은 문장을 반환했습니다: ${row.selected.slice(0, 40)}`);
            }
            const banned = findBannedWords(replacement, settings.bannedWords);
            if (banned.length) throw new Error(`재번역 결과에 금지어가 남았습니다: ${banned.join(', ')}`);
            if (replacement.length > Math.max(300, row.selected.length * 7)) {
                throw new Error('선택 범위보다 지나치게 긴 결과가 반환되었습니다.');
            }
            return { start: row.start, end: row.end, replacement };
        });
        if (!bundleStillCurrent(state)) throw new Error('재번역 중 원문이나 번역문이 바뀌었습니다.');
        let updated = state.translation;
        let sourceMap = normalizedSourceMap(state.sourceMap);
        for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
            updated = updated.slice(0, replacement.start)
                + replacement.replacement
                + updated.slice(replacement.end);
            sourceMap = sourceMapAfterSelection(
                sourceMap,
                replacement.start,
                replacement.end,
                replacement.replacement,
            );
        }
        const context = liveContext();
        applyTranslation(state.messageId, state.message, state.source, updated, context.chat, {
            sourceMap,
            lockedSegments: [],
        });
        clearTransientTranslationSelections();
        notify(`${replacements.length}개 구간을 한꺼번에 교체했어요.`, 'success');
    } catch (error) {
        if (!isAbort(error, controller.signal)) {
            console.error('[베르바] 묶음 재번역 실패', error);
            reportError('bundle-retranslation', error, `묶음 재번역 실패: ${errorText(error)}`);
        }
    } finally {
        clearProgress(toast);
        selectionBusy = false;
    }
}

async function lockSelectionName(snapshot) {
    if (!snapshot || selectionBusy) return;
    if (!settings.profileId) {
        notify('원문 이름을 찾으려면 먼저 번역기 전용 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }
    if (!currentCharacterReference()) {
        notify('이름 고정은 개별 캐릭터 채팅에서 사용할 수 있어요.', 'warning');
        return;
    }
    const currentName = String(snapshot.selected || '').trim();
    if (!currentName || currentName.length > 120 || /[\r\n]/.test(currentName)) {
        notify('번역문에서 이름 부분만 짧게 선택해 주세요.', 'warning');
        return;
    }
    if (!selectionStillCurrent(snapshot)) {
        notify('선택한 뒤 번역문이 바뀌었어요. 다시 선택해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }

    selectionBusy = true;
    hideSelectionButton();
    const controller = new AbortController();
    let toast = showProgress('선택한 이름에 대응하는 원문을 찾는 중입니다…');
    try {
        const prompt = buildNameMatchPrompt({
            source: snapshot.source,
            translation: snapshot.translation,
            selected: currentName,
            start: snapshot.start,
            end: snapshot.end,
        });
        const expected = [{ id: 'seg_0000', type: 'name_match', text: currentName }];
        const result = await requestSegments(prompt, expected, { signal: controller.signal, stage: 'name-match' });
        const sourceName = resolveExactSourceName(snapshot.source, result.get('seg_0000'));
        if (!sourceName) throw new Error('선택한 표기에 대응하는 원문 이름을 정확히 찾지 못했습니다.');
        if (!selectionStillCurrent(snapshot)) throw new Error('확인 중 원문이나 번역문이 바뀌었습니다.');

        clearProgress(toast);
        toast = null;
        const previousTarget = normalizedCharacterNameLocks()
            .find(row => row.source.toLocaleLowerCase() === sourceName.toLocaleLowerCase())?.target || '';
        const choice = await requestNameLockTarget(sourceName, currentName);
        if (choice === null) return;
        const { targetName, replaceHistory } = choice;
        if (!selectionStillCurrent(snapshot)) throw new Error('이름을 입력하는 동안 번역문이 바뀌었습니다.');

        let oldNames = [currentName, previousTarget].filter(Boolean);
        if (replaceHistory) {
            toast = showProgress('현재 채팅 전체에서 이전 이름 표기를 찾는 중입니다…');
            try {
                oldNames = await detectHistoricalNameForms(
                    sourceName,
                    currentName,
                    [previousTarget],
                    { signal: controller.signal },
                );
            } catch (error) {
                if (isAbort(error, controller.signal)) throw error;
                console.warn('[베르바] 이전 이름 표기 자동 탐색 실패 — 확인된 표기만 변경합니다.', error);
            } finally {
                clearProgress(toast);
                toast = null;
            }
        }
        await saveCharacterNameLock(sourceName, targetName);
        renderNameLockManager();
        const context = liveContext();
        const message = context.chat?.[snapshot.messageId];
        if (!message || message !== snapshot.message) throw new Error('현재 메시지가 바뀌었습니다.');
        let historyResult = { changedRecords: 0, changedMessages: 0 };
        if (replaceHistory) {
            historyResult = replaceNameAcrossChatTranslations(oldNames, targetName);
        }
        if (!replaceHistory || !historyResult.changedMessages) {
            const updated = replaceOutsideProtected(snapshot.translation, currentName, targetName);
            const sourceMap = sourceMapAfterGlobalReplacements(
                snapshot.sourceMap,
                snapshot.translation,
                updated,
                [{ search: currentName, value: targetName }],
            );
            applyTranslation(snapshot.messageId, message, snapshot.source, updated, context.chat, { sourceMap });
        }
        globalThis.getSelection?.()?.removeAllRanges?.();
        const historyNotice = replaceHistory && historyResult.changedRecords
            ? ` 현재 채팅의 저장 번역본 ${historyResult.changedRecords}개도 변경했어요.`
            : '';
        notify(`${sourceName}의 표기를 “${targetName}”로 이 캐릭터에 저장했어요.${historyNotice}`, 'success');
    } catch (error) {
        if (!isAbort(error, controller.signal)) {
            console.error('[베르바] 이름 고정 실패', error);
            reportError('name-lock', error, `이름 고정 실패: ${errorText(error)}`);
        }
    } finally {
        clearProgress(toast);
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
    }
}

async function retranslateSelection(snapshot) {
    if (!snapshot || selectionBusy) return;
    if (!settings.profileId) {
        notify('먼저 번역기 전용 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }
    if (!selectionStillCurrent(snapshot)) {
        notify('선택한 뒤 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    if (selectionTouchesLocked(snapshot)) {
        notify('잠긴 번역 구간은 재번역할 수 없어요. 먼저 잠금을 해제해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    selectionBusy = true;
    const request = await requestOneTimeInstruction('selection', snapshot.selected.slice(0, 110));
    if (request === null) {
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
        return;
    }
    const instruction = typeof request === 'object' ? request.instruction : String(request || '');
    const contextMode = typeof request === 'object' ? request.contextMode : 'standard';
    const tuning = typeof request === 'object' ? request.tuning : null;
    if (!selectionStillCurrent(snapshot)) {
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
        notify('요구사항을 적는 동안 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        return;
    }

    const selectionHasDialogue = selectionTouchesDialogue(
        snapshot.translation,
        snapshot.start,
        snapshot.end,
    );
    warnTranslationPromptConflicts({
        oneTimeInstruction: instruction,
        includeDialogue: selectionHasDialogue,
        includeCharacterDialogue: selectionHasDialogue,
    });
    const speakerIdentity = outputSpeakerIdentity(snapshot.message);

    const controller = new AbortController();
    const candidateMode = Boolean(settings.selectionCandidates);
    const prompt = buildSelectionPrompt({
        source: snapshot.source,
        translation: snapshot.translation,
        selected: snapshot.selected,
        start: snapshot.start,
        end: snapshot.end,
        settings,
        oneTimeInstruction: instruction,
        speakerIdentity,
        candidateCount: candidateMode ? 3 : 1,
        contextMode,
        sourceContext: selectionSourceContext(snapshot, contextMode),
        tuning,
    });
    const expected = [{ id: 'seg_0000', type: 'selection', text: snapshot.selected }];
    let toast = showProgress(candidateMode
        ? '선택한 부분의 번역 후보 3개를 만드는 중입니다…'
        : '선택한 부분만 다시 번역 중입니다…');
    try {
        let replacement = '';
        if (candidateMode) {
            const received = (await requestSelectionCandidates(prompt, { signal: controller.signal, stage: 'selection-candidates' }))
                .map(candidate => repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(candidate, speakerIdentity)));
            const candidates = received.filter(candidate => {
                const text = String(candidate || '').trim();
                if (!text || sameRetranslationWording(text, snapshot.selected)) return false;
                if (findBannedWords(text, settings.bannedWords).length) return false;
                return text.length <= Math.max(300, snapshot.selected.length * 7);
            });
            if (candidates.length < 2) {
                throw new Error('사용할 수 있는 서로 다른 번역 후보가 두 개 이상 만들어지지 않았습니다.');
            }
            if (!selectionStillCurrent(snapshot)) throw new Error('후보 생성 중 원문이나 번역문이 바뀌었습니다.');
            clearProgress(toast);
            toast = null;
            replacement = await requestSelectionCandidateChoice(candidates, snapshot.selected);
            if (replacement === null) return;
        } else {
            let result = await requestSegments(prompt, expected, { signal: controller.signal, stage: 'selection-retranslation' });
            replacement = repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(result.get('seg_0000'), speakerIdentity)).trim();
            if (!replacement || sameRetranslationWording(replacement, snapshot.selected)) {
                const changedPrompt = `${prompt}\n\nMANDATORY RETRANSLATION CORRECTION
Your previous replacement was empty or unchanged. Return a genuinely different Korean wording for the selected fragment now.
- Do not repeat the existing selected fragment verbatim or with whitespace-only changes.
- Follow the user's one-time request.
- Preserve the original meaning, referents, intensity, tense, and grammatical role.
- Change only wording, syntax, or rhythm; return replacement text only in the required JSON schema.`;
                result = await requestSegments(changedPrompt, expected, {
                    signal: controller.signal,
                    stage: 'selection-retranslation-unchanged-retry',
                });
                replacement = repairKoreanParticleAlternatives(repairIndivisibleIdentityNames(result.get('seg_0000'), speakerIdentity)).trim();
            }
            if (sameRetranslationWording(replacement, snapshot.selected)) {
                throw new Error('AI가 두 번 모두 기존 번역과 같은 문장을 반환하여 변경하지 않았습니다. 요구사항을 더 구체적으로 적어 다시 시도해 주세요.');
            }
        }
        if (!replacement) throw new Error('선택 부분 재번역 결과가 비어 있습니다.');
        const banned = findBannedWords(replacement, settings.bannedWords);
        if (banned.length) throw new Error(`재번역 결과에 금지어가 남았습니다: ${banned.join(', ')}`);
        if (replacement.length > Math.max(300, snapshot.selected.length * 7)) {
            throw new Error('선택 범위보다 지나치게 긴 결과가 반환되었습니다.');
        }
        if (!selectionStillCurrent(snapshot)) throw new Error('재번역 중 원문이나 번역문이 바뀌었습니다.');
        const updated = snapshot.translation.slice(0, snapshot.start)
            + replacement
            + snapshot.translation.slice(snapshot.end);
        const context = liveContext();
        const message = context.chat?.[snapshot.messageId];
        const sourceMap = sourceMapAfterSelection(
            snapshot.sourceMap,
            snapshot.start,
            snapshot.end,
            replacement,
        );
        applyTranslation(snapshot.messageId, message, snapshot.source, updated, context.chat, {
            sourceMap,
            lockedSegments: [],
        });
        clearTransientTranslationSelections();
        globalThis.getSelection?.()?.removeAllRanges?.();
        notify(candidateMode ? '선택한 후보로 번역을 교체했어요.' : '선택한 부분만 다시 번역했어요.', 'success');
    } catch (error) {
        if (!isAbort(error, controller.signal)) {
            console.error('[베르바] 선택 부분 재번역 실패', error);
            reportError('selection-retranslation', error, `선택 부분 재번역 실패: ${errorText(error)}`);
        }
    } finally {
        clearProgress(toast);
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
    }
}

function setupSelection() {
    const hasPointerEvents = 'PointerEvent' in globalThis;
    // Desktop browsers expose PointerEvent too, so mouseup cannot be only a
    // no-PointerEvent fallback. Capture it before themes/extensions can stop it.
    document.addEventListener('mouseup', event => {
        if (event.button !== 0) return;
        if (event.sourceCapabilities?.firesTouchEvents) return;
        if (event.target?.closest?.('#verba-selection-actions, #verba-selection-more-menu')) return;
        const pointerRect = desktopSelectionPlacement(event);
        lastDesktopSelectionPlacement = pointerRect;
        lastDesktopSelectionAt = Date.now();
        const preserved = preservedGestureSelection;
        selectionGestureActive = false;
        selectionNeedsCapture = false;
        selectionPointerType = '';
        preservedGestureSelection = null;
        const snapshot = resolveSelection() || (preserved ? resolveSelection(preserved) : null);
        if (snapshot) {
            clearTimeout(selectionTimer);
            // Open after the mouse event finishes so the following click cannot
            // light-dismiss a popover that was created during mouseup.
            selectionTimer = setTimeout(() => showSelectionButton(snapshot), 0);
        } else if (selectionHasText() || preserved) {
            scheduleSelectionCapture(30, { hideOnFailure: false, preserved });
        }
    }, true);
    if (!hasPointerEvents) {
        document.addEventListener('touchend', event => {
            if (event.target?.closest?.('#verba-selection-actions, #verba-selection-more-menu')) return;
            lastTouchSelectionAt = Date.now();
            const preserved = captureSelectionState();
            scheduleSelectionCapture(TOUCH_SELECTION_QUIET_MS, {
                hideOnFailure: false,
                preserved,
            });
        }, { passive: true });
    }
    document.addEventListener('pointerdown', event => {
        if (event.target?.closest?.('#verba-selection-actions, #verba-selection-more-menu')) return;
        if (document.querySelector('#verba-selection-actions, #verba-selection-more-menu')) {
            clearTimeout(selectionTimer);
            selectionSnapshot = null;
            hideSelectionButton();
            globalThis.getSelection?.()?.removeAllRanges?.();
        }
        if (event.target?.closest?.('.mes[mesid] .mes_text')) {
            if ((event.pointerType || '') === 'mouse') {
                lastDesktopSelectionPlacement = null;
                lastDesktopSelectionAt = 0;
            }
            selectionGestureActive = true;
            selectionNeedsCapture = false;
            selectionPointerType = event.pointerType || '';
            preservedGestureSelection = null;
            if (event.pointerType === 'touch' || event.pointerType === 'pen') {
                lastTouchSelectionAt = Date.now();
            }
            clearTimeout(selectionTimer);
            return;
        }
        selectionGestureActive = false;
        selectionNeedsCapture = false;
        selectionPointerType = '';
        preservedGestureSelection = null;
        selectionSnapshot = null;
        hideSelectionButton();
    }, { passive: true });
    document.addEventListener('pointerup', event => {
        if (event.target?.closest?.('#verba-selection-actions, #verba-selection-more-menu')) return;
        const pointerType = event.pointerType || selectionPointerType;
        const shouldCapture = selectionGestureActive
            || selectionNeedsCapture
            || event.target?.closest?.('.mes[mesid] .mes_text');
        selectionGestureActive = false;
        selectionNeedsCapture = false;
        if (pointerType === 'touch' || pointerType === 'pen') lastTouchSelectionAt = Date.now();
        const preserved = captureSelectionState() || preservedGestureSelection;
        if (pointerType === 'mouse') {
            const pointerRect = desktopSelectionPlacement(event);
            if (pointerRect) {
                lastDesktopSelectionPlacement = pointerRect;
                lastDesktopSelectionAt = Date.now();
            }
        }
        if (shouldCapture) {
            scheduleSelectionCapture(
                pointerType === 'touch' || pointerType === 'pen' ? TOUCH_SELECTION_QUIET_MS : 100,
                { preserved },
            );
        }
    }, true);
    document.addEventListener('pointercancel', event => {
        const pointerType = event.pointerType || selectionPointerType;
        const preserved = captureSelectionState() || preservedGestureSelection;
        selectionGestureActive = false;
        selectionNeedsCapture = false;
        selectionPointerType = '';
        preservedGestureSelection = preserved;

        // Android/Chromium commonly cancels the original touch pointer as soon as
        // native word selection takes over. Treat that cancel exactly like a
        // completed touch selection instead of throwing the selected word away.
        if ((pointerType === 'touch' || pointerType === 'pen') && preserved) {
            lastTouchSelectionAt = Date.now();
            scheduleSelectionCapture(TOUCH_SELECTION_QUIET_MS, {
                hideOnFailure: false,
                preserved,
            });
        }
    }, { passive: true });
    document.addEventListener('contextmenu', event => {
        if (Date.now() < suppressMessageCopyClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.target?.closest?.('.mes[mesid] .mes_text')) {
            if (selectionGestureActive) {
                selectionNeedsCapture = true;
                return;
            }
            const preserved = captureSelectionState();
            scheduleSelectionCapture(
                touchSelectionRecentlyActive() ? TOUCH_SELECTION_QUIET_MS : 220,
                { hideOnFailure: false, preserved },
            );
        }
    });
    document.addEventListener('selectionchange', () => {
        const currentSelection = captureSelectionState();
        if (selectionGestureActive) {
            selectionNeedsCapture = true;
            preservedGestureSelection = currentSelection || preservedGestureSelection;

            // A simple long-press word selection may never produce pointerup on
            // mobile: the browser can hand control to its native selection UI and
            // emit pointercancel instead. Start the same 2-second quiet timer as
            // soon as any real non-collapsed selection exists. Further handle
            // movement fires selectionchange again and resets this timer.
            if (preservedGestureSelection && touchSelectionRecentlyActive()) {
                lastTouchSelectionAt = Date.now();
                scheduleSelectionCapture(TOUCH_SELECTION_QUIET_MS, {
                    hideOnFailure: false,
                    preserved: preservedGestureSelection,
                });
            }
            return;
        }
        // mouseup already opened the desktop menu at the real pointer position.
        // Ignore the trailing selectionchange that otherwise redraws it using
        // an unreliable browser range rectangle near the left edge.
        if (
            lastDesktopSelectionPlacement
            && Date.now() - lastDesktopSelectionAt < 1500
            && !touchSelectionRecentlyActive()
        ) return;
        // A desktop selection can briefly report as collapsed while the mouse
        // button is released. Keep the existing pill through that transient state.
        const preserved = captureSelectionState();
        if (preserved) {
            const isTouchSelection = touchSelectionRecentlyActive();
            if (isTouchSelection) lastTouchSelectionAt = Date.now();
            scheduleSelectionCapture(
                isTouchSelection ? TOUCH_SELECTION_QUIET_MS : 100,
                { hideOnFailure: false, preserved },
            );
        }
    });
    window.addEventListener('resize', hideSelectionButton);
}

function showMessageCopyMenu(messageId) {
    const message = liveContext().chat?.[Number(messageId)];
    const record = message && currentRecord(message);
    if (!message || !record) {
        notify('복사할 저장 번역본이 없어요.', 'warning');
        return;
    }
    if (document.querySelector('#verba-request-overlay')) return;
    const source = messageSource(message);
    const translation = String(record.translation || '');
    const overlay = document.createElement('div');
    overlay.id = 'verba-request-overlay';
    overlay.className = 'verba-overlay';
    if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
    overlay.innerHTML = `
        <section class="verba-modal verba-copy-modal" role="dialog" aria-modal="true">
            <header class="verba-modal-header">
                <strong>메시지 복사</strong>
                <button type="button" class="verba-close" aria-label="닫기">✕</button>
            </header>
            <small>복사할 형식을 선택하세요.</small>
            <div class="verba-copy-options">
                <button type="button" class="menu_button" data-copy="translation">번역문만</button>
                <button type="button" class="menu_button" data-copy="source">영어 원문만</button>
                <button type="button" class="menu_button" data-copy="both">원문 + 번역문</button>
            </div>
        </section>`;
    const close = () => {
        try {
            overlay.hidePopover?.();
        } catch {
            // It may already be closed.
        }
        overlay.remove();
    };
    overlay.querySelector('.verba-close').addEventListener('click', close);
    overlay.querySelectorAll('[data-copy]').forEach(button => {
        button.addEventListener('click', async () => {
            const format = button.dataset.copy;
            const value = format === 'source'
                ? source
                : format === 'both'
                    ? `원문\n${source}\n\n번역문\n${translation}`
                    : translation;
            try {
                await copyText(value);
                close();
                notify('메시지를 복사했어요.', 'success');
            } catch (error) {
                reportError('message-copy', error, `메시지 복사 실패: ${errorText(error)}`);
            }
        });
    });
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    document.documentElement.append(overlay);
    try {
        overlay.showPopover?.();
    } catch {
        // Fixed-position fallback.
    }
}

function cancelMessageCopyHold() {
    clearTimeout(messageCopyHoldTimer);
    messageCopyHoldTimer = null;
    messageCopyPointerId = null;
    messageCopyStart = null;
}

function pointHitsRenderedText(container, x, y) {
    if (!container) return false;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = globalThis.getComputedStyle?.(parent);
            if (style && (style.display === 'none' || style.visibility === 'hidden')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
            if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) {
                range.detach?.();
                return true;
            }
        }
    }
    range.detach?.();
    return false;
}

function setupMessageCopyHold() {
    document.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const messageElement = event.target?.closest?.('.mes[mesid]');
        const messageText = event.target?.closest?.('.mes_text');
        const interactive = event.target?.closest?.(
            'button, a, input, textarea, select, [contenteditable="true"], .mes_buttons, .extraMesButtons, #verba-selection-actions, #verba-selection-more-menu',
        );
        const startedOnText = messageText && pointHitsRenderedText(messageText, event.clientX, event.clientY);
        if (!messageElement || interactive || startedOnText || document.querySelector('#verba-request-overlay')) {
            cancelMessageCopyHold();
            return;
        }
        const messageId = Number(messageElement.getAttribute('mesid'));
        const message = liveContext().chat?.[messageId];
        if (!Number.isInteger(messageId) || !message || !currentRecord(message)) {
            cancelMessageCopyHold();
            return;
        }

        cancelMessageCopyHold();
        messageCopyPointerId = event.pointerId;
        messageCopyStart = { x: event.clientX, y: event.clientY };
        messageCopyHoldShown = false;
        messageCopyHoldTimer = setTimeout(() => {
            messageCopyHoldTimer = null;
            const latest = liveContext().chat?.[messageId];
            if (!messageElement.isConnected || latest !== message || !currentRecord(latest)) return;
            selectionSnapshot = null;
            hideSelectionButton();
            globalThis.getSelection?.()?.removeAllRanges?.();
            messageCopyHoldShown = true;
            showMessageCopyMenu(messageId);
            try {
                navigator.vibrate?.(20);
            } catch {
                // 진동을 지원하지 않는 환경에서는 메뉴만 표시한다.
            }
        }, 420);
    }, { passive: true });

    document.addEventListener('pointermove', event => {
        if (event.pointerId !== messageCopyPointerId || !messageCopyStart) return;
        if (Math.hypot(event.clientX - messageCopyStart.x, event.clientY - messageCopyStart.y) > 9) {
            messageCopyHoldShown = false;
            cancelMessageCopyHold();
        }
    }, { passive: true });

    const finishHold = event => {
        if (event.pointerId !== messageCopyPointerId) return;
        const opened = messageCopyHoldShown;
        cancelMessageCopyHold();
        messageCopyHoldShown = false;
        if (opened) suppressMessageCopyClickUntil = Date.now() + 180;
    };
    document.addEventListener('pointerup', finishHold, { passive: true });
    document.addEventListener('pointercancel', finishHold, { passive: true });
    document.addEventListener('scroll', () => {
        messageCopyHoldShown = false;
        cancelMessageCopyHold();
    }, true);
    document.addEventListener('click', event => {
        if (Date.now() >= suppressMessageCopyClickUntil) return;
        suppressMessageCopyClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

function refreshTranslationClasses() {
    document.querySelectorAll('.mes[mesid]').forEach(element => {
        const id = Number(element.getAttribute('mesid'));
        const message = liveContext().chat?.[id];
        const record = message && currentRecord(message);
        const active = Boolean(record && message.extra?.display_text === record.translation);
        element.classList.toggle('verba-translation-active', active);
        element.querySelectorAll('.verba-copy-menu-button').forEach(button => button.remove());
        if (active && !element.classList.contains('verba-swipe-hold-active')) {
            const html = element.querySelector('.mes_text')?.innerHTML || '';
            const key = renderedTranslationKey(id, record);
            if (key && html.trim()) {
                renderedTranslationCache.set(key, html);
                lastRenderedTranslationByMessage.set(id, {
                    signature: storedRecordSignature(record),
                    record: { ...record },
                    html,
                });
            }
        }
    });
    scheduleSelectionHighlights();
}

function createProfileToggleButton() {
    const button = document.createElement('button');
    button.id = 'verba-profile-toggle';
    button.type = 'button';
    button.className = 'verba-input-icon verba-profile-toggle';
    const arrows = document.createElement('span');
    arrows.className = 'verba-profile-arrows';
    arrows.textContent = '⇄';
    arrows.setAttribute('aria-hidden', 'true');
    const badge = document.createElement('small');
    badge.className = 'verba-profile-slot';
    badge.textContent = 'A';
    button.append(arrows, badge);
    button.addEventListener('click', () => {
        const configured = configuredProfiles();
        if (configured.length < 2) {
            notify('설정에서 서로 다른 연결 프로필을 두 개 이상 선택해 주세요.', 'warning');
            return;
        }
        const currentIndex = configured.findIndex(profile => profile.slot === activeProfileSlot());
        settings.activeProfileSlot = configured[(currentIndex + 1) % configured.length].slot;
        saveSettings();
        refreshProfileToggleButton();
        const profiles = configuredProfileCycle();
        notify(`번역 프로필 ${profiles.slot}: ${profileDisplayName(profiles.active)}`, 'success');
    });
    return button;
}

function refreshProfileToggleButton() {
    const button = document.querySelector('#verba-profile-toggle');
    if (!button) return;
    const profiles = configuredProfileCycle();
    const configured = configuredProfiles();
    const canSwitch = configured.length >= 2;
    button.hidden = !canSwitch;
    button.querySelector('.verba-profile-slot').textContent = profiles.slot;
    button.classList.toggle('verba-profile-b', profiles.slot === 'B');
    button.classList.toggle('verba-profile-c', profiles.slot === 'C');
    const currentIndex = configured.findIndex(profile => profile.slot === profiles.slot);
    const nextSlot = canSwitch ? configured[(currentIndex + 1) % configured.length].slot : 'B';
    const title = canSwitch
        ? `현재 번역 프로필 ${profiles.slot}: ${profileDisplayName(profiles.active)} · 눌러 ${nextSlot}로 전환`
        : '설정에서 연결 프로필을 두 개 이상 선택하면 빠르게 전환할 수 있어요.';
    button.title = title;
    button.setAttribute('aria-label', title);
}

function refreshRetranslateButton() {
    const button = document.querySelector('#verba-retranslate-latest');
    if (!button) return;
    const target = latestAssistantMessage();
    const busy = target ? pendingOutputs.has(target.id) : false;
    const failed = target
        ? failedOutputSignatures.get(target.id) === messageVersionSignature(target.message)
        : false;
    button.disabled = !target || busy;
    button.classList.toggle('verba-busy', busy);
    button.classList.toggle('verba-retry-needed', failed && !busy);
    const translated = target ? Boolean(currentRecord(target.message)) : false;
    button.title = busy
        ? '최근 아웃풋 번역 중'
        : failed || !translated
            ? '최근 아웃풋 번역 또는 다시 시도'
            : '아웃풋 재번역 · 최근/이전 선택';
}

function createRetranslateButton() {
    const button = document.createElement('button');
    button.id = 'verba-retranslate-latest';
    button.type = 'button';
    button.className = 'verba-input-icon';
    button.textContent = '↻';
    button.title = '아웃풋 번역 / 재번역';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', retranslateLatestOutput);
    return button;
}

function injectInputAction() {
    const sendButton = document.querySelector('#send_but');
    if (!sendButton) return;
    const legacyActions = document.querySelector('#verba-input-actions');
    const profileButton = document.querySelector('#verba-profile-toggle') || createProfileToggleButton();
    const button = document.querySelector('#verba-retranslate-latest') || createRetranslateButton();
    const targetParent = sendButton.parentElement;
    if (
        legacyActions
        || profileButton.parentElement !== targetParent
        || button.parentElement !== targetParent
    ) {
        sendButton.before(profileButton, button);
        legacyActions?.remove();
    }
    refreshProfileToggleButton();
    refreshRetranslateButton();
}

async function testConnection(button) {
    if (!settings.profileId) {
        notify('먼저 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }
    const profiles = configuredProfileCycle();
    const profileId = profiles.active;
    const profileSlot = profiles.slot;
    if (!profileId) {
        notify('테스트할 현재 연결 프로필이 없어요.', 'warning');
        return;
    }
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '테스트 중…';
    try {
        const source = '안녕하세요.';
        const expected = [{ id: 'seg_0000', type: 'user_input', text: source }];
        const targetGender = detectCharacterGender(currentCharacterReference()?.character);
        const prompt = buildInputPrompt(source, settings, targetGender);
        const response = await sendProfileRequest(prompt, {
            profileId,
            profileSlot,
            stage: 'connection-test',
        });
        const translated = String(parseSegmentResponse(extractResponseText(response), expected).get('seg_0000') || '').trim();
        if (!translated) throw new Error('테스트 응답이 비어 있습니다.');
        notify(`프로필 ${profileSlot} 연결 성공: ${translated}`, 'success');
    } catch (error) {
        if (!isAbort(error)) {
            reportError('connection-test', error, `프로필 ${profileSlot} “${profileDisplayName(profileId)}” 연결 실패: ${errorText(error)}`);
        }
    } finally {
        button.disabled = false;
        button.textContent = oldText;
    }
}

function renderNameLockManager() {
    const content = document.querySelector('#verba-name-lock-manager-content');
    if (!content) return;

    const groups = allCharacterNameLockGroups();
    content.innerHTML = `
        <div class="verba-help">모든 캐릭터 카드에 저장된 베르바 이름을 불러옵니다. 일반 단어나 문장은 표시하지 않아요.</div>
        <div class="verba-name-lock-list">
            ${groups.length ? groups.map((group, groupIndex) => `
                <section class="verba-name-lock-group" data-group-index="${groupIndex}">
                    <header class="verba-name-lock-group-header">
                        <b>${escapeHtml(group.characterName)}</b>
                        <small>카드 ${group.reference.characterId + 1} · ${group.rows.length}개</small>
                    </header>
                    ${group.rows.map((row, rowIndex) => `
                        <div class="verba-name-lock-row" data-row-index="${rowIndex}">
                            <div class="verba-name-lock-pair">
                                <b title="${escapeHtml(row.source)}">${escapeHtml(row.source)}</b>
                                <span aria-hidden="true">→</span>
                                <input type="text" class="text_pole verba-name-lock-edit" maxlength="120" value="${escapeHtml(row.target)}" aria-label="${escapeHtml(row.source)}의 고정 표기">
                            </div>
                            <div class="verba-name-lock-row-actions">
                                <button type="button" class="menu_button verba-name-lock-save">저장</button>
                                <button type="button" class="menu_button verba-name-lock-delete">삭제</button>
                            </div>
                        </div>`).join('')}
                </section>`).join('') : '<div class="verba-name-lock-empty">아직 어떤 캐릭터에도 고정한 이름이 없어요.</div>'}
        </div>
        <div class="verba-help">새 이름은 해당 캐릭터의 번역문에서 이름을 선택한 뒤 ‘이름으로 고정’으로 등록하세요. 현재 열린 캐릭터의 표기를 수정하면 현재 채팅의 기존 저장 번역도 함께 변경되며, 다른 캐릭터의 저장값은 카드에서만 수정됩니다.</div>`;

    content.querySelectorAll('.verba-name-lock-group').forEach(groupElement => {
        const group = groups[Number(groupElement.dataset.groupIndex)];
        if (!group) return;
        groupElement.querySelectorAll('.verba-name-lock-row').forEach(rowElement => {
            const row = group.rows[Number(rowElement.dataset.rowIndex)];
            if (!row) return;
            const input = rowElement.querySelector('.verba-name-lock-edit');
            const saveButton = rowElement.querySelector('.verba-name-lock-save');
            const deleteButton = rowElement.querySelector('.verba-name-lock-delete');

            const save = async () => {
                const targetName = String(input.value || '').trim();
                saveButton.disabled = true;
                deleteButton.disabled = true;
                try {
                    await saveCharacterNameLock(row.source, targetName, group.reference);
                    const activeReference = currentCharacterReference();
                    const isCurrentCharacter = activeReference?.character === group.reference.character;
                    const historyResult = isCurrentCharacter && targetName !== row.target
                        ? replaceNameAcrossChatTranslations([row.target], targetName)
                        : { changedRecords: 0 };
                    renderNameLockManager();
                    const historyNotice = historyResult.changedRecords
                        ? ` 현재 채팅의 저장 번역본 ${historyResult.changedRecords}개도 변경했어요.`
                        : '';
                    notify(`${group.characterName} · ${row.source}의 표기를 “${targetName}”로 수정했어요.${historyNotice}`, 'success');
                } catch (error) {
                    reportError('name-lock-edit', error, `이름 수정 실패: ${errorText(error)}`);
                } finally {
                    if (saveButton.isConnected) saveButton.disabled = false;
                    if (deleteButton.isConnected) deleteButton.disabled = false;
                }
            };
            saveButton.addEventListener('click', save);
            input.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                save();
            });
            deleteButton.addEventListener('click', async () => {
                if (!globalThis.confirm?.(`${group.characterName}의 “${row.source} → ${row.target}” 이름 고정을 삭제할까요?`)) return;
                saveButton.disabled = true;
                deleteButton.disabled = true;
                try {
                    await deleteCharacterNameLock(row.source, group.reference);
                    renderNameLockManager();
                    notify(`${group.characterName} · ${row.source}의 이름 고정을 삭제했어요.`, 'success');
                } catch (error) {
                    reportError('name-lock-delete', error, `이름 삭제 실패: ${errorText(error)}`);
                } finally {
                    if (saveButton.isConnected) saveButton.disabled = false;
                    if (deleteButton.isConnected) deleteButton.disabled = false;
                }
            });
        });
    });
}


function developerSettingsMarkup() {
    return `
        <details id="verba-developer-settings" class="verba-tool-details verba-developer-settings" open>
            <summary>개발자 모드 <small>${settings.developerMode ? '품질 검수 실험실' : '번호 입력'}</small></summary>
            <div class="verba-tool-details-content">
                ${settings.developerMode ? `
                    <div class="verba-developer-enabled-note">개발자 모드가 활성화되어 있어요.</div>

                    <details id="verba-developer-lab" class="verba-tool-details verba-developer-lab" open>
                        <summary>🧪 번역 품질 검수 실험실 <small>개발자</small></summary>
                        <div class="verba-tool-details-content">
                            <label class="verba-check-row">
                                <input type="checkbox" id="verba-quality-audit-enabled" ${settings.qualityAuditEnabled ? 'checked' : ''}>
                                <span>품질 검수 사용</span>
                            </label>
                            <div class="verba-help">기존 번역 프롬프트와 전체 문맥은 그대로 둡니다. 로컬에서 이상 징후가 있을 때만 AI 통합 검수 1회를 실행하고, 명확한 문제가 있는 후보 구간만 교정합니다.</div>

                            <div id="verba-quality-audit-controls" class="${settings.qualityAuditEnabled ? '' : 'verba-control-disabled'}">
                                <label class="verba-check-row"><input type="checkbox" id="verba-quality-audit-meaning" ${settings.qualityAuditMeaning !== false ? 'checked' : ''}><span>의미 보존 검사</span></label>
                                <label class="verba-check-row"><input type="checkbox" id="verba-quality-audit-referent" ${settings.qualityAuditReferent !== false ? 'checked' : ''}><span>대명사·지칭 대상 검사</span></label>
                                <label class="verba-check-row"><input type="checkbox" id="verba-quality-audit-voice" ${settings.qualityAuditVoice !== false ? 'checked' : ''}><span>캐릭터 말투 유지 검사</span></label>
                                <label class="verba-check-row"><input type="checkbox" id="verba-quality-audit-translationese" ${settings.qualityAuditTranslationese !== false ? 'checked' : ''}><span>번역투 검사</span></label>
                                <label class="verba-check-row"><input type="checkbox" id="verba-quality-audit-continuity" ${settings.qualityAuditContinuity !== false ? 'checked' : ''}><span>문맥 모순 검사</span></label>
                            </div>

                            <div class="verba-quality-audit-status-row">
                                <span>최근 검수</span>
                                <b id="verba-quality-audit-status">${escapeHtml(lastQualityAuditSummary)}</b>
                            </div>
                            <div class="verba-help">정상 번역이면 추가 API 호출은 없습니다. 의심 구간이 감지돼도 검수 AI가 문제가 없다고 판단하면 원래 번역을 그대로 유지합니다.</div>
                        </div>
                    </details>

                    

                    

                    <button type="button" id="verba-developer-mode-off" class="menu_button verba-wide">개발자 모드 끄기</button>
                ` : `
                    <label for="verba-developer-code">개발자 번호</label>
                    <div class="verba-developer-code-row">
                        <input id="verba-developer-code" class="text_pole" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="번호 입력">
                        <button type="button" id="verba-developer-mode-on" class="menu_button">활성화</button>
                    </div>
                    <div class="verba-help">개발자 번호를 입력한 뒤 활성화를 눌러 주세요.</div>
                `}
            </div>
        </details>`;
}

function syncDeveloperQualityControls(root = document.querySelector('#verba-settings')) {
    const qualityMaster = root?.querySelector('#verba-quality-audit-enabled');
    const qualityControls = root?.querySelector('#verba-quality-audit-controls');
    if (qualityControls) {
        const enabled = Boolean(qualityMaster?.checked);
        qualityControls.classList.toggle('verba-control-disabled', !enabled);
        qualityControls.querySelectorAll('input').forEach(input => {
            input.disabled = !enabled;
        });
    }

    const flavorMaster = root?.querySelector('#verba-korean-flavor-enabled');
    const flavorControls = root?.querySelector('#verba-korean-flavor-controls');
    if (flavorControls) {
        const flavorEnabled = Boolean(flavorMaster?.checked);
        flavorControls.classList.toggle('verba-control-disabled', !flavorEnabled);
        flavorControls.querySelectorAll('input, select').forEach(control => {
            control.disabled = !flavorEnabled;
        });
    }

    const englishFlavorMaster = root?.querySelector('#verba-english-flavor-enabled');
    const englishFlavorControls = root?.querySelector('#verba-english-flavor-controls');
    if (englishFlavorControls) {
        const englishFlavorEnabled = Boolean(englishFlavorMaster?.checked);
        englishFlavorControls.classList.toggle('verba-control-disabled', !englishFlavorEnabled);
        englishFlavorControls.querySelectorAll('input, select').forEach(control => {
            control.disabled = !englishFlavorEnabled;
        });
    }
}

function refreshSettingsPanelForDeveloperMode() {
    const panel = document.querySelector('#verba-settings');
    const current = panel?.querySelector('#verba-developer-settings');
    if (!panel || !current) return;

    const holder = document.createElement('div');
    holder.innerHTML = developerSettingsMarkup().trim();
    const replacement = holder.firstElementChild;
    if (!replacement) return;

    current.replaceWith(replacement);
    syncDeveloperQualityControls(panel);
    renderQualityAuditStatus();
}

function enabledQualityAuditChecks() {
    const checks = [];
    if (settings.qualityAuditMeaning !== false) checks.push('meaning');
    if (settings.qualityAuditReferent !== false) checks.push('referent');
    if (settings.qualityAuditVoice !== false) checks.push('voice');
    if (settings.qualityAuditTranslationese !== false) checks.push('translationese');
    if (settings.qualityAuditContinuity !== false) checks.push('continuity');
    return checks;
}

function renderQualityAuditStatus() {
    const target = document.querySelector('#verba-quality-audit-status');
    if (target) target.textContent = lastQualityAuditSummary;
}

function injectSettingsPanel() {
    const existingPanels = [...document.querySelectorAll('#verba-settings, .verba-settings')];
    if (existingPanels.length) {
        const keep = existingPanels[0];
        existingPanels.slice(1).forEach(panel => panel.remove());
        return keep;
    }

    const host = document.querySelector('#extensions_settings');
    if (!host) return;
    const panel = document.createElement('div');
    panel.id = 'verba-settings';
    panel.className = 'extension_container verba-settings';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header verba-drawer-header">
                <div><b>베르바</b> <small>v${EXTENSION_VERSION}</small></div>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="display: none;">
                <div class="verba-note">AI 아웃풋은 항상 한국어로 자동 번역하며, 한국어 중심 출력은 API를 호출하지 않아요.</div>

                <label for="verba-profile">연결 프로필 A</label>
                <div class="verba-profile-row">
                    <select id="verba-profile" class="text_pole"></select>
                    <button type="button" id="verba-refresh-profiles" class="menu_button">새로고침</button>
                </div>

                <label for="verba-fallback-profile">연결 프로필 B <small>(선택)</small></label>
                <select id="verba-fallback-profile" class="text_pole"></select>

                <label for="verba-third-profile">연결 프로필 C <small>(선택)</small></label>
                <select id="verba-third-profile" class="text_pole"></select>
                <button type="button" id="verba-test-profile" class="menu_button verba-wide">현재 프로필 연결 테스트</button>
                <div class="verba-help">입력창 옆 ⇄ᴬ/⇄ᴮ/⇄ᶜ 버튼으로 설정된 프로필을 순서대로 직접 바꿀 수 있어요.</div>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-auto-profile-fallback" ${settings.autoProfileFallback !== false ? 'checked' : ''}>
                    <span>번역 실패 시 다른 프로필 자동 사용</span>
                </label>
                <div class="verba-help">켜면 현재 프로필에 일시적 서버·네트워크·속도 제한 오류가 생겼을 때 나머지 프로필을 순서대로 임시 사용해요. 끄면 현재 선택한 프로필만 자동 재시도하고 B/C로 넘어가지 않습니다.</div>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-auto-input" ${settings.autoInput ? 'checked' : ''}>
                    <span>전송 시 인풋 자동번역 <small>(한국어 → 영어)</small></span>
                </label>
                <div class="verba-help">켜면 한국어 인풋을 영어로 바꾼 뒤 전송해요. 캐릭터 카드에 명시된 성별·대명사는 로컬에서 성별값만 확인하며, 카드 원문은 번역 AI에 보내지 않습니다. 실패하면 원문을 보내지 않고 생성을 중단합니다.</div>

                <details id="verba-profile-stats" class="verba-tool-details">
                    <summary>프로필 성능 기록 <small>로컬 통계</small></summary>
                    <div class="verba-tool-details-content">
                        <div id="verba-profile-stats-content" class="verba-profile-stats-content"></div>
                        <div class="verba-help">평균은 아웃풋 번역 시작부터 화면 적용 또는 실패 종료까지의 전체 시간이며, 나머지는 프로필 내부 요청 기록이에요.</div>
                        <button type="button" id="verba-reset-profile-stats" class="menu_button verba-wide">성능 기록 초기화</button>
                    </div>
                </details>

                <details id="verba-name-lock-manager" class="verba-name-lock-manager">
                    <summary>이름 고정 관리 <small>캐릭터별 저장</small></summary>
                    <div id="verba-name-lock-manager-content" class="verba-name-lock-manager-content"></div>
                </details>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-selection-candidates" ${settings.selectionCandidates ? 'checked' : ''}>
                    <span>선택 재번역 후보 3개 미리보기</span>
                </label>
                <div class="verba-help">선택 재번역 결과를 바로 적용하지 않고, 의미는 같지만 표현이 조금씩 다른 후보 중 하나를 고를 수 있어요.</div>


                <details id="verba-selection-menu-settings" class="verba-tool-details">
                    <summary>드래그 메뉴 구성 <small>버튼 수·기능 선택</small></summary>
                    <div class="verba-tool-details-content">
                        <label for="verba-selection-quick-count">바로 표시할 버튼 수</label>
                        <select id="verba-selection-quick-count" class="text_pole">
                            ${[2, 3, 4, 5].map(count => `
                                <option value="${count}" ${settings.selectionQuickCount === count ? 'selected' : ''}>${count}개</option>
                            `).join('')}
                        </select>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-show-selection-name" ${settings.showSelectionName !== false ? 'checked' : ''}>
                            <span>이름으로 고정 메뉴에 포함</span>
                        </label>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-show-selection-source" ${settings.showSelectionSource !== false ? 'checked' : ''}>
                            <span>원문 보기 메뉴에 포함</span>
                        </label>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-show-selection-lock" ${settings.showSelectionLock !== false ? 'checked' : ''}>
                            <span>구간 잠금 메뉴에 포함</span>
                        </label>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-show-selection-bundle" ${settings.showSelectionBundle !== false ? 'checked' : ''}>
                            <span>묶음 추가 메뉴에 포함</span>
                        </label>
                        <div class="verba-help">선택 부분 재번역을 포함해 지정한 개수까지만 바로 표시하고, 남은 기능은 ⋯을 누르면 세로로 열려요. 5개를 선택하면 모두 한 줄에 표시할 수 있습니다.</div>
                    </div>
                </details>



                <details id="verba-current-rules" class="verba-tool-details verba-current-rules">
                    <summary>현재 적용 규칙 <small>API 호출 없음</small></summary>
                    <div class="verba-tool-details-content">
                        <div id="verba-current-rules-content"></div>
                    </div>
                </details>

                <details id="verba-prompt-presets" class="verba-tool-details verba-prompt-presets">
                    <summary>프롬프트 프리셋 <small id="verba-prompt-preset-count">${normalizedPromptPresets().length}개 저장</small></summary>
                    <div class="verba-tool-details-content">
                        <div class="verba-help">아래 4개 프롬프트의 내용과 각 슬롯 ON/OFF 상태를 한 세트로 저장합니다. 프리셋을 선택하면 즉시 현재 프롬프트로 적용됩니다. 이름 고정·금지어·현지화·말맛·기타 설정은 저장하거나 바꾸지 않습니다.</div>

                        <select id="verba-prompt-preset-select" class="text_pole">
                            ${promptPresetSelectMarkup()}
                        </select>

                        <label for="verba-prompt-preset-name">프리셋 이름</label>
                        <input id="verba-prompt-preset-name" class="text_pole" type="text" maxlength="60" autocomplete="off" placeholder="예: 한국캐 기본 말투">

                        <div class="verba-prompt-preset-actions">
                            <button type="button" id="verba-prompt-preset-save" class="menu_button">새로 저장</button>
                            <button type="button" id="verba-prompt-preset-duplicate" class="menu_button" disabled>복제</button>
                            <button type="button" id="verba-prompt-preset-favorite" class="menu_button" disabled>☆ 즐겨찾기</button>
                            <button type="button" id="verba-prompt-preset-rename" class="menu_button" disabled>이름 변경</button>
                            <button type="button" id="verba-prompt-preset-delete" class="menu_button" disabled>삭제</button>
                        </div>

                        <div class="verba-prompt-preset-fields">
                            <small>저장 대상</small>
                            <span>전체 번역 전역 · 모든 대사 공통 · 캐릭터 대사 전용 · NPC·USER 대사 전용 + 각 슬롯 ON/OFF</span>
                        </div>

                        <details id="verba-prompt-preset-backups" class="verba-prompt-preset-backups">
                            <summary>최근 프롬프트 백업 <small id="verba-prompt-preset-backup-count">${normalizedPromptPresetBackups(settings.promptPresetBackups).length}/5</small></summary>
                            <div class="verba-prompt-preset-backup-content">
                                <div class="verba-help">4개 프롬프트를 수정한 뒤 10분 동안 추가 입력이 없으면 현재 내용과 슬롯 ON/OFF 상태를 자동으로 백업해요. 최근 5개만 보관하며, 복원하면 현재 4개 프롬프트가 해당 상태로 돌아갑니다.</div>
                                <button type="button" id="verba-prompt-preset-backup-now" class="menu_button verba-wide">지금 백업</button>
                                <div id="verba-prompt-preset-backup-list" class="verba-prompt-preset-backup-list"></div>
                            </div>
                        </details>
                    </div>
                </details>

                <div class="verba-prompt-slot ${settings.globalPromptEnabled !== false ? '' : 'verba-prompt-slot-off'}" data-verba-prompt-slot="global">
                    <div class="verba-prompt-slot-head">
                        <label for="verba-global-prompt">전체 번역 전역 프롬프트</label>
                        <label class="verba-prompt-slot-toggle">
                            <input type="checkbox" id="verba-global-prompt-enabled" ${settings.globalPromptEnabled !== false ? 'checked' : ''}>
                            <span>${settings.globalPromptEnabled !== false ? 'ON' : 'OFF'}</span>
                        </label>
                    </div>
                    <textarea id="verba-global-prompt" class="text_pole" rows="5" placeholder="서술과 대사 모두에 적용할 문체·호칭·표현 규칙">${escapeHtml(settings.globalPrompt)}</textarea>
                </div>

                <div class="verba-prompt-slot ${settings.allDialoguePromptEnabled !== false ? '' : 'verba-prompt-slot-off'}" data-verba-prompt-slot="all-dialogue">
                    <div class="verba-prompt-slot-head">
                        <label for="verba-all-dialogue-prompt">모든 대사 공통 프롬프트</label>
                        <label class="verba-prompt-slot-toggle">
                            <input type="checkbox" id="verba-all-dialogue-prompt-enabled" ${settings.allDialoguePromptEnabled !== false ? 'checked' : ''}>
                            <span>${settings.allDialoguePromptEnabled !== false ? 'ON' : 'OFF'}</span>
                        </label>
                    </div>
                    <textarea id="verba-all-dialogue-prompt" class="text_pole" rows="5" placeholder="모든 직접 대사에 공통 적용할 형식 규칙">${escapeHtml(settings.allDialoguePrompt)}</textarea>
                    <div class="verba-help">캐릭터·NPC·USER의 모든 직접 대사에 항상 적용해요. 대사 한영병기, 따옴표 형식처럼 화자와 무관한 공통 규칙은 여기에 입력하세요.</div>
                </div>

                <div class="verba-prompt-slot ${settings.dialoguePromptEnabled !== false ? '' : 'verba-prompt-slot-off'}" data-verba-prompt-slot="dialogue">
                    <div class="verba-prompt-slot-head">
                        <label for="verba-dialogue-prompt">캐릭터 대사 전용 프롬프트</label>
                        <label class="verba-prompt-slot-toggle">
                            <input type="checkbox" id="verba-dialogue-prompt-enabled" ${settings.dialoguePromptEnabled !== false ? 'checked' : ''}>
                            <span>${settings.dialoguePromptEnabled !== false ? 'ON' : 'OFF'}</span>
                        </label>
                    </div>
                    <textarea id="verba-dialogue-prompt" class="text_pole" rows="5" placeholder="현재 캐릭터가 말한 대사에만 적용할 말투 규칙">${escapeHtml(settings.dialoguePrompt)}</textarea>
                    <div class="verba-help">아웃풋 전체 문맥에서 화자를 판단해 현재 캐릭터의 직접 대사에만 추가 적용해요. 캐릭터 고유 말투는 여기에 입력하세요.</div>
                </div>

                <div class="verba-prompt-slot ${settings.otherDialoguePromptEnabled !== false ? '' : 'verba-prompt-slot-off'}" data-verba-prompt-slot="other-dialogue">
                    <div class="verba-prompt-slot-head">
                        <label for="verba-other-dialogue-prompt">NPC·USER 대사 전용 프롬프트</label>
                        <label class="verba-prompt-slot-toggle">
                            <input type="checkbox" id="verba-other-dialogue-prompt-enabled" ${settings.otherDialoguePromptEnabled !== false ? 'checked' : ''}>
                            <span>${settings.otherDialoguePromptEnabled !== false ? 'ON' : 'OFF'}</span>
                        </label>
                    </div>
                    <textarea id="verba-other-dialogue-prompt" class="text_pole" rows="5" placeholder="NPC·USER·기타 화자 대사에만 적용할 말투 규칙">${escapeHtml(settings.otherDialoguePrompt)}</textarea>
                    <div class="verba-help">현재 캐릭터가 아닌 NPC·USER·기타 화자의 직접 대사에만 추가 적용해요. 캐릭터와 다른 말투를 주고 싶을 때 사용하세요.</div>
                </div>

                <label for="verba-banned-words">번역 금지어</label>
                <textarea id="verba-banned-words" class="text_pole" rows="4" placeholder="한 줄에 하나씩 입력">${escapeHtml(settings.bannedWords)}</textarea>
                <div class="verba-help">금지어가 나오면 해당 문단만 다시 요청하고 정상 문단은 유지해요.</div>


                <details id="verba-rule-priority-settings" class="verba-tool-details">
                    <summary>번역 규칙 우선순위 <small>위·아래로 정렬</small></summary>
                    <div class="verba-tool-details-content">
                        <div id="verba-rule-priority-list" class="verba-rule-priority-list"></div>
                        <div class="verba-help">위에 있는 규칙이 서로 충돌할 때 먼저 적용됩니다. 원문 정확성·보호 요소·금지어 규칙은 이 순서와 관계없이 항상 최우선이에요.</div>
                        <button type="button" id="verba-reset-rule-priority" class="menu_button verba-wide">기본 순서로 되돌리기</button>
                    </div>
                </details>

                <details id="verba-prompt-conflict-settings" class="verba-tool-details">
                    <summary>프롬프트 충돌 확인 <small id="verba-prompt-conflict-count">충돌 없음</small></summary>
                    <div class="verba-tool-details-content">
                        <div id="verba-prompt-conflict-content" class="verba-prompt-conflict-content"></div>
                        <div class="verba-help">전역·모든 대사 공통·캐릭터 전용·NPC·USER 전용 프롬프트에서 베르바가 명백한 충돌로 판단한 실제 문구를 보여줘요. 검사는 로컬에서만 하며 API를 호출하지 않습니다.</div>
                        <button type="button" id="verba-refresh-prompt-conflicts" class="menu_button verba-wide">지금 다시 확인</button>
                    </div>
                </details>

                <details id="verba-translation-tuning" class="verba-tool-details">
                    <summary>번역 미세 조정 <small>관계 온도·현지화</small></summary>
                    <div class="verba-tool-details-content">
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-relation-temperature-enabled" ${settings.relationTemperatureEnabled !== false ? 'checked' : ''}>
                            <span>관계 온도·현지화 적용</span>
                        </label>
                        <div id="verba-fine-tuning-controls" class="verba-tuning-control-group ${settings.relationTemperatureEnabled !== false ? '' : 'verba-control-disabled'}">
                            <span class="verba-tuning-label">관계 온도</span>
                            ${tuningChoiceMarkup('verba-relation-temperature', RELATION_TEMPERATURE_OPTIONS, settings.relationTemperature)}
                            <div class="verba-help">대사의 어미·호칭·언어적 거리만 조절하며 원문에 없는 감정이나 관계는 만들지 않아요.</div>
                            <span class="verba-tuning-label">서술 현지화</span>
                            ${tuningChoiceMarkup('verba-narration-localization-level', LOCALIZATION_LEVEL_OPTIONS, settings.narrationLocalizationLevel)}
                            <div class="verba-help">원문 유지 → 약한 현지화 → 균형 → 자연스러운 한국어 → 네이티브 한국어 순으로 번역투를 줄이고 한국어식 문장 호흡과 어순을 강화해요.</div>
                            <span class="verba-tuning-label">대사 현지화</span>
                            ${tuningChoiceMarkup('verba-dialogue-localization-level', LOCALIZATION_LEVEL_OPTIONS, settings.dialogueLocalizationLevel)}
                            <div class="verba-help">단계가 높을수록 직역투를 줄이고 실제 한국어 화자처럼 어미·생략·호흡·구어 표현을 자연스럽게 다듬어요. 인명·지명·수치·사실관계는 두 설정 모두 그대로 보존합니다.</div>
                        </div>
                    </div>
                </details>

                <details id="verba-dialogue-ending-settings" class="verba-tool-details">
                    <summary>대사 말끝 취향 <small>선호·회피 표현</small></summary>
                    <div class="verba-tool-details-content">
                        <label for="verba-dialogue-ending-preferred">선호하는 말끝·표현</label>
                        <textarea id="verba-dialogue-ending-preferred" class="text_pole" rows="4" placeholder="한 줄에 하나씩 입력&#10;예: ~잖아&#10;~거든&#10;~지">${escapeHtml(settings.dialogueEndingPreferred)}</textarea>
                        <div class="verba-help">가능한 문맥에서 자연스럽게 우선 사용해요. 적어둔 표현을 모든 문장에 억지로 붙이지 않습니다.</div>

                        <label for="verba-dialogue-ending-avoid">피하고 싶은 말끝·표현</label>
                        <textarea id="verba-dialogue-ending-avoid" class="text_pole" rows="4" placeholder="한 줄에 하나씩 입력&#10;예: ~구나&#10;~군">${escapeHtml(settings.dialogueEndingAvoid)}</textarea>
                        <div class="verba-help">금지어처럼 절대 차단하지 않고, 같은 의미를 자연스럽게 표현할 수 있으면 다른 말끝을 우선해요.</div>

                        <label for="verba-dialogue-ending-strength">적용 강도</label>
                        <select id="verba-dialogue-ending-strength" class="text_pole">
                            <option value="light" ${settings.dialogueEndingStrength === 'light' ? 'selected' : ''}>약하게</option>
                            <option value="normal" ${settings.dialogueEndingStrength === 'normal' ? 'selected' : ''}>보통</option>
                            <option value="strong" ${settings.dialogueEndingStrength === 'strong' ? 'selected' : ''}>강하게</option>
                        </select>
                        <div class="verba-help">현재 캐릭터의 직접 대사에만 적용됩니다. NPC·USER 대사와 서술에는 적용하지 않아요. 의미·존댓말/반말·감정 강도·캐릭터성은 유지합니다.</div>

                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-dialogue-ending-repetition-reduction" ${settings.dialogueEndingRepetitionReduction !== false ? 'checked' : ''}>
                            <span>말끝 반복 줄이기</span>
                        </label>
                        <div class="verba-help">현재 캐릭터 대사 안에서 같은 말끝이 몰리지 않도록 지시하고, 최근 캐릭터 대사 번역에서 반복된 말끝이 있으면 다음 번역에서 의존도를 낮춰요. NPC·USER 대사는 분석·적용 대상에서 제외하며 후처리 치환은 하지 않습니다.</div>
                    </div>
                </details>

                <details id="verba-expression-detail" class="verba-tool-details verba-expression-detail">
                    <summary>표현 디테일 <small>강조·말끊김·비유</small></summary>
                    <div class="verba-tool-details-content">
                        <div class="verba-help">영어 아웃풋을 한국어로 옮길 때 원문에 이미 있는 강조 방식·말더듬·늘임·끊김·관용구·비유의 결을 어떻게 처리할지 정합니다. 아웃풋 E→K에만 적용되며 기본값은 모두 추가 지시 없음입니다.</div>

                        <label for="verba-expression-emphasis">강조 표현의 맛</label>
                        <select id="verba-expression-emphasis" class="text_pole">
                            <option value="default" ${settings.expressionEmphasisTaste === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                            <option value="source" ${settings.expressionEmphasisTaste === 'source' ? 'selected' : ''}>원문대로</option>
                            <option value="natural" ${settings.expressionEmphasisTaste === 'natural' ? 'selected' : ''}>자연스럽게</option>
                            <option value="active" ${settings.expressionEmphasisTaste === 'active' ? 'selected' : ''}>적극적으로</option>
                        </select>
                        <div class="verba-help">ALL CAPS, italics·bold, !!!, ?!, 반복 글자, 짧게 끊어 강조하는 리듬처럼 원문에 이미 있는 강세를 얼마나 또렷하게 살릴지 조절합니다. 원문에 없는 강조는 새로 만들지 않습니다.</div>

                        <label for="verba-expression-disfluency">말더듬·늘임·끊김 보존</label>
                        <select id="verba-expression-disfluency" class="text_pole">
                            <option value="default" ${settings.expressionDisfluencyTaste === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                            <option value="clean" ${settings.expressionDisfluencyTaste === 'clean' ? 'selected' : ''}>정리해서 번역</option>
                            <option value="natural" ${settings.expressionDisfluencyTaste === 'natural' ? 'selected' : ''}>자연스럽게 보존</option>
                            <option value="active" ${settings.expressionDisfluencyTaste === 'active' ? 'selected' : ''}>적극 보존</option>
                        </select>
                        <div class="verba-help">"I-I didn't…", "Nooo…", "Wait—what?" 같은 직접 대사의 말더듬·늘임·중간 끊김을 한국어에서 얼마나 남길지 정합니다. 원문에 없는 말더듬이나 끊김은 추가하지 않습니다.</div>

                        <label for="verba-expression-idiom">관용구·비유 처리 취향</label>
                        <select id="verba-expression-idiom" class="text_pole">
                            <option value="default" ${settings.expressionIdiomMetaphorTaste === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                            <option value="meaning" ${settings.expressionIdiomMetaphorTaste === 'meaning' ? 'selected' : ''}>뜻 중심</option>
                            <option value="balanced" ${settings.expressionIdiomMetaphorTaste === 'balanced' ? 'selected' : ''}>균형</option>
                            <option value="koreanized" ${settings.expressionIdiomMetaphorTaste === 'koreanized' ? 'selected' : ''}>한국식 네이티브화</option>
                            <option value="sourceCulture" ${settings.expressionIdiomMetaphorTaste === 'sourceCulture' ? 'selected' : ''}>원문화·비유 결 보존</option>
                        </select>
                        <div class="verba-help">영어 관용구·비유의 실제 뜻과 원래 이미지·문화적 결 사이에서 어느 쪽을 더 우선할지 정합니다. 한국식 네이티브화는 상황에 맞는 한국 속담·관용구·익숙한 비유가 있으면 적극적으로 치환하고, 딱 맞는 대응이 없을 때만 뜻 중심으로 자연스럽게 풉니다.</div>
                    </div>
                </details>


                <details id="verba-korean-flavor" class="verba-tool-details verba-korean-flavor">
                        <summary>🍚 한캐의 맛 <small>한국어 말맛 커스텀</small></summary>
                        <div class="verba-tool-details-content">
                            <label class="verba-check-row">
                                <input type="checkbox" id="verba-korean-flavor-enabled" ${settings.koreanFlavorEnabled ? 'checked' : ''}>
                                <span>한캐의 맛 사용</span>
                            </label>
                            <div class="verba-help">영어로 생성된 한국인 캐릭터의 아웃풋을 한국어로 번역할 때, 마치 처음부터 자연스러운 한국어로 출력된 것처럼 말맛을 복원합니다. 대사 호흡·주어 생략·욕설·감탄사·인터넷 말투 등을 한국인 캐릭터답게 조절합니다. 아웃풋 E→K에만 적용되며 인풋에는 적용되지 않습니다.</div>

                            <div id="verba-korean-flavor-controls" class="${settings.koreanFlavorEnabled ? '' : 'verba-control-disabled'}">
                                <label for="verba-korean-flavor-rhythm">대사 호흡 취향</label>
                                <select id="verba-korean-flavor-rhythm" class="text_pole">
                                    <option value="default" ${settings.koreanFlavorDialogueRhythm === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="short" ${settings.koreanFlavorDialogueRhythm === 'short' ? 'selected' : ''}>짧고 툭툭</option>
                                    <option value="balanced" ${settings.koreanFlavorDialogueRhythm === 'balanced' ? 'selected' : ''}>자연스러운 보통</option>
                                    <option value="smooth" ${settings.koreanFlavorDialogueRhythm === 'smooth' ? 'selected' : ''}>길고 매끄럽게</option>
                                </select>
                                <div class="verba-help">직접 대사의 문장 끊기와 이어짐만 조절하며 의미·강조·말투는 바꾸지 않습니다.</div>

                                <label for="verba-korean-flavor-pronoun">주어·대명사 생략 취향</label>
                                <select id="verba-korean-flavor-pronoun" class="text_pole">
                                    <option value="default" ${settings.koreanFlavorPronounOmission === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="preserve" ${settings.koreanFlavorPronounOmission === 'preserve' ? 'selected' : ''}>원문 지칭을 비교적 유지</option>
                                    <option value="natural" ${settings.koreanFlavorPronounOmission === 'natural' ? 'selected' : ''}>자연스러우면 생략</option>
                                    <option value="active" ${settings.koreanFlavorPronounOmission === 'active' ? 'selected' : ''}>한국어답게 적극 생략</option>
                                </select>
                                <div class="verba-help">지칭 대상이 헷갈리지 않는 범위에서만 생략하며, 누가 누구를 가리키는지는 절대 바꾸지 않습니다.</div>

                                <label for="verba-korean-flavor-profanity">욕설·거친 표현의 번역 결</label>
                                <select id="verba-korean-flavor-profanity" class="text_pole">
                                    <option value="default" ${settings.koreanFlavorProfanityTone === 'default' ? 'selected' : ''}>기본 · 원문 결 유지</option>
                                    <option value="dry" ${settings.koreanFlavorProfanityTone === 'dry' ? 'selected' : ''}>건조하게</option>
                                    <option value="blunt" ${settings.koreanFlavorProfanityTone === 'blunt' ? 'selected' : ''}>직설적·거칠게</option>
                                    <option value="lowSlang" ${settings.koreanFlavorProfanityTone === 'lowSlang' ? 'selected' : ''}>인터넷식 표현 적게</option>
                                    <option value="restrained" ${settings.koreanFlavorProfanityTone === 'restrained' ? 'selected' : ''}>비속어는 최소화</option>
                                </select>
                                <div class="verba-help">원문의 욕설 강도와 공격성은 그대로 보존하고, 같은 강도 안에서 한국어 표현의 결만 조절합니다.</div>

                                <label for="verba-korean-flavor-interjection">감탄사·추임새 취향</label>
                                <select id="verba-korean-flavor-interjection" class="text_pole">
                                    <option value="default" ${settings.koreanFlavorInterjectionTone === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="natural" ${settings.koreanFlavorInterjectionTone === 'natural' ? 'selected' : ''}>자연스러운 한국식 반응</option>
                                    <option value="restrained" ${settings.koreanFlavorInterjectionTone === 'restrained' ? 'selected' : ''}>담백하게</option>
                                    <option value="lively" ${settings.koreanFlavorInterjectionTone === 'lively' ? 'selected' : ''}>생동감 있게</option>
                                </select>
                                <div class="verba-help">원문에 실제 감탄사·추임새가 있을 때만 표현 방식을 조절하며 새 감탄사를 임의로 추가하지 않습니다.</div>

                                <label for="verba-korean-flavor-meme">인터넷 밈 농도</label>
                                <select id="verba-korean-flavor-meme" class="text_pole">
                                    <option value="default" ${settings.koreanFlavorMemeDensity === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="light" ${settings.koreanFlavorMemeDensity === 'light' ? 'selected' : ''}>살짝</option>
                                    <option value="natural" ${settings.koreanFlavorMemeDensity === 'natural' ? 'selected' : ''}>자연스럽게</option>
                                    <option value="active" ${settings.koreanFlavorMemeDensity === 'active' ? 'selected' : ''}>적극적으로</option>
                                </select>
                                <div class="verba-help">문맥과 캐릭터 말투에 맞을 때만 한국 인터넷식 밈·짤방체·온라인 구어 감각을 섞습니다. 원문에 없는 사건·감정·관계·농담을 새로 만들지는 않습니다.</div>

                                <label class="verba-check-row">
                                    <input type="checkbox" id="verba-korean-flavor-referent-repeat" ${settings.koreanFlavorReduceReferentRepetition ? 'checked' : ''}>
                                    <span>반복 지칭 줄이기</span>
                                </label>
                                <div class="verba-help">같은 문단·대사에서 이름·그는·그녀는 같은 지칭이 과하게 반복되면, 대상이 명확할 때만 생략하거나 문장을 자연스럽게 재구성합니다.</div>
                            </div>
                        </div>
                    </details>

                <details id="verba-english-flavor" class="verba-tool-details verba-english-flavor">
                        <summary>🗽 영캐의 맛 <small>영어권 캐릭터 말맛</small></summary>
                        <div class="verba-tool-details-content">
                            <label class="verba-check-row">
                                <input type="checkbox" id="verba-english-flavor-enabled" ${settings.englishFlavorEnabled ? 'checked' : ''}>
                                <span>영캐의 맛 사용</span>
                            </label>
                            <div class="verba-help">영어권 캐릭터의 영어 아웃풋을 한국어로 번역할 때, 한국어는 자연스럽게 유지하면서 영어권 특유의 대사 호흡·슬랭·욕설·감탄사·인터넷 문화를 어느 정도까지 살릴지 단계별로 조절합니다. 약한 단계는 한국어 자연화를 더 우선하고, 강한 단계일수록 영어권 캐릭터의 문화적 말맛을 더 선명하게 보존합니다. 아웃풋 E→K에만 적용되며 인풋에는 적용되지 않습니다.</div>

                            <div id="verba-english-flavor-controls" class="${settings.englishFlavorEnabled ? '' : 'verba-control-disabled'}">
                                <label for="verba-english-flavor-rhythm">대사 호흡 취향</label>
                                <select id="verba-english-flavor-rhythm" class="text_pole">
                                    <option value="default" ${settings.englishFlavorDialogueRhythm === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="short" ${settings.englishFlavorDialogueRhythm === 'short' ? 'selected' : ''}>짧고 툭툭</option>
                                    <option value="balanced" ${settings.englishFlavorDialogueRhythm === 'balanced' ? 'selected' : ''}>자연스러운 보통</option>
                                    <option value="smooth" ${settings.englishFlavorDialogueRhythm === 'smooth' ? 'selected' : ''}>길고 매끄럽게</option>
                                </select>
                                <div class="verba-help">영어 원문의 대사 호흡을 한국어에서 얼마나 또렷하게 살릴지 조절합니다. 한국어 문장은 자연스럽게 만들되, 영어권 캐릭터 특유의 끊김·이어짐·강조 리듬을 필요 이상으로 한국식으로 평준화하지 않습니다.</div>

                                <label for="verba-english-flavor-conversation">영어권 회화 자연화</label>
                                <select id="verba-english-flavor-conversation" class="text_pole">
                                    <option value="default" ${settings.englishFlavorConversationNaturalization === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="natural" ${settings.englishFlavorConversationNaturalization === 'natural' ? 'selected' : ''}>자연스럽게</option>
                                    <option value="active" ${settings.englishFlavorConversationNaturalization === 'active' ? 'selected' : ''}>적극적으로</option>
                                </select>
                                <div class="verba-help">영어 원문을 먼저 실제 영어권 회화의 발화 의도와 관용 표현으로 이해한 뒤 한국어로 옮깁니다. 자연스럽게 번역하되 영어권 캐릭터의 직설성·농담 방식·반응 감각을 한국인 캐릭터 말투처럼 바꿔버리지 않습니다.</div>

                                <label for="verba-english-flavor-slang">슬랭·구어체 농도</label>
                                <select id="verba-english-flavor-slang" class="text_pole">
                                    <option value="default" ${settings.englishFlavorSlangDensity === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="low" ${settings.englishFlavorSlangDensity === 'low' ? 'selected' : ''}>적게</option>
                                    <option value="natural" ${settings.englishFlavorSlangDensity === 'natural' ? 'selected' : ''}>자연스럽게</option>
                                    <option value="active" ${settings.englishFlavorSlangDensity === 'active' ? 'selected' : ''}>적극적으로</option>
                                </select>
                                <div class="verba-help">영어 원문의 slang·colloquial register를 한국어 번역에서 얼마나 강하게 살릴지 정합니다. 적게는 자연스러운 한국어 표현을 더 우선하고, 자연스럽게는 의미와 영어권 말맛을 균형 있게 유지하며, 적극적으로는 영어권 슬랭의 사회적·문화적 결을 가장 강하게 보존합니다.</div>

                                <label for="verba-english-flavor-profanity">영어권 욕설·거친 표현의 결</label>
                                <select id="verba-english-flavor-profanity" class="text_pole">
                                    <option value="default" ${settings.englishFlavorProfanityTone === 'default' ? 'selected' : ''}>기본 · 원문 결 유지</option>
                                    <option value="dry" ${settings.englishFlavorProfanityTone === 'dry' ? 'selected' : ''}>건조하게</option>
                                    <option value="blunt" ${settings.englishFlavorProfanityTone === 'blunt' ? 'selected' : ''}>직설적·거칠게</option>
                                    <option value="everyday" ${settings.englishFlavorProfanityTone === 'everyday' ? 'selected' : ''}>일상적인 영어 욕설</option>
                                    <option value="lowSlang" ${settings.englishFlavorProfanityTone === 'lowSlang' ? 'selected' : ''}>인터넷·밈식 표현 적게</option>
                                    <option value="restrained" ${settings.englishFlavorProfanityTone === 'restrained' ? 'selected' : ''}>비속어는 최소화</option>
                                </select>
                                <div class="verba-help">영어 원문의 욕설 강도·공격성·대상은 고정하고, 한국어로 옮겨도 영어권 캐릭터 특유의 건조함·직설성·일상적인 욕설 결이 살아 있도록 조절합니다.</div>

                                <label for="verba-english-flavor-interjection">감탄사·추임새 취향</label>
                                <select id="verba-english-flavor-interjection" class="text_pole">
                                    <option value="default" ${settings.englishFlavorInterjectionTone === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="natural" ${settings.englishFlavorInterjectionTone === 'natural' ? 'selected' : ''}>자연스러운 영어권 반응</option>
                                    <option value="restrained" ${settings.englishFlavorInterjectionTone === 'restrained' ? 'selected' : ''}>담백하게</option>
                                    <option value="lively" ${settings.englishFlavorInterjectionTone === 'lively' ? 'selected' : ''}>생동감 있게</option>
                                </select>
                                <div class="verba-help">원문에 실제 영어권 감탄사·추임새가 있을 때만 그 반응의 문화적·캐릭터적 결을 살려 한국어로 옮깁니다. 새 감탄사나 감정은 임의로 추가하지 않습니다.</div>

                                <label for="verba-english-flavor-meme">인터넷 밈 농도</label>
                                <select id="verba-english-flavor-meme" class="text_pole">
                                    <option value="default" ${settings.englishFlavorMemeDensity === 'default' ? 'selected' : ''}>기본 · 추가 지시 없음</option>
                                    <option value="light" ${settings.englishFlavorMemeDensity === 'light' ? 'selected' : ''}>살짝</option>
                                    <option value="natural" ${settings.englishFlavorMemeDensity === 'natural' ? 'selected' : ''}>자연스럽게</option>
                                    <option value="active" ${settings.englishFlavorMemeDensity === 'active' ? 'selected' : ''}>적극적으로</option>
                                </select>
                                <div class="verba-help">영어 원문에 온라인·밈 감각이 있을 때 어느 정도까지 영어권 인터넷 문화의 레퍼런스와 반응 구조를 남길지 조절합니다. 살짝은 자연스러운 한국어 전달을 더 우선하고, 자연스럽게는 균형, 적극적으로는 영어권 인터넷 문화와 밈의 결을 가장 강하게 살립니다.</div>

                                <label class="verba-check-row">
                                    <input type="checkbox" id="verba-english-flavor-referent-repeat" ${settings.englishFlavorReduceReferentRepetition ? 'checked' : ''}>
                                    <span>지칭 반복 줄이기</span>
                                </label>
                                <div class="verba-help">영어 원문의 이름·he/she·you 같은 지칭을 한국어에서 읽기 자연스럽게 정리하되, 영어권 캐릭터의 명시적인 주어·대조가 말맛에 필요한 경우에는 함부로 지우지 않습니다.</div>

                            </div>
                        </div>
                    </details>

                <details id="verba-debug-settings" class="verba-tool-details">
                    <summary>디버그 <small>오류 진단 복사</small></summary>
                    <div class="verba-tool-details-content">
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-debug-mode" ${settings.debugMode ? 'checked' : ''}>
                            <span>디버그 모드</span>
                        </label>
                        <div class="verba-help">켜면 베르바 오류 알림에 ‘진단 복사’ 버튼이 생깁니다. 복사한 내용을 그대로 제보하면 오류 단계·코드·스택·기기 환경을 확인할 수 있어요. 메시지 내용·번역문·프롬프트·프로필 ID·API 키는 넣지 않습니다.</div>
                        <button type="button" id="verba-copy-last-debug" class="menu_button verba-wide" ${lastDebugDiagnostic ? '' : 'disabled'}>최근 오류 진단 복사</button>
                    </div>
                </details>
                ${developerSettingsMarkup()}

            </div>
        </div>`;
    host.append(panel);
    refreshProfileSelect();
    renderNameLockManager();
    renderProfileStats();
    renderTranslationRuleOrder();
    renderPromptConflictInspector();
    renderQualityAuditStatus();

    const activateDeveloperMode = () => {
        const input = panel.querySelector('#verba-developer-code');
        const code = String(input?.value || '').trim();

        if (code !== '130918') {
            if (input) {
                input.value = '';
                input.focus();
            }
            notify('개발자 번호가 맞지 않아요.', 'error');
            return;
        }

        settings.developerMode = true;
        saveSettings();
        lastQualityAuditSummary = '활성화됨 · 품질 검수는 기본 OFF';
        refreshSettingsPanelForDeveloperMode();
        notify('개발자 모드를 활성화했어요.', 'success');
    };

    panel.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        if (target.closest('#verba-developer-mode-on')) {
            activateDeveloperMode();
            return;
        }

        if (target.closest('#verba-developer-mode-off')) {
            settings.developerMode = false;
            settings.qualityAuditEnabled = false;
            saveSettings();
            lastQualityAuditSummary = '개발자 모드 비활성화';
            refreshSettingsPanelForDeveloperMode();
            notify('개발자 모드를 껐어요.', 'info');
        }
    });

    panel.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.matches('#verba-developer-code')) return;
        event.preventDefault();
        activateDeveloperMode();
    });

    panel.addEventListener('change', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        if (target.id === 'verba-quality-audit-enabled') {
            settings.qualityAuditEnabled = target.checked;
            saveSettings();
            syncDeveloperQualityControls(panel);
            lastQualityAuditSummary = settings.qualityAuditEnabled
                ? '활성화됨 · 다음 아웃풋부터 검사'
                : '비활성화됨';
            renderQualityAuditStatus();
            return;
        }

        const map = {
            'verba-quality-audit-meaning': 'qualityAuditMeaning',
            'verba-quality-audit-referent': 'qualityAuditReferent',
            'verba-quality-audit-voice': 'qualityAuditVoice',
            'verba-quality-audit-translationese': 'qualityAuditTranslationese',
            'verba-quality-audit-continuity': 'qualityAuditContinuity',
        };
        const key = map[target.id];
        if (key && target instanceof HTMLInputElement) {
            settings[key] = target.checked;
            saveSettings();
            return;
        }

        if (target.id === 'verba-expression-emphasis' && target instanceof HTMLSelectElement) {
            settings.expressionEmphasisTaste = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-expression-disfluency' && target instanceof HTMLSelectElement) {
            settings.expressionDisfluencyTaste = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-expression-idiom' && target instanceof HTMLSelectElement) {
            settings.expressionIdiomMetaphorTaste = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-enabled' && target instanceof HTMLInputElement) {
            settings.koreanFlavorEnabled = target.checked;
            saveSettings();
            syncDeveloperQualityControls(panel);
            return;
        }

        if (target.id === 'verba-korean-flavor-rhythm' && target instanceof HTMLSelectElement) {
            settings.koreanFlavorDialogueRhythm = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-pronoun' && target instanceof HTMLSelectElement) {
            settings.koreanFlavorPronounOmission = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-profanity' && target instanceof HTMLSelectElement) {
            settings.koreanFlavorProfanityTone = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-interjection' && target instanceof HTMLSelectElement) {
            settings.koreanFlavorInterjectionTone = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-meme' && target instanceof HTMLSelectElement) {
            settings.koreanFlavorMemeDensity = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-korean-flavor-referent-repeat' && target instanceof HTMLInputElement) {
            settings.koreanFlavorReduceReferentRepetition = target.checked;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-enabled' && target instanceof HTMLInputElement) {
            settings.englishFlavorEnabled = target.checked;
            saveSettings();
            syncDeveloperQualityControls(panel);
            return;
        }

        if (target.id === 'verba-english-flavor-rhythm' && target instanceof HTMLSelectElement) {
            settings.englishFlavorDialogueRhythm = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-slang' && target instanceof HTMLSelectElement) {
            settings.englishFlavorSlangDensity = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-profanity' && target instanceof HTMLSelectElement) {
            settings.englishFlavorProfanityTone = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-interjection' && target instanceof HTMLSelectElement) {
            settings.englishFlavorInterjectionTone = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-meme' && target instanceof HTMLSelectElement) {
            settings.englishFlavorMemeDensity = target.value;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-referent-repeat' && target instanceof HTMLInputElement) {
            settings.englishFlavorReduceReferentRepetition = target.checked;
            saveSettings();
            return;
        }

        if (target.id === 'verba-english-flavor-conversation' && target instanceof HTMLSelectElement) {
            settings.englishFlavorConversationNaturalization = target.value;
            saveSettings();
        }
    });

    syncDeveloperQualityControls(panel);

    panel.querySelector('#verba-name-lock-manager').addEventListener('toggle', event => {
        if (event.currentTarget.open) renderNameLockManager();
    });

    panel.querySelector('#verba-profile').addEventListener('change', event => {
        settings.profileId = event.target.value;
        if (!settings.profileId) {
            settings.fallbackProfileId = '';
            settings.thirdProfileId = '';
            settings.activeProfileSlot = 'A';
        } else {
            if (settings.fallbackProfileId === settings.profileId) {
                settings.fallbackProfileId = '';
                if (settings.activeProfileSlot === 'B') settings.activeProfileSlot = 'A';
            }
            if (settings.thirdProfileId === settings.profileId) {
                settings.thirdProfileId = '';
                if (settings.activeProfileSlot === 'C') settings.activeProfileSlot = 'A';
            }
        }
        refreshProfileSelect();
        saveSettings();
    });
    panel.querySelector('#verba-fallback-profile').addEventListener('change', event => {
        const value = event.target.value;
        if (value && [settings.profileId, settings.thirdProfileId].map(String).includes(String(value))) {
            settings.fallbackProfileId = '';
            if (settings.activeProfileSlot === 'B') settings.activeProfileSlot = 'A';
            event.target.value = '';
            notify('프로필 A·B·C는 서로 다른 연결 프로필을 선택해 주세요.', 'warning');
        } else {
            settings.fallbackProfileId = value;
            if (!value && settings.activeProfileSlot === 'B') settings.activeProfileSlot = 'A';
        }
        refreshProfileToggleButton();
        saveSettings();
    });
    panel.querySelector('#verba-third-profile').addEventListener('change', event => {
        const value = event.target.value;
        if (value && [settings.profileId, settings.fallbackProfileId].map(String).includes(String(value))) {
            settings.thirdProfileId = '';
            if (settings.activeProfileSlot === 'C') settings.activeProfileSlot = 'A';
            event.target.value = '';
            notify('프로필 A·B·C는 서로 다른 연결 프로필을 선택해 주세요.', 'warning');
        } else {
            settings.thirdProfileId = value;
            if (!value && settings.activeProfileSlot === 'C') settings.activeProfileSlot = 'A';
        }
        refreshProfileToggleButton();
        saveSettings();
    });
    panel.querySelector('#verba-refresh-profiles').addEventListener('click', refreshProfileSelect);
    panel.querySelector('#verba-test-profile').addEventListener('click', event => testConnection(event.currentTarget));
    panel.querySelector('#verba-auto-profile-fallback').addEventListener('change', event => {
        settings.autoProfileFallback = event.target.checked;
        saveSettings();
    });
    const debugModeInput = panel.querySelector('#verba-debug-mode');
    const debugCopyButton = panel.querySelector('#verba-copy-last-debug');
    const syncDebugCopyButton = () => {
        if (!debugCopyButton) return;
        debugCopyButton.disabled = !settings.debugMode || !lastDebugDiagnostic;
    };
    debugModeInput?.addEventListener('change', event => {
        settings.debugMode = event.target.checked;
        saveSettings();
        syncDebugCopyButton();
        notify(settings.debugMode ? '디버그 모드를 켰어요. 다음 오류부터 진단 복사를 사용할 수 있어요.' : '디버그 모드를 껐어요.', 'info');
    });
    debugCopyButton?.addEventListener('click', async () => {
        try {
            await copyDebugDiagnostic();
            notify('최근 오류 진단을 복사했어요.', 'success');
        } catch (error) {
            console.error('[베르바] 최근 오류 진단 복사 실패', error);
            notify('복사할 최근 오류 진단이 없어요.', 'warning');
        }
    });
    syncDebugCopyButton();
    panel.querySelector('#verba-reset-profile-stats').addEventListener('click', () => {
        if (!globalThis.confirm?.('프로필 A/B/C 성능 기록을 모두 초기화할까요?')) return;
        settings.profileStats = normalizeProfileStats(null);
        saveSettings();
        renderProfileStats();
        notify('프로필 성능 기록을 초기화했어요.', 'success');
    });
    panel.querySelector('#verba-auto-input').addEventListener('change', event => {
        settings.autoInput = event.target.checked;
        saveSettings();
    });
    panel.querySelector('#verba-selection-candidates').addEventListener('change', event => {
        settings.selectionCandidates = event.target.checked;
        saveSettings();
    });
    const relationTemperatureInputs = [...panel.querySelectorAll('input[name="verba-relation-temperature"]')];
    const narrationLocalizationInputs = [...panel.querySelectorAll('input[name="verba-narration-localization-level"]')];
    const dialogueLocalizationInputs = [...panel.querySelectorAll('input[name="verba-dialogue-localization-level"]')];
    const fineTuningInputs = [...relationTemperatureInputs, ...narrationLocalizationInputs, ...dialogueLocalizationInputs];
    const syncRelationTemperatureControls = enabled => {
        panel.querySelector('#verba-fine-tuning-controls')?.classList.toggle('verba-control-disabled', !enabled);
        fineTuningInputs.forEach(input => { input.disabled = !enabled; });
    };
    syncRelationTemperatureControls(settings.relationTemperatureEnabled !== false);
    panel.querySelector('#verba-relation-temperature-enabled').addEventListener('change', event => {
        settings.relationTemperatureEnabled = event.target.checked;
        syncRelationTemperatureControls(settings.relationTemperatureEnabled);
        saveSettings();
    });
    relationTemperatureInputs.forEach(input => {
        input.addEventListener('change', event => {
            settings.relationTemperature = normalizedTranslationTuning({
                relationTemperatureEnabled: settings.relationTemperatureEnabled,
                relationTemperature: event.target.value,
                narrationLocalizationLevel: settings.narrationLocalizationLevel,
                dialogueLocalizationLevel: settings.dialogueLocalizationLevel,
            }).relationTemperature;
            saveSettings();
        });
    });
    narrationLocalizationInputs.forEach(input => {
        input.addEventListener('change', event => {
            settings.narrationLocalizationLevel = normalizedTranslationTuning({
                relationTemperatureEnabled: settings.relationTemperatureEnabled,
                relationTemperature: settings.relationTemperature,
                narrationLocalizationLevel: event.target.value,
                dialogueLocalizationLevel: settings.dialogueLocalizationLevel,
            }).narrationLocalizationLevel;
            saveSettings();
        });
    });
    dialogueLocalizationInputs.forEach(input => {
        input.addEventListener('change', event => {
            settings.dialogueLocalizationLevel = normalizedTranslationTuning({
                relationTemperatureEnabled: settings.relationTemperatureEnabled,
                relationTemperature: settings.relationTemperature,
                narrationLocalizationLevel: settings.narrationLocalizationLevel,
                dialogueLocalizationLevel: event.target.value,
            }).dialogueLocalizationLevel;
            saveSettings();
        });
    });
    panel.querySelector('#verba-dialogue-ending-preferred').addEventListener('input', event => {
        settings.dialogueEndingPreferred = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-dialogue-ending-avoid').addEventListener('input', event => {
        settings.dialogueEndingAvoid = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-dialogue-ending-strength').addEventListener('change', event => {
        settings.dialogueEndingStrength = ['light', 'normal', 'strong'].includes(event.target.value)
            ? event.target.value
            : 'normal';
        saveSettings();
    });
    panel.querySelector('#verba-dialogue-ending-repetition-reduction').addEventListener('change', event => {
        settings.dialogueEndingRepetitionReduction = event.target.checked;
        saveSettings();
    });
    panel.querySelector('#verba-rule-priority-list').addEventListener('click', event => {
        const button = event.target.closest('.verba-rule-move-up, .verba-rule-move-down');
        if (!button || button.disabled) return;
        const key = button.closest('.verba-rule-priority-row')?.dataset.ruleKey;
        const order = normalizeTranslationRuleOrder(settings.translationRuleOrder);
        const index = order.indexOf(String(key || ''));
        if (index < 0) return;
        const nextIndex = button.classList.contains('verba-rule-move-up') ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= order.length) return;
        [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
        settings.translationRuleOrder = order;
        saveSettings();
        renderTranslationRuleOrder();
        renderPromptConflictInspector();
    });
    panel.querySelector('#verba-reset-rule-priority').addEventListener('click', () => {
        settings.translationRuleOrder = [...DEFAULT_TRANSLATION_RULE_ORDER];
        saveSettings();
        renderTranslationRuleOrder();
        renderPromptConflictInspector();
        notify('번역 규칙 우선순위를 기본 순서로 되돌렸어요.', 'success');
    });
    panel.querySelector('#verba-refresh-prompt-conflicts')?.addEventListener('click', () => {
        const conflicts = configuredPromptConflicts();
        renderPromptConflictInspector(conflicts);
        notify(
            conflicts.length
                ? `명백한 프롬프트 충돌 ${conflicts.length}건을 찾았어요. 아래 문구를 확인해 주세요.`
                : '현재 저장된 프롬프트에서는 명백한 충돌이 없어요.',
            conflicts.length ? 'warning' : 'success',
        );
    });
    panel.querySelector('#verba-selection-quick-count').addEventListener('change', event => {
        settings.selectionQuickCount = Math.min(5, Math.max(2, Number(event.target.value) || 2));
        hideSelectionButton();
        saveSettings();
    });
    [
        ['#verba-show-selection-name', 'showSelectionName'],
        ['#verba-show-selection-source', 'showSelectionSource'],
        ['#verba-show-selection-lock', 'showSelectionLock'],
        ['#verba-show-selection-bundle', 'showSelectionBundle'],
    ].forEach(([selector, key]) => {
        panel.querySelector(selector).addEventListener('change', event => {
            settings[key] = event.target.checked;
            hideSelectionButton();
            saveSettings();
        });
    });
    const promptPresetSelect = panel.querySelector('#verba-prompt-preset-select');
    const promptPresetName = panel.querySelector('#verba-prompt-preset-name');

    promptPresetSelect?.addEventListener('change', event => {
        const preset = promptPresetById(event.target.value);
        if (!preset) {
            if (promptPresetName) promptPresetName.value = '';
            renderPromptPresetManager('');
            return;
        }

        clearTimeout(promptEditorBackupTimer);
        promptEditorBackupTimer = null;
        setPromptFieldsFromPreset(preset);
        if (promptPresetName) promptPresetName.value = preset.name;
        renderPromptPresetManager(preset.id);
        notify(`프롬프트 프리셋 “${preset.name}”을 적용했어요.`, 'success');
    });

    panel.querySelector('#verba-prompt-preset-save')?.addEventListener('click', () => {
        const name = normalizedPromptPresetName(promptPresetName?.value);
        if (!name) {
            notify('프롬프트 프리셋 이름을 입력해 주세요.', 'warning');
            promptPresetName?.focus();
            return;
        }
        const presets = normalizedPromptPresets();
        if (presets.some(preset => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            notify('같은 이름의 프롬프트 프리셋이 이미 있어요. 다른 이름을 사용해 주세요.', 'warning');
            return;
        }
        if (presets.length >= 100) {
            notify('프롬프트 프리셋은 최대 100개까지 저장할 수 있어요.', 'warning');
            return;
        }

        const preset = {
            id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name,
            ...currentPromptPresetSnapshot(),
            favorite: false,
            updatedAt: new Date().toISOString(),
        };
        settings.promptPresets = [...presets, preset];
        saveSettings();
        renderPromptPresetManager(preset.id);
        if (promptPresetSelect) promptPresetSelect.value = preset.id;
        notify(`프롬프트 프리셋 “${name}”을 저장했어요.`, 'success');
    });

    panel.querySelector('#verba-prompt-preset-duplicate')?.addEventListener('click', () => {
        const sourcePreset = promptPresetById(promptPresetSelect?.value);
        if (!sourcePreset) {
            notify('복제할 프롬프트 프리셋을 선택해 주세요.', 'warning');
            return;
        }
        const presets = normalizedPromptPresets();
        if (presets.length >= 100) {
            notify('프롬프트 프리셋은 최대 100개까지 저장할 수 있어요.', 'warning');
            return;
        }

        const name = promptPresetDuplicateName(sourcePreset.name, presets);
        const duplicated = {
            ...sourcePreset,
            id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name,
            favorite: false,
            updatedAt: new Date().toISOString(),
        };
        settings.promptPresets = [...presets, duplicated];
        saveSettings();
        renderPromptPresetManager(duplicated.id);
        if (promptPresetSelect) promptPresetSelect.value = duplicated.id;
        if (promptPresetName) promptPresetName.value = duplicated.name;
        notify(`프롬프트 프리셋 “${sourcePreset.name}”을 “${duplicated.name}”으로 복제했어요.`, 'success');
    });

    panel.querySelector('#verba-prompt-preset-favorite')?.addEventListener('click', () => {
        const id = String(promptPresetSelect?.value || '');
        const preset = promptPresetById(id);
        if (!preset) {
            notify('즐겨찾기를 바꿀 프롬프트 프리셋을 선택해 주세요.', 'warning');
            return;
        }

        const nextFavorite = preset.favorite !== true;
        settings.promptPresets = normalizedPromptPresets().map(row => (
            row.id === id ? { ...row, favorite: nextFavorite } : row
        ));
        saveSettings();
        renderPromptPresetManager(id);
        if (promptPresetSelect) promptPresetSelect.value = id;
        notify(
            nextFavorite
                ? `프롬프트 프리셋 “${preset.name}”을 즐겨찾기에 추가했어요.`
                : `프롬프트 프리셋 “${preset.name}”의 즐겨찾기를 해제했어요.`,
            'success',
        );
    });

    panel.querySelector('#verba-prompt-preset-rename')?.addEventListener('click', () => {
        const id = String(promptPresetSelect?.value || '');
        const preset = promptPresetById(id);
        if (!preset) {
            notify('이름을 바꿀 프롬프트 프리셋을 선택해 주세요.', 'warning');
            return;
        }
        const name = normalizedPromptPresetName(promptPresetName?.value);
        if (!name) {
            notify('새 프리셋 이름을 입력해 주세요.', 'warning');
            promptPresetName?.focus();
            return;
        }
        if (normalizedPromptPresets().some(row => row.id !== id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            notify('같은 이름의 다른 프롬프트 프리셋이 이미 있어요.', 'warning');
            return;
        }
        settings.promptPresets = normalizedPromptPresets().map(row => (
            row.id === id ? { ...row, name, updatedAt: new Date().toISOString() } : row
        ));
        saveSettings();
        renderPromptPresetManager(id);
        if (promptPresetName) promptPresetName.value = name;
        notify(`프롬프트 프리셋 이름을 “${name}”으로 바꿨어요.`, 'success');
    });

    panel.querySelector('#verba-prompt-preset-delete')?.addEventListener('click', () => {
        const id = String(promptPresetSelect?.value || '');
        const preset = promptPresetById(id);
        if (!preset) {
            notify('삭제할 프롬프트 프리셋을 선택해 주세요.', 'warning');
            return;
        }
        if (!globalThis.confirm?.(`프롬프트 프리셋 “${preset.name}”을 삭제할까요?`)) return;
        settings.promptPresets = normalizedPromptPresets().filter(row => row.id !== id);
        saveSettings();
        if (promptPresetName) promptPresetName.value = '';
        renderPromptPresetManager('');
        notify(`프롬프트 프리셋 “${preset.name}”을 삭제했어요.`, 'success');
    });

    panel.querySelector('#verba-prompt-preset-backup-now')?.addEventListener('click', () => {
        clearTimeout(promptEditorBackupTimer);
        promptEditorBackupTimer = null;
        if (!createPromptEditorBackup('수동 백업', { force: true })) {
            renderPromptPresetBackups();
            notify('프롬프트 4칸이 모두 비어 있어 백업하지 않았어요.', 'warning');
            return;
        }
        saveSettings();
        renderPromptPresetBackups();
        notify('현재 4개 프롬프트 상태를 백업했어요.', 'success');
    });

    renderPromptPresetManager();

    [
        ['#verba-global-prompt-enabled', 'globalPromptEnabled'],
        ['#verba-all-dialogue-prompt-enabled', 'allDialoguePromptEnabled'],
        ['#verba-dialogue-prompt-enabled', 'dialoguePromptEnabled'],
        ['#verba-other-dialogue-prompt-enabled', 'otherDialoguePromptEnabled'],
    ].forEach(([selector, key]) => {
        panel.querySelector(selector)?.addEventListener('change', event => {
            settings[key] = event.target.checked;
            syncPromptSlotUi();
            saveSettings();
            renderPromptConflictInspector();
            schedulePromptEditorBackup();
        });
    });
    syncPromptSlotUi();

    panel.querySelector('#verba-global-prompt').addEventListener('input', event => {
        settings.globalPrompt = event.target.value;
        saveSettings();
        renderPromptConflictInspector();
        schedulePromptEditorBackup();
    });
    panel.querySelector('#verba-all-dialogue-prompt').addEventListener('input', event => {
        settings.allDialoguePrompt = event.target.value;
        saveSettings();
        renderPromptConflictInspector();
        schedulePromptEditorBackup();
    });
    panel.querySelector('#verba-dialogue-prompt').addEventListener('input', event => {
        settings.dialoguePrompt = event.target.value;
        saveSettings();
        renderPromptConflictInspector();
        schedulePromptEditorBackup();
    });
    panel.querySelector('#verba-other-dialogue-prompt').addEventListener('input', event => {
        settings.otherDialoguePrompt = event.target.value;
        saveSettings();
        renderPromptConflictInspector();
        schedulePromptEditorBackup();
    });
    panel.querySelector('#verba-banned-words').addEventListener('input', event => {
        settings.bannedWords = event.target.value;
        saveSettings();
    });

    const currentRulesDetails = panel.querySelector('#verba-current-rules');
    currentRulesDetails?.addEventListener('toggle', () => {
        if (currentRulesDetails.open) renderCurrentAppliedRules();
    });
    const refreshCurrentRulesIfOpen = () => {
        if (!currentRulesDetails?.open) return;
        setTimeout(renderCurrentAppliedRules, 0);
    };
    panel.addEventListener('input', refreshCurrentRulesIfOpen);
    panel.addEventListener('change', refreshCurrentRulesIfOpen);
}

function clearStaleCurrentTranslation(messageId) {
    const context = liveContext();
    const message = context.chat?.[messageId];
    if (!message?.extra?.[STATE_KEY]) return;
    if (currentRecord(message)) return;
    if (clearOwnedDisplay(message)) {
        updateMessageBlock(messageId, message);
        scheduleChatSave(context.chat);
    }
}

function cancelScheduledAutomaticTranslation(messageId) {
    const timer = automaticTranslationTimers.get(messageId);
    if (timer) clearTimeout(timer);
    automaticTranslationTimers.delete(messageId);
}

function scheduleAutomaticTranslation(messageId, delay = 100, translationOptions = {}) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return;
    cancelScheduledAutomaticTranslation(id);
    const timer = setTimeout(() => {
        automaticTranslationTimers.delete(id);
        if (swipeTranslationJobs.has(id)) return;
        const message = liveContext().chat?.[id];
        if (repairSwipeTranslationIndexes(message)) scheduleChatSave(liveContext().chat);
        clearStaleCurrentTranslation(id);
        translateMessage(id, { automatic: true, ...translationOptions });
        refreshRetranslateButton();
    }, delay);
    automaticTranslationTimers.set(id, timer);
}

function scheduleSwipeTranslation(messageId, previousSignature = '', hold = null) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return;
    cancelScheduledAutomaticTranslation(id);

    const previousJob = swipeTranslationJobs.get(id);
    if (previousJob?.timer) clearTimeout(previousJob.timer);
    if (previousJob) releaseSwipeHold(id);

    const job = {
        startedAt: Date.now(),
        previousSignature,
        hold,
        awaitingGeneratedSwipe: false,
        rendered: false,
        candidateSignature: '',
        stableChecks: 0,
        timer: null,
        check: null,
    };
    swipeTranslationJobs.set(id, job);
    renderSwipeHold(id, job);

    const check = () => {
        if (swipeTranslationJobs.get(id) !== job) return;
        const message = liveContext().chat?.[id];
        if (repairSwipeTranslationIndexes(message)) scheduleChatSave(liveContext().chat);
        const slot = currentSwipeSlot(message);
        const signature = messageVersionSignature(message);
        const elapsed = Date.now() - job.startedAt;
        const maxWaitMs = 10 * 60 * 1000;
        renderSwipeHold(id, job);

        // When generating a new swipe, SillyTavern advances swipe_id before the
        // new swipes[swipe_id] source exists. message.mes still contains the
        // previous swipe at that moment and must never be used as the new source.
        if (slot.hasIndexedSwipe && !slot.exists) {
            job.awaitingGeneratedSwipe = true;
            if (elapsed < maxWaitMs) {
                job.timer = setTimeout(check, 180);
            } else {
                finishSwipeTranslationJob(id, job);
            }
            return;
        }

        // A newly-created swipe can receive partial streaming text long before
        // CHARACTER_MESSAGE_RENDERED. Keep showing the previous translation
        // and wait for SillyTavern's completed-render event before translating.
        if (job.awaitingGeneratedSwipe && !job.rendered) {
            if (elapsed < maxWaitMs) {
                job.timer = setTimeout(check, 180);
            } else {
                finishSwipeTranslationJob(id, job);
            }
            return;
        }

        // MESSAGE_SWIPED can fire before SillyTavern changes swipe_id. Never
        // translate the owned, previous swipe while that transition is pending.
        if (!message || (job.previousSignature && signature === job.previousSignature)) {
            const restoredRecord = message && currentRecord(message);
            if (
                elapsed >= 650
                && restoredRecord
                && storedRecordSignature(restoredRecord) === job.previousSignature
            ) {
                restoreCurrentDisplay(id, message, restoredRecord);
                finishSwipeTranslationJob(id, job);
            } else if (elapsed < maxWaitMs) {
                job.timer = setTimeout(check, 180);
            } else {
                finishSwipeTranslationJob(id, job);
            }
            return;
        }

        if (signature !== job.candidateSignature) {
            job.candidateSignature = signature;
            job.stableChecks = 0;
            job.timer = setTimeout(check, 120);
            return;
        }

        job.stableChecks += 1;
        if (job.stableChecks < 1) {
            job.timer = setTimeout(check, 120);
            return;
        }

        clearStaleCurrentTranslation(id);
        renderSwipeHold(id, job);
        Promise.resolve(translateMessage(id, { automatic: true })).finally(() => {
            finishSwipeTranslationJob(id, job);
            refreshRetranslateButton();
        });
    };

    job.check = check;
    job.timer = setTimeout(check, 120);
}

function handleSwipe(payload) {
    const id = normalizedMessageId(payload);
    if (id < 0) return;
    const message = liveContext().chat?.[id];
    const hold = captureSwipeHold(id, message);
    const previousSignature = hold?.signature || storedRecordSignature(message?.extra?.[STATE_KEY]);
    clearTransientTranslationSelections();
    abortPendingOutput(id, outputAbortReason(
        'VERBA_SWIPE_CHANGED',
        '스와이프가 변경되어 이전 답변 번역을 취소했습니다.',
        true,
    ));
    pendingOutputs.delete(id);
    selectionSnapshot = null;
    hideSelectionButton();
    scheduleSwipeTranslation(id, previousSignature, hold);
}


function insteadRevisionMeta(message) {
    if (!message || message.is_user) return null;

    const swipeId = currentSwipeId(message);
    const swipeInfo = swipeId !== null && Array.isArray(message.swipe_info)
        ? message.swipe_info[swipeId]
        : null;
    const swipeExtra = swipeInfo?.extra && typeof swipeInfo.extra === 'object'
        ? swipeInfo.extra
        : null;
    const messageExtra = message.extra && typeof message.extra === 'object'
        ? message.extra
        : null;

    const marked = Boolean(
        swipeExtra?.instead_revised
        || String(swipeExtra?.api || '').toLocaleLowerCase() === 'instead'
        || messageExtra?.instead_revised
    );
    if (!marked) return null;

    const finishedRaw = swipeInfo?.gen_finished || messageExtra?.gen_finished || null;
    const finishedAt = finishedRaw ? Date.parse(finishedRaw) : NaN;

    return {
        swipeId,
        swipeInfo,
        swipeExtra,
        finishedAt: Number.isFinite(finishedAt) ? finishedAt : null,
    };
}

function insteadRevisionSignature(message) {
    const meta = insteadRevisionMeta(message);
    if (!meta) return '';
    const source = messageSource(message);
    if (!source.trim()) return '';

    return [
        meta.swipeId ?? 'none',
        hashText(source),
        source.length,
    ].join(':');
}

function pruneInsteadRevisionSeen(now = Date.now()) {
    for (const [key, timestamp] of insteadRevisionTranslationSeen) {
        if (now - Number(timestamp || 0) > 5 * 60 * 1000) {
            insteadRevisionTranslationSeen.delete(key);
        }
    }
}

function scheduleRecentInsteadRevisionTranslations(delay = 180) {
    const context = liveContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const now = Date.now();
    pruneInsteadRevisionSeen(now);

    chat.forEach((message, id) => {
        const meta = insteadRevisionMeta(message);
        if (!meta) return;

        // inSTead writes gen_finished immediately before save/reload. Restrict
        // compatibility auto-detection to fresh revisions so opening an old chat
        // never causes every historical inSTead swipe to be translated at once.
        if (meta.finishedAt === null || Math.abs(now - meta.finishedAt) > 90_000) return;

        const source = messageSource(message);
        if (!source.trim() || isPredominantlyKorean(source) || !hasForeignText(source)) return;
        if (currentRecord(message)) return;

        const signature = insteadRevisionSignature(message);
        if (!signature) return;
        const key = `${id}:${signature}`;
        if (insteadRevisionTranslationSeen.has(key)) return;

        insteadRevisionTranslationSeen.set(key, now);
        console.info(`[베르바] inSTead 새 revision 감지 #${id} swipe ${meta.swipeId ?? '?'} — 자동 번역 예약`);
        scheduleAutomaticTranslation(id, delay, { insteadRevision: true });
    });
}

function handleCompletedAssistantMessage(payload, delay = 80) {
    let id = normalizedMessageId(payload);
    if (id < 0) id = latestAssistantMessage()?.id ?? -1;
    if (id < 0) return;

    const swipeJob = swipeTranslationJobs.get(id);
    if (swipeJob) {
        // MESSAGE_RECEIVED is emitted once the generated swipe has been stored,
        // while CHARACTER_MESSAGE_RENDERED may be skipped or delayed by some
        // SillyTavern mobile rendering paths. Either event means the source can
        // now be checked for a stable completed value.
        swipeJob.rendered = true;
        if (swipeJob.timer) clearTimeout(swipeJob.timer);
        swipeJob.timer = setTimeout(swipeJob.check, delay);
        return;
    }

    scheduleAutomaticTranslation(id, Math.max(80, delay));
}

function handleGenerationEnded() {
    for (const [id, swipeJob] of swipeTranslationJobs.entries()) {
        swipeJob.rendered = true;
        if (swipeJob.timer) clearTimeout(swipeJob.timer);
        swipeJob.timer = setTimeout(swipeJob.check, 100);
    }

    const latest = latestAssistantMessage();
    if (latest && !swipeTranslationJobs.has(latest.id)) {
        scheduleAutomaticTranslation(latest.id, 120);
    }
}

/**
 * SillyTavern's message-edit cancel path intentionally redraws `message.mes`
 * directly, even when `extra.display_text` still contains Verba's translation.
 * MESSAGE_UPDATED fires after that redraw. If the underlying source did not
 * change, force one normal message render so the saved translation is visible
 * again. Use only an exact source-hash match here: a real edit must be handled
 * by MESSAGE_EDITED and translated again, never restored from a stale cache.
 */
function restoreTranslationAfterMessageUpdate(payload) {
    const id = normalizedMessageId(payload);
    if (id < 0) return;

    setTimeout(() => {
        const context = liveContext();
        const message = context.chat?.[id];
        if (!message) return;

        const source = messageSource(message);
        const sourceHash = hashText(source);
        const swipeId = currentSwipeId(message);
        const storedCandidates = [
            message?.extra?.[STATE_KEY],
            currentSwipeExtra(message, false)?.[STATE_KEY],
        ];
        const stored = storedCandidates.find(record => (
            record
            && typeof record === 'object'
            && record.sourceHash === sourceHash
            && String(record.translation || '').trim()
        ));
        if (!stored) return;

        const record = stored.swipeId === swipeId ? stored : { ...stored, swipeId };
        if (sourceViewRequested(message, record)) return;

        const messageElement = document.querySelector(`.mes[mesid="${id}"]`);
        if (!messageElement || messageElement.querySelector('.edit_textarea')) return;

        if (!message.extra || typeof message.extra !== 'object') message.extra = {};
        message.extra[STATE_KEY] = { ...record };
        message.extra.display_text = record.translation;
        delete message.extra[SOURCE_VIEW_KEY];
        syncOwnedTranslationToCurrentSwipe(message, record);

        // Force the DOM refresh even when display_text was already correct in
        // data; the edit-cancel handler bypasses display_text while redrawing.
        updateMessageBlock(id, message);
        cacheRenderedTranslation(id, message, record);
        refreshTranslationClasses();
    }, 0);
}


/**
 * SillyTavern can rebuild the message DOM from `message.mes` when a chat is
 * opened even though Verba's saved translation record and display_text are
 * still present. Re-assert the saved display state after chat load without
 * calling the translation API.
 *
 * Run in a few short passes because mobile/WebView chat rendering may finish
 * after CHAT_CHANGED itself. Only the currently active swipe is restored.
 */
function restoreSavedTranslationsAfterChatOpen() {
    const context = liveContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    let changed = false;

    chat.forEach((message, messageId) => {
        if (!message || message.is_user || message.is_system) return;

        if (repairSwipeTranslationIndexes(message)) changed = true;

        const record = currentRecord(message);
        if (!record || sourceViewRequested(message, record)) return;

        if (!message.extra || typeof message.extra !== 'object') message.extra = {};

        let messageChanged = false;
        if (!sameTranslationRecord(message.extra[STATE_KEY], record)) {
            message.extra[STATE_KEY] = { ...record };
            messageChanged = true;
        }
        if (message.extra.display_text !== record.translation) {
            message.extra.display_text = record.translation;
            messageChanged = true;
        }
        if (message.extra[SOURCE_VIEW_KEY]) {
            delete message.extra[SOURCE_VIEW_KEY];
            messageChanged = true;
        }
        if (syncOwnedTranslationToCurrentSwipe(message, record)) {
            messageChanged = true;
        }

        // CHAT_CHANGED may render the raw source directly. If this message is
        // already present in the DOM, force one normal SillyTavern redraw so
        // display_text becomes visible again.
        const messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (messageElement && !messageElement.querySelector('.edit_textarea')) {
            updateMessageBlock(messageId, message);
            cacheRenderedTranslation(messageId, message, record);
        }

        if (messageChanged) changed = true;
    });

    if (changed) scheduleChatSave(chat);
    refreshTranslationClasses();
    refreshRetranslateButton();
}

function scheduleChatOpenTranslationRestore() {
    // Immediate-ish pass plus delayed passes for mobile/WebView DOM timing.
    [80, 260, 700].forEach(delay => {
        setTimeout(restoreSavedTranslationsAfterChatOpen, delay);
    });
}

function setupEvents() {
    const context = liveContext();
    const source = context.eventSource;
    const types = context.event_types || {};
    if (!source?.on) return;

    if (types.GENERATION_STARTED) {
        source.on(types.GENERATION_STARTED, translateInputBeforeGeneration);
        source.makeLast?.(types.GENERATION_STARTED, translateInputBeforeGeneration);
    }
    if (types.MESSAGE_SENT) {
        source.on(types.MESSAGE_SENT, translateSentInputMessage);
    }
    if (types.MESSAGE_RECEIVED) {
        source.on(types.MESSAGE_RECEIVED, payload => {
            clearTransientTranslationSelections();
            handleCompletedAssistantMessage(payload, 80);
        });
    }
    if (types.CHARACTER_MESSAGE_RENDERED) {
        source.on(types.CHARACTER_MESSAGE_RENDERED, payload => handleCompletedAssistantMessage(payload, 120));
    }
    if (types.MESSAGE_SWIPED) source.on(types.MESSAGE_SWIPED, handleSwipe);
    if (types.GENERATION_ENDED) source.on(types.GENERATION_ENDED, handleGenerationEnded);
    if (types.CHAT_CHANGED) {
        source.on(types.CHAT_CHANGED, () => {
            // Locks and bundles are one-shot editing state. Clear tracked
            // records before caches are discarded, and also clear any stale
            // values loaded with the newly opened chat.
            clearTransientTranslationSelections();
            for (const pending of pendingOutputs.values()) {
                pending.controller.abort(outputAbortReason(
                    'VERBA_CHAT_CHANGED',
                    '채팅이 변경되어 이전 채팅의 번역을 취소했습니다.',
                    true,
                ));
            }
            pendingOutputs.clear();
            for (const controller of pendingInputControllers) controller.abort();
            pendingInputControllers.clear();
            failedOutputSignatures.clear();
            for (const timer of automaticTranslationTimers.values()) clearTimeout(timer);
            automaticTranslationTimers.clear();
            for (const job of swipeTranslationJobs.values()) clearTimeout(job.timer);
            swipeTranslationJobs.clear();
            renderedTranslationCache.clear();
            lastRenderedTranslationByMessage.clear();
            speakerAttributionCache.clear();
            roleTermPlanCache.clear();
            document.querySelectorAll('.verba-swipe-hold-active').forEach(element => {
                element.classList.remove('verba-swipe-hold-active');
                element.querySelectorAll('.verba-swipe-hold-content').forEach(hold => hold.remove());
            });
            dismissPreviousOutputReturnButton();
            const requestOverlay = document.querySelector('#verba-request-overlay');
            const closeButton = requestOverlay?.querySelector('.verba-close');
            if (closeButton) closeButton.click();
            else requestOverlay?.remove();
            setTimeout(() => {
                injectInputAction();
                refreshProfileSelect();
                renderNameLockManager();
                scheduleChatOpenTranslationRestore();
                scheduleRecentInsteadRevisionTranslations(220);
            }, 120);
            setTimeout(() => scheduleRecentInsteadRevisionTranslations(220), 420);
            setTimeout(() => scheduleRecentInsteadRevisionTranslations(220), 900);
        });
    }
    if (types.MESSAGE_EDITED) {
        source.on(types.MESSAGE_EDITED, payload => {
            const id = normalizedMessageId(payload);
            scheduleAutomaticTranslation(id, 80);
        });
    }
    if (types.MESSAGE_UPDATED) {
        source.on(types.MESSAGE_UPDATED, restoreTranslationAfterMessageUpdate);
    }
}

function setupObserver() {
    const observer = new MutationObserver(() => {
        if (uiRefreshTimer !== null) return;
        uiRefreshTimer = setTimeout(() => {
            uiRefreshTimer = null;
            injectSettingsPanel();
            injectInputAction();
            refreshTranslationClasses();
            scheduleRecentInsteadRevisionTranslations(180);
        }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function initialize() {
    clearTransientTranslationSelections();

    const stalePanels = [...document.querySelectorAll('#verba-settings, .verba-settings')];
    stalePanels.slice(1).forEach(panel => panel.remove());

    injectSettingsPanel();
    injectInputAction();
    refreshTranslationClasses();
    scheduleChatOpenTranslationRestore();
    setupAutoInput();
    setupMessageCopyHold();
    setupSelection();
    setupEvents();
    setupObserver();
    setTimeout(() => scheduleRecentInsteadRevisionTranslations(220), 300);
    globalThis.__verbaTranslatorVersion = EXTENSION_VERSION;
    console.log(`[베르바] v${EXTENSION_VERSION} 준비 완료`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 0), { once: true });
} else {
    setTimeout(initialize, 0);
}
