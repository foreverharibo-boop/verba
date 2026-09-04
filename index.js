import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import {
    assembleTranslation,
    buildBannedRepairPrompt,
    buildInputPrompt,
    buildOutputPrompt,
    buildSelectionPrompt,
    extractResponseText,
    findBannedWords,
    hasForeignText,
    hasKorean,
    hashText,
    isPredominantlyKorean,
    parseSegmentResponse,
    segmentSource,
} from './core.js';

const EXTENSION_KEY = 'verba';
const EXTENSION_VERSION = '0.1.5';
const STATE_KEY = 'verba_current_translation';
const DEFAULT_SETTINGS = {
    profileId: '',
    autoInput: false,
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
let requestTail = Promise.resolve();
let chatSaveTimer = null;
let uiRefreshTimer = null;
let inputBusy = false;
let bypassSendClick = false;
let selectionBusy = false;
let selectionSnapshot = null;
let selectionTimer = null;

function liveContext() {
    return globalThis.SillyTavern?.getContext?.() || baseContext;
}

function notify(message, type = 'info') {
    const toaster = globalThis.toastr;
    if (toaster && typeof toaster[type] === 'function') {
        toaster[type](message, '베르바');
        return;
    }
    const logger = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    logger(`[베르바] ${message}`);
}

function showProgress(message) {
    if (!globalThis.toastr?.info) return null;
    return globalThis.toastr.info(message, '베르바', {
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: false,
        closeButton: false,
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
        current = current.cause;
    }
    return parts.join(' / ') || String(error);
}

function isAbort(error, signal) {
    if (signal?.aborted || error?.name === 'AbortError') return true;
    let current = error?.cause;
    const seen = new Set();
    while (current && !seen.has(current)) {
        seen.add(current);
        if (current.name === 'AbortError') return true;
        current = current.cause;
    }
    return false;
}

function saveSettings() {
    liveContext().saveSettingsDebounced?.();
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

function refreshProfileSelect() {
    const select = document.querySelector('#verba-profile');
    if (!select) return;
    const profiles = profileList();
    select.innerHTML = '<option value="">연결 프로필을 선택하세요</option>' + profiles
        .map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)
        .join('');
    if (settings.profileId && !profiles.some(profile => profile.id === String(settings.profileId))) {
        select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(settings.profileId)}">저장된 프로필을 찾을 수 없음</option>`);
    }
    select.value = String(settings.profileId || '');
}

function enqueueRequest(task) {
    const run = requestTail.then(task, task);
    requestTail = run.catch(() => {});
    return run;
}

function transientError(error) {
    const text = errorText(error).toLowerCase();
    if (/\b(?:400|401|403|404|413|422)\b|invalid api|authentication|permission|billing|credit|context length|model.*not found/.test(text)) {
        return false;
    }
    return /\b(?:408|425|429|500|502|503|504)\b|rate.?limit|overload|capacity|temporar|timeout|timed out|network|fetch failed|connection reset|empty response|빈 응답|시간 초과/.test(text);
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
    const profileId = String(settings.profileId || '');
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
        if (timedOut) throw new Error(`응답 대기 시간 ${timeoutSeconds}초를 초과했습니다.`, { cause: error });
        if (controller.signal.aborted) throw abortError();
        throw error;
    } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener?.('abort', forwardAbort);
    }
}

async function sendWithRetry(prompt, options = {}) {
    const delays = [1500, 3000, 5000];
    let lastError;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        if (options.signal?.aborted) throw abortError();
        try {
            return await sendProfileRequest(prompt, options);
        } catch (error) {
            if (isAbort(error, options.signal)) throw error;
            lastError = error;
            if (!transientError(error) || attempt === delays.length) break;
            await wait(delays[attempt], options.signal);
        }
    }
    throw lastError || new Error('번역 요청에 실패했습니다.');
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

async function translateOutputText(source, options = {}) {
    const segmented = segmentSource(source);
    if (!segmented.segments.length) return source;
    const speakerIdentity = options.speakerIdentity || {};
    const prompt = buildOutputPrompt(segmented, settings, options.oneTimeInstruction || '', speakerIdentity);
    const translations = await requestSegments(prompt, segmented.segments, options);

    for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
        const invalid = segmented.segments.filter(segment =>
            findBannedWords(translations.get(segment.id), settings.bannedWords).length,
        );
        if (!invalid.length) break;
        const repairPrompt = buildBannedRepairPrompt(invalid, translations, settings, speakerIdentity);
        const repaired = await requestSegments(repairPrompt, invalid, options);
        for (const segment of invalid) translations.set(segment.id, repaired.get(segment.id));
    }

    const remaining = [...translations.values()].flatMap(text => findBannedWords(text, settings.bannedWords));
    if (remaining.length) {
        throw new Error(`금지어가 계속 남아 번역을 적용하지 않았습니다: ${[...new Set(remaining)].join(', ')}`);
    }
    const result = assembleTranslation(segmented, translations);
    if (!result.trim()) throw new Error('완성된 번역문이 비어 있습니다.');
    return result;
}

async function translateInputText(source, options = {}) {
    const expected = [{ id: 'seg_0000', type: 'user_input', text: source }];
    const prompt = buildInputPrompt(source, settings);
    const translations = await requestSegments(prompt, expected, options);
    const result = String(translations.get('seg_0000') || '').trim();
    if (!result) throw new Error('인풋 번역 결과가 비어 있습니다.');
    return result;
}

function currentSwipeId(message) {
    const value = Number(message?.swipe_id);
    return Number.isInteger(value) ? value : null;
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
    const swipeId = currentSwipeId(message);
    const swipe = swipeId !== null && Array.isArray(message?.swipes) ? message.swipes[swipeId] : null;
    return typeof swipe === 'string' ? swipe : String(message?.mes || '');
}

function outputSpeakerIdentity(message) {
    const context = liveContext();
    return {
        characterName: String(message?.name || context.name2 || '').trim(),
        userName: String(context.name1 || '').trim(),
    };
}

function currentRecord(message) {
    const record = message?.extra?.[STATE_KEY];
    if (!record || typeof record !== 'object') return null;
    const source = messageSource(message);
    if (record.swipeId !== currentSwipeId(message) || record.sourceHash !== hashText(source)) return null;
    if (!String(record.translation || '').trim()) return null;
    return record;
}

function updateMessageBlock(messageId, message) {
    liveContext().updateMessageBlock?.(messageId, message);
    setTimeout(refreshTranslationClasses, 40);
}

function clearOwnedDisplay(message) {
    if (!message?.extra) return false;
    const record = message.extra[STATE_KEY];
    if (record && message.extra.display_text === record.translation) delete message.extra.display_text;
    delete message.extra[STATE_KEY];
    return Boolean(record);
}

function applyTranslation(messageId, message, source, translation, chatReference) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[STATE_KEY] = {
        swipeId: currentSwipeId(message),
        sourceHash: hashText(source),
        translation,
        updatedAt: new Date().toISOString(),
    };
    message.extra.display_text = translation;
    updateMessageBlock(messageId, message);
    scheduleChatSave(chatReference);
}

function restoreCurrentDisplay(messageId, message, record) {
    if (message.extra.display_text === record.translation) return;
    message.extra.display_text = record.translation;
    updateMessageBlock(messageId, message);
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
            notify(options.force ? '전체 재번역을 적용했어요.' : '자동 번역을 적용했어요.', 'success');
        } catch (error) {
            if (!isAbort(error, controller.signal)) {
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

function requestOneTimeInstruction(scope, preview = '') {
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
                    <button type="button" class="menu_button verba-cancel">취소</button>
                    <button type="button" class="menu_button verba-submit">재번역 시작</button>
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
        overlay.querySelector('.verba-cancel').addEventListener('click', () => finish(null));
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
    if (isPredominantlyKorean(source) && !currentRecord(target.message)) {
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
    const instruction = await requestOneTimeInstruction('message', preview);
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
    const toast = showProgress('인풋을 영어로 번역 중입니다…');
    try {
        const translated = await translateInputText(source);
        if (document.querySelector('#send_textarea') !== textarea || textarea.value !== source) {
            notify('번역 중 입력 내용이 바뀌어 전송하지 않았어요.', 'warning');
            return;
        }
        setTextareaValue(textarea, translated);
        bypassSendClick = true;
        sendButton.click();
    } catch (error) {
        console.error('[베르바] 인풋 번역 실패', error);
        notify(`인풋 번역 실패로 전송하지 않았어요: ${errorText(error)}`, 'error');
    } finally {
        clearProgress(toast);
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
    const toast = showProgress('인풋을 영어로 번역 중입니다…');
    try {
        const translated = await translateInputText(source);
        if (textarea.value !== source) {
            blockGenerationAndRestore(textarea, source);
            return;
        }
        setTextareaValue(textarea, translated);
    } catch (error) {
        console.error('[베르바] 생성 전 인풋 번역 실패', error);
        notify(`인풋 번역 실패로 생성을 중단했어요: ${errorText(error)}`, 'error');
        blockGenerationAndRestore(textarea, source);
    } finally {
        clearProgress(toast);
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

    const work = (async () => {
        try {
            const translated = await translateInputText(source);
            if (liveContext().chat !== context.chat || context.chat?.[id] !== message || message.mes !== source) return;
            message.mes = translated;
            updateMessageBlock(id, message);
            scheduleChatSave(context.chat);
        } catch (error) {
            console.error('[베르바] 전송된 인풋 번역 실패', error);
            notify(`인풋 번역 실패로 뒤따르는 생성을 중단했어요: ${errorText(error)}`, 'error');
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
        const htmlTag = rest.match(/^<[^>\n]{1,500}>/);
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
    document.querySelector('#verba-selection-retranslate')?.remove();
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
    const button = document.createElement('button');
    button.id = 'verba-selection-retranslate';
    button.type = 'button';
    button.className = 'menu_button verba-selection-retranslate';
    button.textContent = '선택 부분 재번역';
    if ('showPopover' in HTMLElement.prototype) button.setAttribute('popover', 'manual');
    const viewport = globalThis.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;
    const buttonWidth = 160;
    const buttonHeight = 40;
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
    button.style.setProperty('left', `${left}px`, 'important');
    button.style.setProperty('top', `${top}px`, 'important');
    button.style.setProperty('right', 'auto', 'important');
    button.style.setProperty('bottom', 'auto', 'important');
    button.style.setProperty('transform', 'none', 'important');
    button.style.setProperty('z-index', '2147483646', 'important');
    button.style.setProperty('margin', '0', 'important');
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        retranslateSelection(selectionSnapshot);
    });
    document.documentElement.append(button);
    try {
        button.showPopover?.();
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
    const prompt = buildSelectionPrompt({
        source: snapshot.source,
        translation: snapshot.translation,
        selected: snapshot.selected,
        start: snapshot.start,
        end: snapshot.end,
        settings,
        oneTimeInstruction: instruction,
        speakerIdentity: outputSpeakerIdentity(snapshot.message),
    });
    const expected = [{ id: 'seg_0000', type: 'selection', text: snapshot.selected }];
    const toast = showProgress('선택한 부분만 다시 번역 중입니다…');
    try {
        const result = await requestSegments(prompt, expected, { signal: controller.signal });
        const replacement = String(result.get('seg_0000') || '').trim();
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
        notify('선택한 부분만 다시 번역했어요.', 'success');
    } catch (error) {
        console.error('[베르바] 선택 부분 재번역 실패', error);
        notify(`선택 부분 재번역 실패: ${errorText(error)}`, 'error');
    } finally {
        clearProgress(toast);
        selectionBusy = false;
        selectionSnapshot = null;
        hideSelectionButton();
    }
}

function setupSelection() {
    document.addEventListener('mouseup', event => {
        if (!event.target?.closest?.('#verba-selection-retranslate')) scheduleSelectionCapture(40);
    });
    document.addEventListener('touchend', event => {
        if (!event.target?.closest?.('#verba-selection-retranslate')) {
            scheduleSelectionCapture(180);
            setTimeout(() => scheduleSelectionCapture(0), 420);
        }
    }, { passive: true });
    document.addEventListener('pointerup', event => {
        if (!event.target?.closest?.('#verba-selection-retranslate')) scheduleSelectionCapture(100);
    });
    document.addEventListener('contextmenu', event => {
        if (event.target?.closest?.('.mes[mesid] .mes_text')) scheduleSelectionCapture(220);
    });
    document.addEventListener('selectionchange', () => scheduleSelectionCapture(120));
    document.addEventListener('pointerdown', event => {
        if (event.target?.closest?.('#verba-selection-retranslate')) return;
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
        element.classList.toggle('verba-translation-active', Boolean(record && message.extra?.display_text === record.translation));
    });
}

function refreshRetranslateButton() {
    const button = document.querySelector('#verba-retranslate-latest');
    if (!button) return;
    const target = latestAssistantMessage();
    const busy = target ? pendingOutputs.has(target.id) : false;
    button.disabled = !target || busy;
    button.classList.toggle('verba-busy', busy);
    button.title = busy ? '최근 아웃풋 번역 중' : '최근 AI 아웃풋 전체 재번역';
}

function injectInputAction() {
    if (document.querySelector('#verba-input-actions')) {
        refreshRetranslateButton();
        return;
    }
    const sendButton = document.querySelector('#send_but');
    if (!sendButton) return;
    const actions = document.createElement('div');
    actions.id = 'verba-input-actions';
    actions.className = 'verba-input-actions';
    const button = document.createElement('button');
    button.id = 'verba-retranslate-latest';
    button.type = 'button';
    button.className = 'verba-input-icon';
    button.textContent = '↻';
    button.title = '최근 AI 아웃풋 전체 재번역';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', retranslateLatestOutput);
    actions.append(button);
    sendButton.before(actions);
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
        notify(`연결 실패: ${errorText(error)}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = oldText;
    }
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

                <label for="verba-profile">번역기 전용 연결 프로필</label>
                <div class="verba-profile-row">
                    <select id="verba-profile" class="text_pole"></select>
                    <button type="button" id="verba-refresh-profiles" class="menu_button">새로고침</button>
                </div>
                <button type="button" id="verba-test-profile" class="menu_button verba-wide">연결 테스트</button>

                <label class="verba-check-row">
                    <input type="checkbox" id="verba-auto-input" ${settings.autoInput ? 'checked' : ''}>
                    <span>전송 시 인풋 자동번역 <small>(한국어 → 영어)</small></span>
                </label>
                <div class="verba-help">켜면 한국어 인풋을 영어로 바꾼 뒤 전송해요. 실패하면 원문을 보내지 않고 생성을 중단합니다.</div>

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

    panel.querySelector('#verba-profile').addEventListener('change', event => {
        settings.profileId = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-refresh-profiles').addEventListener('click', refreshProfileSelect);
    panel.querySelector('#verba-test-profile').addEventListener('click', event => testConnection(event.currentTarget));
    panel.querySelector('#verba-auto-input').addEventListener('change', event => {
        settings.autoInput = event.target.checked;
        saveSettings();
    });
    panel.querySelector('#verba-global-prompt').addEventListener('change', event => {
        settings.globalPrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-all-dialogue-prompt').addEventListener('change', event => {
        settings.allDialoguePrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-dialogue-prompt').addEventListener('change', event => {
        settings.dialoguePrompt = event.target.value;
        saveSettings();
    });
    panel.querySelector('#verba-banned-words').addEventListener('change', event => {
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
        clearStaleCurrentTranslation(id);
        translateMessage(id, { automatic: true });
        refreshRetranslateButton();
    }, delay);
    automaticTranslationTimers.set(id, timer);
}

function scheduleSwipeTranslation(messageId, previousSignature = '') {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return;
    cancelScheduledAutomaticTranslation(id);

    const previousJob = swipeTranslationJobs.get(id);
    if (previousJob?.timer) clearTimeout(previousJob.timer);

    const job = {
        startedAt: Date.now(),
        previousSignature,
        candidateSignature: '',
        stableChecks: 0,
        timer: null,
    };
    swipeTranslationJobs.set(id, job);

    const check = () => {
        if (swipeTranslationJobs.get(id) !== job) return;
        const message = liveContext().chat?.[id];
        const signature = messageVersionSignature(message);
        const elapsed = Date.now() - job.startedAt;

        // MESSAGE_SWIPED can fire before SillyTavern changes swipe_id. Never
        // translate the owned, previous swipe while that transition is pending.
        if (!message || (job.previousSignature && signature === job.previousSignature)) {
            if (elapsed < 1800) {
                job.timer = setTimeout(check, 90);
            } else {
                swipeTranslationJobs.delete(id);
            }
            return;
        }

        if (signature !== job.candidateSignature) {
            job.candidateSignature = signature;
            job.stableChecks = 0;
            job.timer = setTimeout(check, 90);
            return;
        }

        job.stableChecks += 1;
        if (job.stableChecks < 1) {
            job.timer = setTimeout(check, 90);
            return;
        }

        swipeTranslationJobs.delete(id);
        clearStaleCurrentTranslation(id);
        translateMessage(id, { automatic: true });
        refreshRetranslateButton();
    };

    job.timer = setTimeout(check, 120);
}

function handleSwipe(payload) {
    const id = normalizedMessageId(payload);
    if (id < 0) return;
    const message = liveContext().chat?.[id];
    const previousSignature = storedRecordSignature(message?.extra?.[STATE_KEY]);
    pendingOutputs.get(id)?.controller.abort();
    pendingOutputs.delete(id);
    selectionSnapshot = null;
    hideSelectionButton();
    scheduleSwipeTranslation(id, previousSignature);
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
            scheduleAutomaticTranslation(id, 120);
        });
    }
    if (types.MESSAGE_SWIPED) source.on(types.MESSAGE_SWIPED, handleSwipe);
    if (types.CHAT_CHANGED) {
        source.on(types.CHAT_CHANGED, () => {
            for (const pending of pendingOutputs.values()) pending.controller.abort();
            pendingOutputs.clear();
            for (const timer of automaticTranslationTimers.values()) clearTimeout(timer);
            automaticTranslationTimers.clear();
            for (const job of swipeTranslationJobs.values()) clearTimeout(job.timer);
            swipeTranslationJobs.clear();
            selectionSnapshot = null;
            hideSelectionButton();
            document.querySelector('#verba-request-overlay')?.remove();
            setTimeout(() => {
                injectInputAction();
                refreshProfileSelect();
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
