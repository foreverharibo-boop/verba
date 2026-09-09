import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import {
    assembleTranslation,
    buildBannedRepairPrompt,
    buildInputPrompt,
    buildMultiSelectionPrompt,
    buildNameHistoryFormsPrompt,
    buildNameMatchPrompt,
    buildOutputPrompt,
    buildRoleTermPlanPrompt,
    buildSelectionPrompt,
    buildTermConsistencyRepairPrompt,
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
    restoreProtected,
    segmentSource,
} from './core.js';

const EXTENSION_KEY = 'verba';
const EXTENSION_VERSION = '0.3.23';
const TOUCH_SELECTION_QUIET_MS = 2000;
const STATE_KEY = 'verba_current_translation';
const SOURCE_VIEW_KEY = 'verba_source_view';
const CHARACTER_FIELD_KEY = 'verba';
const DEVELOPER_PASSWORD_HASH = '39fc1a167edd36664f4d0fdf869c6ec8d9681018ffff05ba2dc30fb9dce81e4b';
const DEFAULT_SETTINGS = {
    profileId: '',
    fallbackProfileId: '',
    thirdProfileId: '',
    activeProfileSlot: 'A',
    autoInput: false,
    selectionCandidates: false,
    selectionQuickCount: 2,
    showSelectionName: true,
    showSelectionSource: true,
    showSelectionLock: true,
    showSelectionBundle: true,
    profileStats: null,
    globalPrompt: '',
    allDialoguePrompt: '',
    dialoguePrompt: '',
    bannedWords: '',
    maxTokens: 15000,
    timeoutSeconds: 120,
    developerMode: false,
};

const baseContext = getContext();
extension_settings[EXTENSION_KEY] = Object.assign(
    {},
    DEFAULT_SETTINGS,
    extension_settings[EXTENSION_KEY] || {},
);
const settings = extension_settings[EXTENSION_KEY];
settings.profileStats = normalizeProfileStats(settings.profileStats);
settings.developerMode = settings.developerMode === true;
settings.selectionQuickCount = Math.min(5, Math.max(2, Number(settings.selectionQuickCount) || 2));
delete settings.debugMode;
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
let messageCopyHoldTimer = null;
let messageCopyPointerId = null;
let messageCopyStart = null;
let messageCopyHoldShown = false;
let suppressMessageCopyClickUntil = 0;
let developerTapCount = 0;
let developerTapTimer = null;
let developerModeBusy = false;
let multiSelectionState = null;
let selectionHighlightTimer = null;
let selectionGestureActive = false;
let selectionNeedsCapture = false;
let selectionPointerType = '';
let preservedGestureSelection = null;
let lastTouchSelectionAt = 0;
let lastDesktopSelectionPlacement = null;
let lastDesktopSelectionAt = 0;

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
    notice.append(text);
    notice.append(close);
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

function sha256HexFallback(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const constants = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    const rotateRight = (number, count) => (number >>> count) | (number << (32 - count));

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getUint32(offset + index * 4, false);
        }
        for (let index = 16; index < 64; index += 1) {
            const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
            const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    return [...hash].map(part => part.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    try {
        const subtle = globalThis.crypto?.subtle;
        if (subtle) {
            const digest = await subtle.digest('SHA-256', bytes);
            return [...new Uint8Array(digest)]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch (error) {
        console.warn('[베르바] 브라우저 SHA-256을 사용할 수 없어 호환 방식으로 확인합니다.', error);
    }
    return sha256HexFallback(value);
}

function syncDeveloperModeUi() {
    const enabled = settings.developerMode === true;
    document.body?.classList.toggle('verba-developer-mode', enabled);
    document.documentElement?.classList.toggle('verba-developer-mode', enabled);
    if (!enabled) clearMultiSelection();
    globalThis.__verbaDeveloperMode = enabled;
    document.dispatchEvent(new CustomEvent('verba:developer-mode-changed', {
        detail: { enabled },
    }));
}

async function toggleDeveloperMode() {
    if (developerModeBusy) return;
    if (settings.developerMode) {
        settings.developerMode = false;
        saveSettings();
        syncDeveloperModeUi();
        notify('개발자 모드를 잠갔어요.', 'success');
        return;
    }

    const password = globalThis.prompt?.('개발자 모드 비밀번호를 입력하세요.');
    if (password === null || password === undefined) return;

    developerModeBusy = true;
    try {
        const hash = await sha256Hex(password);
        if (hash !== DEVELOPER_PASSWORD_HASH) {
            notify('비밀번호가 맞지 않아요.', 'error');
            return;
        }
        settings.developerMode = true;
        saveSettings();
        syncDeveloperModeUi();
        notify('개발자 모드를 열었어요.', 'success');
    } catch (error) {
        notify(`개발자 모드 확인 실패: ${errorText(error)}`, 'error');
    } finally {
        developerModeBusy = false;
    }
}

function registerDeveloperModeTap() {
    developerTapCount += 1;
    clearTimeout(developerTapTimer);
    developerTapTimer = setTimeout(() => {
        developerTapCount = 0;
        developerTapTimer = null;
    }, 5000);

    if (developerTapCount < 7) return;
    developerTapCount = 0;
    clearTimeout(developerTapTimer);
    developerTapTimer = null;
    toggleDeveloperMode();
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

function emptyProfileStat() {
    return {
        requests: 0,
        successes: 0,
        failures: 0,
        totalMs: 0,
        retries: 0,
        fallbacks: 0,
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
    if (fallback) stat.fallbacks += 1;
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
        const averageSeconds = stat.requests ? stat.totalMs / stat.requests / 1000 : 0;
        const averageLabel = averageSeconds.toLocaleString('ko-KR', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        });
        const profile = configuredProfiles().find(candidate => candidate.slot === slot);
        const name = profile ? profileDisplayName(profile.id) : '미설정';
        return `<div class="verba-stat-row">
            <b>${slot}</b>
            <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <small>요청 ${stat.requests} · 성공 ${successRate}% · 평균 ${averageLabel}초 · 재시도 ${stat.retries} · 대체 ${stat.fallbacks}</small>
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
            attemptSucceeded = true;
            return response;
        });
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
                if (profiles.fallbacks.length && fallbackEligibleError(primaryError)) {
                    for (const fallback of profiles.fallbacks) {
                        console.warn(`[베르바] 현재 선택 프로필 실패 — 프로필 ${fallback.slot} ${profileDisplayName(fallback.id)}(으)로 임시 전환`, errors.at(-1));
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

function restoredSegmentText(value, segmented, useSourceNames = false) {
    const nameTokens = (segmented.nameTokens || []).map(entry => ({
        token: entry.token,
        value: useSourceNames ? entry.source : entry.value,
    }));
    const namesRestored = restoreProtected(value, nameTokens, { strict: false });
    return restoreProtected(namesRestored, segmented.tokens, { strict: false });
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
    return terms.some(term => new RegExp(`(^|[^A-Za-z])${term}(?=$|[^A-Za-z])`, 'i').test(source));
}

async function planRepeatedRoleTermLocks(segmented, options = {}) {
    const terms = repeatedRoleTerms(segmented?.segments);
    if (!terms.length) return [];
    const sourceContext = (segmented.segments || []).map(segment => String(segment.text || '')).join('\n\n');
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
        return terms.flatMap((term, index) => {
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
    const terms = repeatedRoleTerms(segmented?.segments);
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
        const key = `${id}\u0000${source}`;
        if (!source || !translation || seen.has(key)) return [];
        seen.add(key);
        return [{ id, source, translation }];
    });
}

function lockedSegmentKey(entry) {
    return `${String(entry?.id || '')}\u0000${String(entry?.source || '').trim()}`;
}

function translationWithLockedSegments(translated, lockedSegments) {
    const locks = normalizedLockedSegments(lockedSegments);
    let translation = String(translated?.translation || '');
    let sourceMap = normalizedSourceMap(translated?.sourceMap);
    if (!locks.length || !sourceMap.length) return { translation, sourceMap, lockedSegments: locks };

    const replacements = locks.flatMap(lock => {
        const row = sourceMap.find(candidate => lockedSegmentKey(candidate) === lockedSegmentKey(lock));
        return row ? [{ ...row, replacement: lock.translation }] : [];
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
    const prompt = buildOutputPrompt(segmented, settings, options.oneTimeInstruction || '', speakerIdentity);
    const translations = await requestSegments(prompt, segmented.segments, {
        ...options,
        stage: options.stage || 'output-translation',
    });

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
        const repaired = await requestSegments(repairPrompt, invalid, { ...options, stage: 'banned-word-repair' });
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
        const repaired = await requestSegments(repairPrompt, invalid, { ...options, stage: 'untranslated-repair' });
        for (const segment of invalid) translations.set(segment.id, repaired.get(segment.id));
    }

    // Planned terms are protected and no longer appear as plain source words
    // here. The fallback therefore checks only any repeated roles that could
    // not be planned, without touching already locked terminology.
    await repairRepeatedRoleTermConsistency(segmented, translations, {
        signal: options.signal,
    });

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
            && lock.translation === other?.translation;
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
                speakerIdentity: outputSpeakerIdentity(message),
                stage: options.force ? 'output-retranslation' : 'output-translation',
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
            const finalTranslation = translationWithLockedSegments(
                translated,
                snapshot.previousRecord?.lockedSegments,
            );
            applyTranslation(
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
    const isMultiSelection = scope === 'multi';
    const isPartialSelection = isSelection || isMultiSelection;
    const showContextChoice = settings.developerMode && isPartialSelection;
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'verba-request-overlay';
        overlay.className = 'verba-overlay';
        if ('showPopover' in HTMLElement.prototype) overlay.setAttribute('popover', 'manual');
        overlay.innerHTML = `
            <section class="verba-modal" role="dialog" aria-modal="true">
                <header class="verba-modal-header">
                    <strong>${isMultiSelection ? '여러 구간 묶음 재번역' : isSelection ? '선택 부분 재번역' : '최근 아웃풋 전체 재번역'}</strong>
                    <button type="button" class="verba-close" aria-label="닫기">✕</button>
                </header>
                ${preview ? `<div class="verba-target-preview"><b>대상</b><span>${escapeHtml(preview)}</span></div>` : ''}
                <label for="verba-request-text">이번 번역에만 적용할 요구사항</label>
                <textarea id="verba-request-text" class="text_pole" rows="5" maxlength="1200" placeholder="예: 더 직설적으로 번역해 줘 / 존댓말로 바꿔 줘"></textarea>
                <small>비워두면 현재 전역 설정대로 다시 번역해요.</small>
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
                    ${isPartialSelection
                        ? ''
                        : viewAction
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
        const submit = () => {
            const instruction = String(textarea.value || '').trim();
            if (!showContextChoice) {
                finish(instruction);
                return;
            }
            finish({
                instruction,
                contextMode: overlay.querySelector('input[name="verba-context-mode"]:checked')?.value || 'paragraph',
            });
        };
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
    if (exactIndexes.length === 1) {
        return {
            start: exactIndexes[0],
            end: exactIndexes[0] + visibleSelected.length,
        };
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
    if (selectedLoose.text.length < 2) return null;
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
        const lockedKeys = new Set(normalizedLockedSegments(record.lockedSegments).map(lockedSegmentKey));
        for (const row of normalizedSourceMap(record.sourceMap)) {
            if (!lockedKeys.has(lockedSegmentKey(row))) continue;
            const range = highlightRangeForStoredOffsets(
                messageId,
                record.translation,
                row.start,
                row.end,
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
    document.querySelector('#verba-selection-anchor')?.remove();
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
            notify(`원문 복사 실패: ${errorText(error)}`, 'error');
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

function insertSelectionDomAnchor(range) {
    if (!range) return null;
    try {
        const anchor = document.createElement('span');
        anchor.id = 'verba-selection-anchor';
        anchor.style.setProperty('display', 'inline-block', 'important');
        anchor.style.setProperty('position', 'relative', 'important');
        anchor.style.setProperty('width', '0', 'important');
        anchor.style.setProperty('height', '1em', 'important');
        anchor.style.setProperty('padding', '0', 'important');
        anchor.style.setProperty('margin', '0', 'important');
        anchor.style.setProperty('vertical-align', 'text-bottom', 'important');
        anchor.style.setProperty('pointer-events', 'none', 'important');
        const insertion = range.cloneRange();
        insertion.collapse(false);
        insertion.insertNode(anchor);
        return anchor;
    } catch {
        return null;
    }
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
    const domAnchor = !touchSelectionRecentlyActive()
        ? insertSelectionDomAnchor(snapshot.anchorRange)
        : null;
    if (!domAnchor && 'showPopover' in HTMLElement.prototype) actions.setAttribute('popover', 'manual');

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
    if (settings.developerMode && settings.showSelectionLock !== false) {
        availableActions.push(createAction(
            selectionIsLocked(snapshot) ? '잠금 해제' : '구간 잠금',
            'verba-segment-lock-action verba-developer-only',
            () => toggleSelectionLock(selectionSnapshot),
        ));
    }
    if (settings.developerMode && settings.showSelectionBundle !== false) {
        availableActions.push(createAction(
            '묶음 추가',
            'verba-bundle-add-action verba-developer-only',
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
    if (domAnchor) {
        domAnchor.append(actions);
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
    if (domAnchor) {
        const anchorRect = domAnchor.getBoundingClientRect();
        const centeredLeft = anchorRect.left - (buttonWidth / 2);
        const viewportLeftPosition = Math.min(
            Math.max(viewportLeft + 8, centeredLeft),
            viewportLeft + viewportWidth - buttonWidth - 8,
        );
        actions.style.setProperty('position', 'absolute', 'important');
        actions.style.setProperty('left', `${viewportLeftPosition - anchorRect.left}px`, 'important');
        actions.style.setProperty('top', `${domAnchor.offsetHeight + 8}px`, 'important');
        actions.style.setProperty('pointer-events', 'auto', 'important');
    } else {
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
    }
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
    selectionTimer = setTimeout(() => {
        const snapshot = resolveSelection() || (preserved ? resolveSelection(preserved) : null);
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

function selectionIsLocked(snapshot) {
    if (!snapshot) return false;
    const record = currentSelectionRecord(snapshot.message);
    const rows = selectionSourceRows(snapshot);
    if (!record || !rows.length) return false;
    const lockedKeys = new Set(normalizedLockedSegments(record.lockedSegments).map(lockedSegmentKey));
    return rows.every(row => lockedKeys.has(lockedSegmentKey(row)));
}

function selectionTouchesLocked(snapshot) {
    if (!snapshot) return false;
    const record = currentRecord(snapshot.message);
    if (!record) return false;
    const lockedKeys = new Set(normalizedLockedSegments(record.lockedSegments).map(lockedSegmentKey));
    return selectionSourceRows(snapshot).some(row => lockedKeys.has(lockedSegmentKey(row)));
}

function toggleSelectionLock(snapshot) {
    if (!settings.developerMode || !snapshot || selectionBusy) return;
    if (!selectionStillCurrent(snapshot)) {
        notify('선택한 뒤 번역문이 바뀌었어요. 다시 드래그해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    const rows = selectionSourceRows(snapshot);
    if (!rows.length) {
        notify('이 번역에는 구간 정보가 없어 잠글 수 없어요. 새로 번역한 메시지에서 사용해 주세요.', 'warning');
        hideSelectionButton();
        return;
    }
    const record = currentSelectionRecord(snapshot.message);
    const existing = normalizedLockedSegments(record.lockedSegments);
    const targetKeys = new Set(rows.map(lockedSegmentKey));
    const unlock = rows.every(row => existing.some(lock => lockedSegmentKey(lock) === lockedSegmentKey(row)));
    const nextLocks = unlock
        ? existing.filter(lock => !targetKeys.has(lockedSegmentKey(lock)))
        : [
            ...existing.filter(lock => !targetKeys.has(lockedSegmentKey(lock))),
            ...rows.map(row => ({
                id: row.id,
                source: row.source,
                translation: snapshot.translation.slice(row.start, row.end),
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
    globalThis.getSelection?.()?.removeAllRanges?.();
    selectionSnapshot = null;
    hideSelectionButton();
    notify(unlock ? '선택한 번역 구간의 잠금을 해제했어요.' : `번역 구간 ${rows.length}개를 잠갔어요.`, 'success');
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

    for (const message of chat) {
        clearLocksFromExtra(message?.extra);
        if (Array.isArray(message?.swipe_info)) {
            message.swipe_info.forEach(swipe => clearLocksFromExtra(swipe?.extra));
        }
    }
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
    if (!settings.developerMode || !multiSelectionState?.ranges?.length) return;
    const tray = document.createElement('div');
    tray.id = 'verba-multi-selection-tray';
    // This tray is already gated by developerMode above. Giving it the generic
    // developer-only class made some SillyTavern themes keep it display:none.
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
    if (!settings.developerMode || !snapshot || selectionBusy) return;
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
    if (!settings.developerMode || !state || selectionBusy) return;
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
    if (!bundleStillCurrent(state)) {
        selectionBusy = false;
        clearMultiSelection();
        notify('요구사항을 적는 동안 번역문이 바뀌었어요.', 'warning');
        return;
    }

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
        speakerIdentity: outputSpeakerIdentity(state.message),
        contextMode,
    });
    const controller = new AbortController();
    let toast = showProgress(`선택한 ${selections.length}개 구간을 한꺼번에 다시 번역 중입니다…`);
    try {
        const result = await requestSegments(prompt, expected, { signal: controller.signal, stage: 'multi-selection-retranslation' });
        const replacements = selections.map(row => {
            const replacement = String(result.get(row.id) || '').trim();
            if (!replacement) throw new Error('묶음 재번역 결과 중 비어 있는 구간이 있습니다.');
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
            notify(`묶음 재번역 실패: ${errorText(error)}`, 'error');
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
        contextMode,
        sourceContext: selectionSourceContext(snapshot, contextMode),
    });
    const expected = [{ id: 'seg_0000', type: 'selection', text: snapshot.selected }];
    const replacementKey = value => String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
    const currentKey = replacementKey(snapshot.selected);
    let toast = showProgress(candidateMode
        ? '선택한 부분의 번역 후보 3개를 만드는 중입니다…'
        : '선택한 부분만 다시 번역 중입니다…');
    try {
        let replacement = '';
        if (candidateMode) {
            const received = await requestSelectionCandidates(prompt, { signal: controller.signal, stage: 'selection-candidates' });
            const candidates = received.filter(candidate => {
                const text = String(candidate || '').trim();
                if (!text || replacementKey(text) === currentKey) return false;
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
            replacement = String(result.get('seg_0000') || '').trim();
            if (!replacement || replacementKey(replacement) === currentKey) {
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
                replacement = String(result.get('seg_0000') || '').trim();
            }
            if (replacementKey(replacement) === currentKey) {
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
    document.addEventListener('pointercancel', () => {
        selectionGestureActive = false;
        selectionNeedsCapture = false;
        selectionPointerType = '';
        preservedGestureSelection = null;
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
        if (selectionGestureActive) {
            selectionNeedsCapture = true;
            preservedGestureSelection = captureSelectionState() || preservedGestureSelection;
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
                notify(`메시지 복사 실패: ${errorText(error)}`, 'error');
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
    button.title = busy
        ? '최근 아웃풋 번역 중'
        : failed
            ? '번역 실패 — 눌러서 다시 번역'
            : '최근 AI 아웃풋 전체 재번역';
}

function createRetranslateButton() {
    const button = document.createElement('button');
    button.id = 'verba-retranslate-latest';
    button.type = 'button';
    button.className = 'verba-input-icon';
    button.textContent = '↻';
    button.title = '최근 AI 아웃풋 전체 재번역';
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
            notify(`프로필 ${profileSlot} “${profileDisplayName(profileId)}” 연결 실패: ${errorText(error)}`, 'error');
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
                <div class="verba-help">입력창 옆 ⇄ᴬ/⇄ᴮ/⇄ᶜ 버튼으로 설정된 프로필을 순서대로 바꿀 수 있어요. 현재 프로필 요청이 실패하면 나머지 프로필을 차례로 임시 사용하며, 수동 선택 상태는 바뀌지 않습니다.</div>

                <details id="verba-profile-stats" class="verba-tool-details">
                    <summary>프로필 성능 기록 <small>로컬 통계</small></summary>
                    <div class="verba-tool-details-content">
                        <div id="verba-profile-stats-content" class="verba-profile-stats-content"></div>
                        <div class="verba-help">A/B/C별 실제 요청 수·성공률·평균 응답 시간·재시도·자동 대체 횟수만 기기에 저장합니다.</div>
                        <button type="button" id="verba-reset-profile-stats" class="menu_button verba-wide">성능 기록 초기화</button>
                    </div>
                </details>

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
                            <span>구간 잠금 메뉴에 포함 <small>(개발자 모드)</small></span>
                        </label>
                        <label class="verba-check-row">
                            <input type="checkbox" id="verba-show-selection-bundle" ${settings.showSelectionBundle !== false ? 'checked' : ''}>
                            <span>묶음 추가 메뉴에 포함 <small>(개발자 모드)</small></span>
                        </label>
                        <div class="verba-help">선택 부분 재번역을 포함해 지정한 개수까지만 바로 표시하고, 남은 기능은 ⋯을 누르면 세로로 열려요. 5개를 선택하면 모두 한 줄에 표시할 수 있습니다.</div>
                    </div>
                </details>

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
    renderProfileStats();
    syncDeveloperModeUi();

    panel.querySelector('.verba-drawer-header').addEventListener('click', registerDeveloperModeTap);

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
    clearTransientTranslationSelections();
    pendingOutputs.get(id)?.controller.abort();
    pendingOutputs.delete(id);
    selectionSnapshot = null;
    hideSelectionButton();
    scheduleSwipeTranslation(id, previousSignature, hold);
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
            clearMultiSelection();
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
    syncDeveloperModeUi();
    injectSettingsPanel();
    injectInputAction();
    refreshTranslationClasses();
    setupAutoInput();
    setupMessageCopyHold();
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
