import { defaultBaseTranslationPrompt, legacyBaseTranslationPrompt } from './core.js';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function migratedPrompt(raw, draft = false) {
    const direct = draft
        ? (typeof raw.draft === 'string' ? raw.draft : raw.draft?.prompt)
        : raw.prompt;
    if (typeof direct === 'string') return direct;

    const legacyContainer = draft && raw.draft && typeof raw.draft === 'object'
        ? raw.draft
        : raw;
    const scoped = typeof legacyContainer.scoped === 'string' ? legacyContainer.scoped : '';
    const mixed = typeof legacyContainer.mixed === 'string' ? legacyContainer.mixed : '';
    const unchangedLegacyDefaults = scoped === legacyBaseTranslationPrompt('scoped')
        && mixed === legacyBaseTranslationPrompt('mixed');
    if (unchangedLegacyDefaults) return defaultBaseTranslationPrompt();
    if (scoped && scoped !== legacyBaseTranslationPrompt('scoped')) return scoped;
    if (mixed && mixed !== legacyBaseTranslationPrompt('mixed')) return mixed;
    return scoped || mixed || defaultBaseTranslationPrompt();
}

export function normalizeBaseTranslationCustom(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const prompt = migratedPrompt(raw);
    const draft = migratedPrompt(raw, true);
    const result = {
        enabled: raw.enabled === true && Boolean(prompt.trim()),
        selectedId: '',
        name: String(raw.name || '').slice(0, 60),
        presets: [],
        prompt: prompt.trim() ? prompt : defaultBaseTranslationPrompt(),
        draft,
    };
    const ids = new Set();
    for (const row of Array.isArray(raw.presets) ? raw.presets : []) {
        if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
            || typeof row.name !== 'string' || !row.name.trim()
        ) continue;
        const presetPrompt = migratedPrompt(row);
        if (!presetPrompt.trim()) continue;
        ids.add(row.id);
        result.presets.push({ id: row.id, name: row.name.trim().slice(0, 60), prompt: presetPrompt });
    }
    if (result.presets.some(row => row.id === raw.selectedId)) result.selectedId = raw.selectedId;
    return result;
}

export function baseTranslationEditorMarkup(state) {
    const changed = state.draft !== state.prompt;
    return `<details id="verba-deep-base-editor" class="verba-deep-tool-details">
        <summary>🧪 기본 번역 지침 편집 <small>전용 프리셋</small></summary>
        <div class="verba-deep-tool-details-content">
            <div class="verba-deep-help">긴르바 실험실가 모든 아웃풋 번역에 기본으로 보내는 번역 지침입니다. 필수 출력 형식·구간 처리와 기존 사용자 프롬프트·미세조정·이름 고정·금지어는 긴르바 실험실가 별도로 붙입니다.</div>
            <label class="verba-deep-check-row"><input id="verba-deep-base-enabled" type="checkbox" ${state.enabled ? 'checked' : ''}><span>저장한 기본 지침 사용</span></label>
            <div class="verba-deep-help">개발자 모드를 끄면 기본값을 사용합니다. 편집 내용과 전용 프리셋은 보관됩니다.</div>
            <select id="verba-deep-base-preset" class="text_pole" aria-label="기본 지침 전용 프리셋">
                <option value="">전용 프리셋 선택</option>
                ${state.presets.map(row => `<option value="${escape(row.id)}" ${row.id === state.selectedId ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}
            </select>
            <input id="verba-deep-base-name" class="text_pole" maxlength="60" value="${escape(state.name)}" placeholder="전용 프리셋 이름" aria-label="기본 지침 프리셋 이름">
            <div class="verba-deep-base-buttons">
                <button type="button" class="menu_button" data-verba-deep-base-action="new" title="새 프리셋 저장" aria-label="새 프리셋 저장">새로 저장</button>
                <button type="button" class="menu_button" data-verba-deep-base-action="rename" title="선택 프리셋 이름 변경" aria-label="선택 프리셋 이름 변경" ${state.selectedId ? '' : 'disabled'}>이름 변경</button>
                <button type="button" class="menu_button" data-verba-deep-base-action="delete" title="선택 프리셋 삭제" aria-label="선택 프리셋 삭제" ${state.selectedId ? '' : 'disabled'}>삭제</button>
            </div>
            <label for="verba-deep-base-prompt">기본 번역 지침</label>
            <textarea id="verba-deep-base-prompt" class="text_pole" rows="14" spellcheck="false">${escape(state.draft)}</textarea>
            <small id="verba-deep-base-status">${state.enabled ? '저장한 지침 적용 중' : '기본값 사용 중'}${changed ? ' · 미적용 편집 내용 있음' : ''} · ${state.draft.length.toLocaleString()}자</small>
            <div class="verba-deep-base-buttons">
                <button type="button" class="menu_button" data-verba-deep-base-action="apply">저장·적용</button>
                <button type="button" class="menu_button" data-verba-deep-base-action="restore">기본값 복원</button>
            </div>
            <div class="verba-deep-help">입력 중인 내용은 보관되며 ‘저장·적용’ 또는 프리셋 저장 후 모든 아웃풋 번역 요청에 반영됩니다. 프리셋을 선택하면 즉시 적용됩니다. 이미 시작한 요청과 기존 번역문은 소급 변경하지 않습니다.</div>
        </div>
    </details>`;
}

// Delegate to the persistent settings panel: developer mode replaces its own
// subtree, so attaching directly to editor controls would lose their handlers.
export function bindBaseTranslationEditor(panel, settings, { save, notify, confirm = message => globalThis.confirm(message) }) {
    const state = () => settings.baseTranslationCustom;
    const render = () => {
        const old = panel.querySelector('#verba-deep-base-editor');
        if (!old) return;
        const open = old.open;
        const holder = document.createElement('div');
        holder.innerHTML = baseTranslationEditorMarkup(state());
        const next = holder.firstElementChild;
        next.open = open;
        old.replaceWith(next);
    };
    const validDraft = () => {
        if (!state().draft.trim()) {
            notify('기본 번역 지침을 입력해 주세요. 원래 지침은 기본값 복원으로 되돌릴 수 있어요.', 'warning');
            return false;
        }
        return true;
    };
    const applyDraft = () => {
        state().prompt = state().draft;
        state().enabled = true;
    };
    panel.addEventListener('input', event => {
        if (!settings.developerMode) return;
        const id = event.target?.id;
        if (id === 'verba-deep-base-prompt') {
            state().draft = event.target.value;
            const status = panel.querySelector('#verba-deep-base-status');
            if (status) status.textContent = `${state().enabled ? '저장한 지침 적용 중' : '기본값 사용 중'} · 미적용 편집 내용 있음 · ${state().draft.length.toLocaleString()}자`;
            save();
        } else if (id === 'verba-deep-base-name') {
            state().name = event.target.value.slice(0, 60);
            save();
        }
    });
    panel.addEventListener('change', event => {
        if (!settings.developerMode) return;
        if (event.target?.id === 'verba-deep-base-enabled') {
            state().enabled = event.target.checked;
            save();
            render();
        } else if (event.target?.id === 'verba-deep-base-preset') {
            const preset = state().presets.find(row => row.id === event.target.value);
            state().selectedId = preset?.id || '';
            if (preset) {
                state().name = preset.name;
                state().draft = preset.prompt;
                applyDraft();
                notify(`기본 지침 프리셋 “${preset.name}”을 적용했어요.`, 'success');
            }
            save();
            render();
        }
    });
    panel.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-verba-deep-base-action]');
        if (!button || !settings.developerMode || button.disabled) return;
        const action = button.dataset.verbaDeepBaseAction;
        event.preventDefault();
        if (action === 'restore') {
            if (!confirm('편집 중인 기본 번역 지침을 기본값으로 복원할까요? 전용 프리셋과 기존 번역 설정은 유지됩니다.')) return;
            state().draft = state().prompt = defaultBaseTranslationPrompt();
            state().enabled = false;
            state().selectedId = '';
            state().name = '';
        } else if (action === 'delete') {
            const preset = state().presets.find(row => row.id === state().selectedId);
            if (!preset || !confirm(`기본 지침 프리셋 “${preset.name}”을 삭제할까요? 현재 지침은 유지됩니다.`)) return;
            state().presets = state().presets.filter(row => row.id !== preset.id);
            state().selectedId = '';
        } else if (action === 'rename') {
            const preset = state().presets.find(row => row.id === state().selectedId);
            const name = state().name.trim();
            if (!preset) return;
            if (!name) {
                notify('변경할 프리셋 이름을 입력해 주세요.', 'warning');
                return;
            }
            state().presets = state().presets.map(row => (
                row.id === preset.id ? { ...row, name } : row
            ));
            state().name = name;
        } else if (action === 'apply' || action === 'new') {
            if (!validDraft()) return;
            if (action === 'new') {
                const name = state().name.trim();
                if (!name) { notify('전용 프리셋 이름을 입력해 주세요.', 'warning'); return; }
                const id = globalThis.crypto?.randomUUID?.() || `base-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const preset = { id, name, prompt: state().draft };
                state().presets.push(preset);
                state().selectedId = id;
                state().name = name;
            }
            applyDraft();
            if (action === 'apply' && state().selectedId) {
                state().presets = state().presets.map(row => (
                    row.id === state().selectedId ? { ...row, prompt: state().prompt } : row
                ));
            }
        } else return;
        save();
        render();
        notify(
            action === 'delete'
                ? '전용 프리셋을 삭제했어요.'
                : action === 'restore'
                    ? '기본 번역 지침을 복원했어요.'
                    : action === 'rename'
                        ? '전용 프리셋 이름을 변경했어요.'
                        : '기본 번역 지침을 저장하고 적용했어요.',
            'success',
        );
    });
}
