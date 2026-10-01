// Presentation only: no AI requests, translation changes, or settings writes.
const DOCK_KEY = Symbol.for('sillytavern.translationNoticeDock.v1');
const QUICK_REPLY_SELECTOR = '#qr--bar';

function visibleRect(element, viewport) {
    if (!element || element.hidden) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
        && rect.bottom > viewport.top && rect.top < viewport.top + viewport.height
        && rect.right > viewport.left && rect.left < viewport.left + viewport.width
        ? rect : null;
}

export function noticeAnchor(doc = document) {
    const vv = globalThis.visualViewport;
    const viewport = {
        left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0,
        width: vv?.width || globalThis.innerWidth,
        height: vv?.height || globalThis.innerHeight,
    };
    const textarea = visibleRect(doc.querySelector('#send_textarea'), viewport);
    const form = visibleRect(doc.querySelector('#send_form'), viewport);
    const quickReply = visibleRect(doc.querySelector(QUICK_REPLY_SELECTOR), viewport);
    // ST's inline bar is #qr--bar. Its detached draggable popout is not the composer.
    const anchor = quickReply || textarea || form || visibleRect(doc.querySelector('#send_but'), viewport);
    return { viewport, top: anchor?.top ?? viewport.top + viewport.height - 80,
        horizontal: form || textarea || anchor, quickReply: Boolean(quickReply) };
}

function createDock() {
    const host = document.createElement('div');
    host.id = 'st-translation-notice-dock';
    host.setAttribute('aria-label', '번역기 알림');
    if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
    const handles = new Set();
    let frame = 0;
    let observer = null;
    let resizeObserver = null;
    let observed = new Set();
    let listening = false;

    function position() {
        frame = 0;
        if (!host.isConnected) return;
        const { viewport, top, horizontal } = noticeAnchor();
        const gap = 8;
        const available = Math.max(48, top - viewport.top - gap - 8);
        const compact = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
        host.style.setProperty('max-height', `${Math.min(compact ? 190 : 280, viewport.height * 0.42, available)}px`, 'important');
        host.style.setProperty('width', `${Math.min(compact ? 260 : 340, viewport.width - 16)}px`, 'important');
        const rect = host.getBoundingClientRect();
        const desiredLeft = !compact && horizontal
            ? horizontal.right - rect.width
            : (horizontal ? horizontal.left + horizontal.width / 2 : viewport.left + viewport.width / 2) - rect.width / 2;
        const left = Math.max(viewport.left + 8, Math.min(desiredLeft, viewport.left + viewport.width - rect.width - 8));
        const y = Math.max(viewport.top + 8, Math.min(top - gap - rect.height, viewport.top + viewport.height - rect.height - 8));
        host.style.setProperty('left', `${left}px`, 'important');
        host.style.setProperty('top', `${y}px`, 'important');
        if (resizeObserver) {
            const next = new Set([host, document.querySelector('#send_form'), document.querySelector('#send_textarea'), document.querySelector(QUICK_REPLY_SELECTOR)].filter(Boolean));
            for (const el of observed) if (!next.has(el)) resizeObserver.unobserve(el);
            for (const el of next) if (!observed.has(el)) resizeObserver.observe(el);
            observed = next;
        }
    }
    function schedule() {
        if (!frame) frame = requestAnimationFrame(position);
    }
    function start() {
        if (!host.isConnected) (document.body || document.documentElement).append(host);
        try { host.showPopover?.(); } catch { /* Fixed-position fallback. */ }
        if (!listening) {
            listening = true;
            window.addEventListener('resize', schedule);
            window.addEventListener('scroll', schedule, true);
            globalThis.visualViewport?.addEventListener('resize', schedule);
            globalThis.visualViewport?.addEventListener('scroll', schedule);
            if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(schedule);
            if (typeof MutationObserver !== 'undefined') {
                observer = new MutationObserver(records => {
                    if (records.some(record => record.target !== host && !host.contains(record.target))) schedule();
                });
                observer.observe(document.body || document.documentElement, { subtree: true, childList: true,
                    attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
            }
        }
        position();
    }
    function stop() {
        if (handles.size) { schedule(); return; }
        observer?.disconnect(); resizeObserver?.disconnect(); observed.clear();
        observer = null; resizeObserver = null;
        window.removeEventListener('resize', schedule);
        window.removeEventListener('scroll', schedule, true);
        globalThis.visualViewport?.removeEventListener('resize', schedule);
        globalThis.visualViewport?.removeEventListener('scroll', schedule);
        if (frame) cancelAnimationFrame(frame);
        frame = 0; listening = false;
        try { host.hidePopover?.(); } catch { /* Already hidden. */ }
        host.remove();
    }
    function mount(handle) {
        handles.add(handle);
        host.append(handle.element);
        // Keep transient bursts compact, never discard a progress/cancel/return control.
        const transient = [...handles].filter(item => item.transient);
        while (transient.length > 3) transient.shift().close();
        start();
    }
    return { host, handles, mount, schedule, position,
        unmount(handle) { handles.delete(handle); handle.element.remove(); stop(); } };
}

// Console-only previews reuse the installed renderer: no dynamic imports or AI.
export function createNoticePreview({ prefix, title }) {
    const ui = createNoticeUI({ prefix: prefix + '-preview', title: title + ' · 테스트' });
    const handles = new Set();
    const rows = {
        '성공': ['success', '전체 재번역을 적용했어요.'],
        '안내': ['info', '선택한 아웃풋을 아직 번역 중이에요.'],
        '주의': ['warning', '번역기 전용 연결 프로필을 선택해 주세요.'],
        '실패': ['error', '번역 요청에 실패했어요.\n서버 응답 시간이 초과됐어요.'],
        '진행': ['progress', '아웃풋 전체를 다시 번역 중입니다…'],
        '취소가능': ['progress', '인풋을 영어로 번역 중입니다…'],
        '재시도': ['retry', '연결이 불안정해 다시 시도할게요.\n1/3회 · 5초 후 재시도'],
        '원래위치': ['return', '이전 번역으로 이동했어요.'],
    };
    const close = () => { handles.forEach(handle => handle.close()); handles.clear(); };
    function add(name, automatic = false) {
        if (!rows[name]) { console.warn('알림 종류: ' + Object.keys(rows).join(', ')); return null; }
        const [type, message] = rows[name];
        const options = { type };
        if (!automatic) options.timeout = 0;
        if (name === '취소가능' || name === '재시도') options.onCancel = () => {};
        if (name === '원래위치') options.actions = [{ label: '원래 위치로 돌아가기', onClick: handle => handle.close() }];
        const handle = ui.show(message, options);
        handles.add(handle);
        return handle;
    }
    return {
        show(name = '성공', automatic = false) { close(); return add(name, automatic); },
        all() { close(); Object.keys(rows).forEach(name => add(name)); },
        close,
    };
}

export function createNoticeUI({ prefix, title }) {
    let dock;
    const getDock = () => dock ||= (globalThis[DOCK_KEY] ||= createDock());
    const lifetime = { success: 3000, info: 4000, warning: 6000, error: 10000 };
    const icons = { success: 'fa-circle-check', info: 'fa-circle-info', warning: 'fa-triangle-exclamation',
        error: 'fa-circle-exclamation', progress: 'fa-spinner', retry: 'fa-rotate-right', return: 'fa-arrow-turn-up' };

    function show(message, { type = 'info', id = '', timeout = lifetime[type] ?? 0, onCancel, actions = [], onDismiss } = {}) {
        const manager = getDock();
        if (id) [...manager.handles].find(item => item.element.id === id)?.close();
        const element = document.createElement('div');
        element.className = 'st-translation-notice';
        element.dataset.type = type;
        element.dataset.owner = prefix;
        element.setAttribute('aria-label', title + ' 알림');
        if (id) element.id = id;
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
        const icon = document.createElement('i');
        icon.className = `st-translation-notice-icon fa-solid ${icons[type] || icons.info}`;
        icon.setAttribute('aria-hidden', 'true');
        const body = document.createElement('div');
        body.className = 'st-translation-notice-body';
        const brand = document.createElement('div');
        brand.className = 'st-translation-notice-brand'; brand.textContent = title;
        const text = document.createElement('div');
        text.className = 'st-translation-notice-text'; text.textContent = String(message || '');
        body.append(brand, text);
        element.append(icon, body);
        let timer = null;
        let deadline = 0;
        let remaining = timeout;
        const handle = {
            element, transient: timeout > 0, closed: false,
            update(value) { if (!handle.closed) { text.textContent = String(value); manager.schedule(); } },
            close() {
                if (handle.closed) return;
                handle.closed = true;
                clearTimeout(timer);
                manager.unmount(handle);
                onDismiss?.();
            },
        };
        element.noticeHandle = handle;
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'st-translation-notice-close'; close.textContent = '×';
        close.setAttribute('aria-label', type === 'return' ? '원래 위치 알림 닫기'
            : timeout ? '알림 닫기' : '알림만 닫기 · 요청은 계속 진행');
        close.addEventListener('click', () => handle.close());
        element.append(close);
        const controls = [...actions];
        if (typeof onCancel === 'function') controls.push({ label: type === 'retry' ? '재시도 취소' : '번역 취소',
            onClick: async () => { await onCancel(); handle.close(); } });
        for (const action of controls) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = `st-translation-notice-action ${action.className || ''}`.trim();
            button.textContent = action.label;
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await action.onClick?.(handle); }
                finally { if (!handle.closed) button.disabled = false; }
            });
            body.append(button);
        }
        const resume = () => {
            if (!timeout || handle.closed) return;
            clearTimeout(timer);
            deadline = Date.now() + remaining;
            timer = setTimeout(() => handle.close(), remaining);
        };
        const pause = () => { if (timeout && timer) { clearTimeout(timer); timer = null; remaining = Math.max(0, deadline - Date.now()); } };
        element.addEventListener('pointerenter', pause);
        element.addEventListener('pointerleave', () => { if (!element.contains(document.activeElement)) resume(); });
        element.addEventListener('focusin', pause);
        element.addEventListener('focusout', event => { if (!element.contains(event.relatedTarget)) resume(); });
        manager.mount(handle);
        resume();
        return handle;
    }
    return { show, reposition: () => dock?.position(), remove: element => element?.noticeHandle?.close() };
}
