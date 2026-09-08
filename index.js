import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import {
    assembleTranslation,
    buildBannedRepairPrompt,
    buildInputPrompt,
    buildNameHistoryFormsPrompt,
    buildNameMatchPrompt,
    buildOutputPrompt,
    buildSelectionPrompt,
    buildUntranslatedRepairPrompt,
    detectCharacterGender,
    extractResponseText,
    findBannedWords,
    findUntranslatedSegments,
    hasForeignText,
    hasKorean,
    hashText,
    isPredominantlyKorean,
    parseSegmentResponse,
    parseSelectionCandidateResponse,
    replaceOutsideProtected,
    segmentSource,
} from './core.js';

const EXTENSION_KEY = 'verba';
const EXTENSION_VERSION = '0.1.36';
const STATE_KEY = 'verba_current_translation';
const SOURCE_VIEW_KEY = 'verba_source_view';
const CHARACTER_FIELD_KEY = 'verba';
const DEFAULT_SETTINGS = {
    profileId: '',
    fallbackProfileId: '',
    thirdProfileId: '',
    activeProfileSlot: 'A',
    autoInput: false,
    selectionCandidates: false,
    globalPrompt: '',
    allDialoguePrompt: '',
    dialoguePrompt: '',
    bannedWords: '',
    maxTokens: 15000,
    timeoutSeconds: 120,
};

const baseContext = getContext();
extension_settings[EXTENSION_KEY] = Object.assign(
    {},
    DEFAULT_SETTINGS,
    extension_settings[EXTENSION_KEY] || {},
);
const settings = extension_settings[EXTENSION_KEY];
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
const pendingInputControllers = new Set();
let requestTail = Promise.resolve();
let chatSaveTimer = null;
let uiRefreshTimer = null;
let inputBusy = false;
let bypassSendClick = false;
let selectionBusy = false;
let selectionSnapshot = null;
let selectionTimer = null;
let bottomErrorTimer = null;

function liveContext() {
    return globalThis.SillyTavern?.getContext?.() || baseContext;
}

function notify(message, type = 'info') {
    if (type === 'error') {
        showBottomError(message);
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

function showBottomError(message) {
    clearTimeout(bottomErrorTimer);
    document.querySelector('#verba-bottom-error')?.remove();
    const notice = document.createElement('div');
    notice.id = 'verba-bottom-error';
    notice.className = 'verba-bottom-notice verba-bottom-error';
    notice.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = `베르바 · ${String(message || '오류가 발생했습니다.')}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', '오류 알림 닫기');
    close.addEventListener('click', () => {
        clearTimeout(bottomErrorTimer);
        notice.remove();
    });
    notice.append(text, close);
    document.documentElement.append(notice);
    bottomErrorTimer = setTimeout(() => notice.remove(), 12000);
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
            indicator.textContent = '베르바 · 서버 오류 재시도 취소 중…';
            for (const retry of serverRetryStates.values()) retry.controller.abort();
            notify('서버 오류 자동 재시도를 취소했어요.', 'info');
        });
        document.documentElement.append(indicator);
    }
    const timing = state.delayMs > 0 ? `${Math.ceil(state.delayMs / 1000)}초 후` : '요청 중';
    indicator.disabled = false;
    indicator.textContent = `베르바 · 서버 오류 · ${state.retryCount}/${state.maxRetries}회 ${timing} 재시도 · ✕`;
    indicator.title = '눌러서 서버 오류 자동 재시도 취소';
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
}

function enqueueRequest(task) {
    const run = requestTail.then(task, task);
    requestTail = run.catch(() => {});
    return run;
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
        return await enqueueRequest(async () => {
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
            return response;
        });
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error(`응답 대기 시간 ${timeoutSeconds}초를 초과했습니다.`);
            timeoutError.code = 'VERBA_TIMEOUT';
            timeoutError.cause = error;
            throw timeoutError;
        }
        if (controller.signal.aborted) throw abortError();
        throw error;
    } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener?.('abort', forwardAbort);
    }
}

function fallbackEligibleError(error) {
    const text = errorText(error).toLowerCase();
    return !/\b(?:413|422)\b|context length|maximum context|too (?:large|long)|safety|blocked|content.?filter|컨텍스트.*초과/.test(text);
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
        fallbacks: ordered.slice(1),
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
    const delays = [3000, 5000, 8000, 12000, 18000];
    const token = Symbol('verba-server-retry');
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
        for (let attempt = 0; attempt <= delays.length; attempt += 1) {
            if (controller.signal.aborted) throw abortError();
            const profiles = configuredProfileCycle();
            const primaryProfileId = profiles.active;
            try {
                return await sendProfileRequest(prompt, { ...requestOptions, profileId: primaryProfileId });
            } catch (primaryError) {
                if (isAbort(primaryError, controller.signal)) throw primaryError;
                let cycleError = primaryError;
                const errors = [primaryError];
                if (profiles.fallbacks.length && fallbackEligibleError(primaryError)) {
                    for (const fallback of profiles.fallbacks) {
                        console.warn(`[베르바] 현재 선택 프로필 실패 — 프로필 ${fallback.slot} ${profileDisplayName(fallback.id)}(으)로 임시 전환`, errors.at(-1));
                        try {
                            const response = await sendProfileRequest(prompt, {
                                ...requestOptions,
                                profileId: fallback.id,
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
                if (!transientError(cycleError) || attempt === delays.length) break;
                const delay = retryAfterMs(cycleError) || delays[attempt];
                const state = {
                    controller,
                    retryCount: attempt + 1,
                    maxRetries: delays.length,
                    delayMs: delay,
                    updatedAt: Date.now(),
                };
                serverRetryStates.set(token, state);
                updateServerRetryIndicator();
                console.warn(`[베르바] 일시적 서버 오류 — ${state.retryCount}/${state.maxRetries}회, ${Math.ceil(delay / 1000)}초 후 번역 재시도`, cycleError);
                await wait(delay, controller.signal);
                state.delayMs = 0;
                state.updatedAt = Date.now();
                updateServerRetryIndicator();
            }
        }
        if (lastError && transientError(lastError)) {
            throw new Error(`서버 오류 자동 재시도 ${delays.length}회를 모두 사용했습니다: ${errorText(lastError)}`, { cause: lastError });
        }
        throw lastError || new Error('번역 요청에 실패했습니다.');
    } finally {
        serverRetryStates.delete(token);
        updateServerRetryIndicator();
        outerSignal?.removeEventListener?.('abort', forwardAbort);
    }
}

async function requestSegments(prompt, expectedSegments, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const repair = attempt
            ? '\n\nYour previous response was invalid. Return strict JSON only and include every required segment id exactly once.'
            : '';
        try {
            const response = await sendWithRetry(prompt + repair, options);
            return parseSegmentResponse(extractResponseText(response), expectedSegments);
        } catch (error) {
            if (isAbort(error, options.signal) || transientError(error)) throw error;
            lastError = error;
        }
    }
    throw lastError || new Error('번역 결과를 해석하지 못했습니다.');
}

async function requestSelectionCandidates(prompt, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const repair = attempt
            ? '\n\nYour previous response was invalid. Return strict JSON only with exactly three distinct candidates.'
            : '';
        try {
            const response = await sendWithRetry(prompt + repair, options);
            return parseSelectionCandidateResponse(extractResponseText(response), 3);
        } catch (error) {
            if (isAbort(error, options.signal) || transientError(error)) throw error;
            lastError = error;
        }
    }
    throw lastError || new Error('선택 재번역 후보를 해석하지 못했습니다.');
}

async function translateOutputText(source, options = {}) {
    const segmented = segmentSource(source, normalizedCharacterNameLocks());
    if (!segmented.segments.length) return assembleTranslation(segmented, new Map());
    const speakerIdentity = options.speakerIdentity || {};
    const prompt = buildOutputPrompt(segmented, settings, options.oneTimeInstruction || '', speakerIdentity);
    const translations = await requestSegments(prompt, segmented.segments, options);

    for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
        const invalid = segmented.segments.filter(segment =>
            findBannedWords(translations.get(segment.id), settings.bannedWords).length,
        );
        if (!invalid.length) break;
        const repairPrompt = buildBannedRepairPrompt(
            invalid,
            translations,
            settings,
            speakerIdentity,
            segmented.nameTokens,
        );
        const repaired = await requestSegments(repairPrompt, invalid, options);
        for (const segment of invalid) translations.set(segment.id, repaired.get(segment.id));
    }

    for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
        const invalid = findUntranslatedSegments(segmented.segments, translations, settings);
        if (!invalid.length) break;
        const repairPrompt = buildUntranslatedRepairPrompt(
            invalid,
            translations,
            settings,
            speakerIdentity,
            segmented.nameTokens,
        );
        const repaired = await requestSegments(repairPrompt, invalid, options);
        for (const segment of invalid) translations.set(segment.id, repaired.get(segment.id));
    }

    const remaining = [...translations.values()].flatMap(text => findBannedWords(text, settings.bannedWords));
    if (remaining.length) {
        throw new Error(`금지어가 계속 남아 번역을 적용하지 않았습니다: ${[...new Set(remaining)].join(', ')}`);
    }
    const untranslated = findUntranslatedSegments(segmented.segments, translations, settings);
    if (untranslated.length) {
        if (untranslated.length === segmented.segments.length) {
            throw new Error('전체 번역 결과가 외국어 원문으로 남아 번역을 적용하지 않았습니다.');
        }
        console.warn('[베르바] 일부 구간의 미번역 의심이 해소되지 않아 나머지 번역 결과를 우선 적용합니다.', untranslated);
    }
    const result = assembleTranslation(segmented, translations);
    if (!result.trim()) throw new Error('완성된 번역문이 비어 있습니다.');
    return result;
}

async function translateInputText(source, options = {}) {
    const expected = [{ id: 'seg_0000', type: 'user_input', text: source }];
    const targetGender = detectCharacterGender(currentCharacterReference()?.character);
    const prompt = buildInputPrompt(source, settings, targetGender);
    const translations = await requestSegments(prompt, expected, options);
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
    return {
        characterName: String(message?.name || context.name2 || '').trim(),
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
    return Boolean(
        left
        && right
        && left.swipeId === right.swipeId
        && left.sourceHash === right.sourceHash
        && left.translation === right.translation,
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

function updateMessageBlock(messageId, message) {
    liveContext().updateMessageBlock?.(messageId, message);
    setTimeout(refreshTranslationClasses, 40);
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

function applyTranslation(messageId, message, source, translation, chatReference) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    const record = {
        swipeId: currentSwipeId(message),
        sourceHash: hashText(source),
        translation,
        updatedAt: new Date().toISOString(),
    };
    message.extra[STATE_KEY] = record;
    message.extra.display_text = translation;
    delete message.extra[SOURCE_VIEW_KEY];
    syncOwnedTranslationToCurrentSwipe(message, record);
    updateMessageBlock(messageId, message);
    cacheRenderedTranslation(messageId, message, record);
    scheduleChatSave(chatReference);
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

async function translateMessage(messageId, options = {}) {
    const id = Number(messageId);
    if (!Number.isInteger(id)) return;
    const context = liveContext();
    const chatReference = context.chat;
    const message = chatReference?.[id];
    if (!message || message.is_user || message.is_system) return;
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
        pendingOutputs.get(id).controller.abort();
    }

    const controller = new AbortController();
    const snapshot = {
        chatReference,
        message,
        source,
        sourceHash: hashText(source),
        swipeId: currentSwipeId(message),
    };
    const toast = showProgress(options.force ? '아웃풋 전체를 다시 번역 중입니다…' : '아웃풋을 자동 번역 중입니다…');
    const work = (async () => {
        try {
            const translation = await translateOutputText(source, {
                signal: controller.signal,
                oneTimeInstruction: options.oneTimeInstruction || '',
                speakerIdentity: outputSpeakerIdentity(message),
            });
            if (controller.signal.aborted) return;
            const latestContext = liveContext();
            const latest = latestContext.chat?.[id];
            if (
                latestContext.chat !== snapshot.chatReference
                || latest !== snapshot.message
                || currentSwipeId(latest) !== snapshot.swipeId
                || hashText(messageSource(latest)) !== snapshot.sourceHash
            ) {
                console.warn('[베르바] 메시지 또는 스와이프가 바뀌어 이전 결과를 폐기했습니다.');
                return;
            }
            applyTranslation(id, latest, source, translation, snapshot.chatReference);
            failedOutputSignatures.delete(id);
            notify(options.force ? '전체 재번역을 적용했어요.' : '자동 번역을 적용했어요.', 'success');
        } catch (error) {
            if (!isAbort(error, controller.signal)) {
                failedOutputSignatures.set(id, `${snapshot.swipeId ?? 'none'}:${snapshot.sourceHash}`);
                console.error('[베르바] 출력 번역 실패', error);
                notify(`출력 번역 실패: ${errorText(error)}`, 'error');
            }
        } finally {
            clearProgress(toast);
            if (pendingOutputs.get(id)?.controller === controller) pendingOutputs.delete(id);
            refreshRetranslateButton();
        }
    })();
    pendingOutputs.set(id, { controller, work });
    refreshRetranslateButton();
    return work;
}

function latestAssistantMessage() {
    const chat = liveContext().chat || [];
    for (let id = chat.length - 1; id >= 0; id -= 1) {
        const message = chat[id];
        if (message && !message.is_user && !message.is_system && messageSource(message).trim()) {
            return { id, message };
        }
    }
    return null;
}

function requestOneTimeInstruction(scope, preview = '', viewAction = null) {
    if (document.querySelector('#verba-request-overlay')) return Promise.resolve(null);
    const isSelection = scope === 'selection';
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>${isSelection ? '선택 부분 재번역' : '최근 아웃풋 전체 재번역'}</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                ${preview ? `<div class="verba-target-preview"><b>대상</b><span>${escapeHtml(preview)}</span></div>` : ''}
                <label for="verba-request-text">이번 번역에만 적용할 요구사항</label>
                <textarea id="verba-request-text" class="text_pole" rows="5" maxlength="1200" placeholder="예: 더 직설적으로 번역해 줘 / 존댓말로 바꿔 줘"></textarea>
                <small>비워두면 현재 전역 설정대로 다시 번역해요.</small>
                <div class="verba-modal-actions">
                    ${!isSelection && viewAction
                        ? `<button type="button" class="menu_button verba-view-toggle">${escapeHtml(viewAction.label)}</button>`
                        : '<button type="button" class="menu_button verba-cancel">취소</button>'}
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
        const finish = value => {
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
        const submit = () => finish(String(textarea.value || '').trim());
        overlay.querySelector('.verba-close').addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-cancel')?.addEventListener('click', () => finish(null));
        overlay.querySelector('.verba-view-toggle')?.addEventListener('click', () => finish({
            action: 'toggle-view',
            showTranslation: Boolean(viewAction?.showTranslation),
        }));
        overlay.querySelector('.verba-submit').addEventListener('click', submit);
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
    extra[STATE_KEY] = {
        ...(stored.record || {}),
        swipeId: stored.record?.swipeId ?? swipeId,
        sourceHash: hashText(source),
        translation: nextTranslation,
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

async function retranslateLatestOutput() {
    const target = latestAssistantMessage();
    if (!target) {
        notify('재번역할 AI 아웃풋이 없어요.', 'warning');
        return;
    }
    if (pendingOutputs.has(target.id)) {
        notify('최근 아웃풋을 아직 번역 중이에요.', 'info');
        return;
    }
    const source = messageSource(target.message);
    const failedSignature = failedOutputSignatures.get(target.id);
    const isFailedOutput = failedSignature === messageVersionSignature(target.message);
    if (isPredominantlyKorean(source) && !currentRecord(target.message) && !isFailedOutput) {
        notify('최근 아웃풋이 이미 한국어라 자동 재번역 대상이 아니에요.', 'info');
        return;
    }
    const snapshot = {
        chat: liveContext().chat,
        message: target.message,
        sourceHash: hashText(source),
        swipeId: currentSwipeId(target.message),
    };
    const preview = source.replace(/\s+/g, ' ').trim().slice(0, 110);
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
    const viewAction = record
        ? {
            label: showingTranslation ? '원문 보기' : '번역본 보기',
            showTranslation: !showingTranslation,
        }
        : null;
    const instruction = await requestOneTimeInstruction('message', preview, viewAction);
    if (instruction === null) return;
    const latest = liveContext().chat?.[target.id];
    if (
        liveContext().chat !== snapshot.chat
        || latest !== snapshot.message
        || currentSwipeId(latest) !== snapshot.swipeId
        || hashText(messageSource(latest)) !== snapshot.sourceHash
    ) {
        notify('요구사항을 적는 동안 최근 아웃풋이 바뀌었어요. 다시 눌러 주세요.', 'warning');
        return;
    }
    if (typeof instruction === 'object' && instruction.action === 'toggle-view') {
        const latestRecord = currentRecord(latest);
        if (!latestRecord) {
            notify('전환할 저장 번역본을 찾지 못했어요.', 'warning');
            return;
        }
        if (instruction.showTranslation) showTranslationDisplay(target.id, latest, latestRecord);
        else showOriginalDisplay(target.id, latest, latestRecord);
        refreshRetranslateButton();
        return;
    }
    await translateMessage(target.id, { force: true, oneTimeInstruction: instruction });
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
            notify(`인풋 번역 실패로 전송하지 않았어요: ${errorText(error)}`, 'error');
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
            notify(`인풋 번역 실패로 생성을 중단했어요: ${errorText(error)}`, 'error');
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
                notify(`인풋 번역 실패로 뒤따르는 생성을 중단했어요: ${errorText(error)}`, 'error');
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

function resolveStoredSelection(storedValue, visibleSelected, visibleBefore) {
    const stored = String(storedValue || '');
    const exactIndexes = occurrenceIndexes(stored, visibleSelected);
    if (exactIndexes.length === 1) {
        return {
            start: exactIndexes[0],
            end: exactIndexes[0] + visibleSelected.length,
        };
    }

    const storedComparable = comparableTextWithMap(stored);
    const selectedComparable = comparableTextWithMap(visibleSelected).text;
    const beforeComparable = comparableTextWithMap(visibleBefore).text;
    if (!selectedComparable) return null;

    const candidateIndexes = occurrenceIndexes(storedComparable.text, selectedComparable);
    if (!candidateIndexes.length) return null;
    const ordinal = occurrenceIndexes(beforeComparable, selectedComparable).length;
    const comparableStart = candidateIndexes[ordinal]
        ?? (candidateIndexes.length === 1 ? candidateIndexes[0] : candidateIndexes.at(-1));
    const comparableEnd = comparableStart + selectedComparable.length - 1;
    const start = storedComparable.starts[comparableStart];
    const end = storedComparable.ends[comparableEnd];
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end };
}

function hideSelectionButton() {
    document.querySelector('#verba-selection-actions')?.remove();
}

function resolveSelection() {
    if (selectionBusy) return null;
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
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
    const record = message && currentRecord(message);
    if (!message || !record) return null;

    const raw = selection.toString();
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
        selected: storedSelected,
        start: storedRange.start,
        end: storedRange.end,
        rect: range.getBoundingClientRect(),
    };
}

function showSelectionButton(snapshot) {
    hideSelectionButton();
    selectionSnapshot = snapshot;
    const actions = document.createElement('div');
    actions.id = 'verba-selection-actions';
    actions.className = 'verba-selection-actions';
    if ('showPopover' in HTMLElement.prototype) actions.setAttribute('popover', 'manual');

    const retranslateButton = document.createElement('button');
    retranslateButton.type = 'button';
    retranslateButton.className = 'menu_button verba-selection-action';
    retranslateButton.textContent = '선택 부분 재번역';
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'menu_button verba-selection-action verba-name-lock-action';
    nameButton.textContent = '이름으로 고정';
    actions.append(retranslateButton, nameButton);

    const viewport = globalThis.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;
    const buttonWidth = Math.min(330, viewportWidth - 16);
    const buttonHeight = 42;
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
    actions.addEventListener('pointerdown', event => event.preventDefault());
    retranslateButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        retranslateSelection(selectionSnapshot);
    });
    nameButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        lockSelectionName(selectionSnapshot);
    });
    document.documentElement.append(actions);
    try {
        actions.showPopover?.();
    } catch {
        // Fixed positioning remains as a fallback.
    }
}

function scheduleSelectionCapture(delay = 80) {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
        const snapshot = resolveSelection();
        if (snapshot) showSelectionButton(snapshot);
        else if (!selectionBusy) hideSelectionButton();
    }, delay);
}

function selectionStillCurrent(snapshot) {
    const message = liveContext().chat?.[snapshot.messageId];
    const record = message && currentRecord(message);
    return Boolean(
        message === snapshot.message
        && record
        && currentSwipeId(message) === snapshot.swipeId
        && hashText(messageSource(message)) === snapshot.sourceHash
        && record.translation === snapshot.translation
    );
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
        const result = await requestSegments(prompt, expected, { signal: controller.signal });
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
            applyTranslation(snapshot.messageId, message, snapshot.source, updated, context.chat);
        }
        globalThis.getSelection?.()?.removeAllRanges?.();
        const historyNotice = replaceHistory && historyResult.changedRecords
            ? ` 현재 채팅의 저장 번역본 ${historyResult.changedRecords}개도 변경했어요.`
            : '';
        notify(`${sourceName}의 표기를 “${targetName}”로 이 캐릭터에 저장했어요.${historyNotice}`, 'success');
    } catch (error) {
        if (!isAbort(error, controller.signal)) {
            console.error('[베르바] 이름 고정 실패', error);
            notify(`이름 고정 실패: ${errorText(error)}`, 'error');
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
    selectionBusy = true;
    const instruction = await requestOneTimeInstruction('selection', snapshot.selected.slice(0, 110));
    if (instruction === null) {
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
        return;
    }
    if (!selectionStillCurrent(snapshot)) {
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
        notify('요구사항을 적는 동안 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        return;
    }

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
        speakerIdentity: outputSpeakerIdentity(snapshot.message),
        candidateCount: candidateMode ? 3 : 1,
    });
    const expected = [{ id: 'seg_0000', type: 'selection', text: snapshot.selected }];
    let toast = showProgress(candidateMode
        ? '선택한 부분의 번역 후보 3개를 만드는 중입니다…'
        : '선택한 부분만 다시 번역 중입니다…');
    try {
        let replacement = '';
        if (candidateMode) {
            const received = await requestSelectionCandidates(prompt, { signal: controller.signal });
            const currentKey = snapshot.selected.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
            const candidates = received.filter(candidate => {
                const text = String(candidate || '').trim();
                if (!text || text.replace(/\s+/g, ' ').toLocaleLowerCase() === currentKey) return false;
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
            const result = await requestSegments(prompt, expected, { signal: controller.signal });
            replacement = String(result.get('seg_0000') || '').trim();
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
        applyTranslation(snapshot.messageId, message, snapshot.source, updated, context.chat);
        globalThis.getSelection?.()?.removeAllRanges?.();
        notify(candidateMode ? '선택한 후보로 번역을 교체했어요.' : '선택한 부분만 다시 번역했어요.', 'success');
    } catch (error) {
        if (!isAbort(error, controller.signal)) {
            console.error('[베르바] 선택 부분 재번역 실패', error);
            notify(`선택 부분 재번역 실패: ${errorText(error)}`, 'error');
        }
    } finally {
        clearProgress(toast);
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
    }
}

function setupSelection() {
    document.addEventListener('mouseup', event => {
        if (!event.target?.closest?.('#verba-selection-actions')) scheduleSelectionCapture(40);
    });
    document.addEventListener('touchend', event => {
        if (!event.target?.closest?.('#verba-selection-actions')) {
            scheduleSelectionCapture(180);
            setTimeout(() => scheduleSelectionCapture(0), 420);
        }
    }, { passive: true });
    document.addEventListener('pointerup', event => {
        if (!event.target?.closest?.('#verba-selection-actions')) scheduleSelectionCapture(100);
    });
    document.addEventListener('contextmenu', event => {
        if (event.target?.closest?.('.mes[mesid] .mes_text')) scheduleSelectionCapture(220);
    });
    document.addEventListener('selectionchange', () => scheduleSelectionCapture(120));
    document.addEventListener('pointerdown', event => {
        if (event.target?.closest?.('#verba-selection-actions')) return;
        if (event.target?.closest?.('.mes[mesid] .mes_text')) return;
        selectionSnapshot = null;
        hideSelectionButton();
    });
    window.addEventListener('resize', hideSelectionButton);
}

function refreshTranslationClasses() {
    document.querySelectorAll('.mes[mesid]').forEach(element => {
        const id = Number(element.getAttribute('mesid'));
        const message = liveContext().chat?.[id];
        const record = message && currentRecord(message);
        const active = Boolean(record && message.extra?.display_text === record.translation);
        element.classList.toggle('verba-translation-active', active);
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
    button.title = busy
        ? '최근 아웃풋 번역 중'
        : failed
            ? '번역 실패 — 눌러서 다시 번역'
            : '최근 AI 아웃풋 전체 재번역';
}

function injectInputAction() {
    const existingActions = document.querySelector('#verba-input-actions');
    if (existingActions) {
        if (!document.querySelector('#verba-profile-toggle')) {
            existingActions.prepend(createProfileToggleButton());
        }
        refreshProfileToggleButton();
        refreshRetranslateButton();
        return;
    }
    const sendButton = document.querySelector('#send_but');
    if (!sendButton) return;
    const actions = document.createElement('div');
    actions.id = 'verba-input-actions';
    actions.className = 'verba-input-actions';
    const profileButton = createProfileToggleButton();
    const button = document.createElement('button');
    button.id = 'verba-retranslate-latest';
    button.type = 'button';
    button.className = 'verba-input-icon';
    button.textContent = '↻';
    button.title = '최근 AI 아웃풋 전체 재번역';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', retranslateLatestOutput);
    actions.append(profileButton, button);
    sendButton.before(actions);
    refreshProfileToggleButton();
    refreshRetranslateButton();
}

async function testConnection(button) {
    if (!settings.profileId) {
        notify('먼저 연결 프로필을 선택해 주세요.', 'warning');
        return;
    }
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '테스트 중…';
    try {
        const translated = await translateInputText('안녕하세요.');
        notify(`연결 성공: ${translated}`, 'success');
    } catch (error) {
        if (!isAbort(error)) notify(`연결 실패: ${errorText(error)}`, 'error');
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
                    notify(`이름 수정 실패: ${errorText(error)}`, 'error');
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
                    notify(`이름 삭제 실패: ${errorText(error)}`, 'error');
                } finally {
                    if (saveButton.isConnected) saveButton.disabled = false;
                    if (deleteButton.isConnected) deleteButton.disabled = false;
                }
            });
        });
    });
}

function injectSettingsPanel() {
    if (document.querySelector('#verba-settings')) return;
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
            <div class="inline-drawer-content">
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
                <div class="verba-help">입력창 옆 ⇄ᴬ/⇄ᴮ/⇄ᶜ 버튼으로 설정된 프로필을 순서대로 바꿀 수 있어요. 현재 프로필 요청이 실패하면 나머지 프로필을 차례로 임시 사용하며, 수동 선택 상태는 바뀌지 않습니다.</div>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-auto-input" ${settings.autoInput ? 'checked' : ''}>
                    <span>전송 시 인풋 자동번역 <small>(한국어 → 영어)</small></span>
                </label>
                <div class="verba-help">켜면 한국어 인풋을 영어로 바꾼 뒤 전송해요. 캐릭터 카드에 명시된 성별·대명사는 로컬에서 성별값만 확인하며, 카드 원문은 번역 AI에 보내지 않습니다. 실패하면 원문을 보내지 않고 생성을 중단합니다.</div>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-selection-candidates" ${settings.selectionCandidates ? 'checked' : ''}>
                    <span>선택 재번역 후보 3개 미리보기</span>
                </label>
                <div class="verba-help">선택 재번역 결과를 바로 적용하지 않고, 의미는 같지만 표현이 조금씩 다른 후보 중 하나를 고를 수 있어요.</div>

                <details id="verba-name-lock-manager" class="verba-name-lock-manager">
                    <summary>이름 고정 관리 <small>캐릭터별 저장</small></summary>
                    <div id="verba-name-lock-manager-content" class="verba-name-lock-manager-content"></div>
                </details>

                <label for="verba-global-prompt">전체 번역 전역 프롬프트</label>
                <textarea id="verba-global-prompt" class="text_pole" rows="5" placeholder="서술과 대사 모두에 적용할 문체·호칭·표현 규칙">${escapeHtml(settings.globalPrompt)}</textarea>

                <label for="verba-all-dialogue-prompt">모든 대사 공통 프롬프트</label>
                <textarea id="verba-all-dialogue-prompt" class="text_pole" rows="5" placeholder="캐릭터·유저·NPC의 모든 대사에 적용할 형식 규칙">${escapeHtml(settings.allDialoguePrompt)}</textarea>
                <div class="verba-help">모든 화자의 직접 대사에 적용해요. 대사 한영병기 같은 공통 형식은 여기에 입력하세요.</div>

                <label for="verba-dialogue-prompt">캐릭터 대사 전용 프롬프트</label>
                <textarea id="verba-dialogue-prompt" class="text_pole" rows="5" placeholder="현재 캐릭터가 말한 대사에만 적용할 말투 규칙">${escapeHtml(settings.dialoguePrompt)}</textarea>
                <div class="verba-help">아웃풋 전체 문맥에서 화자를 판단해 현재 캐릭터의 직접 대사에만 추가 적용해요. 캐릭터 고유 말투는 여기에 입력하세요.</div>

                <label for="verba-banned-words">번역 금지어</label>
                <textarea id="verba-banned-words" class="text_pole" rows="4" placeholder="한 줄에 하나씩 입력">${escapeHtml(settings.bannedWords)}</textarea>
                <div class="verba-help">금지어가 나오면 해당 문단만 다시 요청하고 정상 문단은 유지해요.</div>

            </div>
        </div>`;
    host.append(panel);
    refreshProfileSelect();
    renderNameLockManager();

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
    panel.querySelector('#verba-auto-input').addEventListener('change', event => {
        settings.autoInput = event.target.checked;
        saveSettings();
    });
    panel.querySelector('#verba-selection-candidates').addEventListener('change', event => {
        settings.selectionCandidates = event.target.checked;
        saveSettings();
    });
    panel.querySelector('#verba-global-prompt').addEventListener('input', event => {
        settings.globalPrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-all-dialogue-prompt').addEventListener('input', event => {
        settings.allDialoguePrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-dialogue-prompt').addEventListener('input', event => {
        settings.dialoguePrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-banned-words').addEventListener('input', event => {
        settings.bannedWords = event.target.value;
        saveSettings();
    });
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

function scheduleAutomaticTranslation(messageId, delay = 100) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return;
    cancelScheduledAutomaticTranslation(id);
    const timer = setTimeout(() => {
        automaticTranslationTimers.delete(id);
        if (swipeTranslationJobs.has(id)) return;
        const message = liveContext().chat?.[id];
        if (repairSwipeTranslationIndexes(message)) scheduleChatSave(liveContext().chat);
        clearStaleCurrentTranslation(id);
        translateMessage(id, { automatic: true });
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
    pendingOutputs.get(id)?.controller.abort();
    pendingOutputs.delete(id);
    selectionSnapshot = null;
    hideSelectionButton();
    scheduleSwipeTranslation(id, previousSignature, hold);
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
    if (types.CHARACTER_MESSAGE_RENDERED) {
        source.on(types.CHARACTER_MESSAGE_RENDERED, payload => {
            const id = normalizedMessageId(payload);
            const swipeJob = swipeTranslationJobs.get(id);
            if (swipeJob) {
                swipeJob.rendered = true;
                if (swipeJob.timer) clearTimeout(swipeJob.timer);
                swipeJob.timer = setTimeout(swipeJob.check, 80);
            }
            scheduleAutomaticTranslation(id, 120);
        });
    }
    if (types.MESSAGE_SWIPED) source.on(types.MESSAGE_SWIPED, handleSwipe);
    if (types.CHAT_CHANGED) {
        source.on(types.CHAT_CHANGED, () => {
            for (const pending of pendingOutputs.values()) pending.controller.abort();
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
            document.querySelectorAll('.verba-swipe-hold-active').forEach(element => {
                element.classList.remove('verba-swipe-hold-active');
                element.querySelectorAll('.verba-swipe-hold-content').forEach(hold => hold.remove());
            });
            selectionSnapshot = null;
            hideSelectionButton();
            document.querySelector('#verba-request-overlay')?.remove();
            setTimeout(() => {
                injectInputAction();
                refreshProfileSelect();
                renderNameLockManager();
                refreshTranslationClasses();
                refreshRetranslateButton();
            }, 120);
        });
    }
    if (types.MESSAGE_EDITED) {
        source.on(types.MESSAGE_EDITED, payload => {
            const id = normalizedMessageId(payload);
            scheduleAutomaticTranslation(id, 80);
        });
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
        }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function initialize() {
    injectSettingsPanel();
    injectInputAction();
    refreshTranslationClasses();
    setupAutoInput();
    setupSelection();
    setupEvents();
    setupObserver();
    globalThis.__verbaTranslatorVersion = EXTENSION_VERSION;
    console.log(`[베르바] v${EXTENSION_VERSION} 준비 완료`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 0), { once: true });
} else {
    setTimeout(initialize, 0);
}
