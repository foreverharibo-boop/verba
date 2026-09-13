import { defaultBaseTranslationPrompt } from './core.js';

const modes = ['scoped', 'mixed'];
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export function normalizeBaseTranslationCustom(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const result = { enabled: raw.enabled === true, selectedId: '', name: String(raw.name || '').slice(0, 60), presets: [], draft: {} };
    for (const mode of modes) {
        result[mode] = typeof raw[mode] === 'string' && raw[mode].trim()
            ? raw[mode] : defaultBaseTranslationPrompt(mode);
        result.draft[mode] = typeof raw.draft?.[mode] === 'string' ? raw.draft[mode] : result[mode];
    }
    const ids = new Set();
    for (const row of Array.isArray(raw.presets) ? raw.presets : []) {
        if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
            || typeof row.name !== 'string' || !row.name.trim()
            || modes.some(mode => typeof row[mode] !== 'string' || !row[mode].trim())) continue;
        ids.add(row.id);
        result.presets.push({ id: row.id, name: row.name.trim().slice(0, 60), scoped: row.scoped, mixed: row.mixed });
    }
    if (result.presets.some(row => row.id === raw.selectedId)) result.selectedId = raw.selectedId;
    return result;
}

export function baseTranslationEditorMarkup(state) {
    const changed = modes.some(mode => state.draft[mode] !== state[mode]);
    return `<details id="verba-base-editor" class="verba-tool-details">
        <summary>기본 번역 지침 편집 <small>전용 프리셋</small></summary>
        <div class="verba-tool-details-content">
            <div class="verba-help">내장 기본 지침을 대체합니다. 필수 출력 형식·기존 사용자 프롬프트·미세조정·이름 고정·금지어는 별도로 유지됩니다. 분리·통합 번역과 해당 복구 요청에 적용되며, 인풋·선택 재번역·별도 검수 지침은 편집하지 않습니다.</div>
            <label class="verba-check-row"><input id="verba-base-enabled" type="checkbox" ${state.enabled ? 'checked' : ''}><span>저장한 기본 지침 사용</span></label>
            <div class="verba-help">개발자 모드를 끄면 기본값을 사용합니다. 편집 내용과 전용 프리셋은 보관됩니다.</div>
            <select id="verba-base-preset" class="text_pole" aria-label="기본 지침 전용 프리셋">
                <option value="">전용 프리셋 선택</option>
                ${state.presets.map(row => `<option value="${escape(row.id)}" ${row.id === state.selectedId ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}
            </select>
            <input id="verba-base-name" class="text_pole" maxlength="60" value="${escape(state.name)}" placeholder="전용 프리셋 이름" aria-label="기본 지침 프리셋 이름">
            <div class="verba-base-buttons">
                <button type="button" class="menu_button" data-verba-base-action="new">새 프리셋 저장</button>
                <button type="button" class="menu_button" data-verba-base-action="overwrite" ${state.selectedId ? '' : 'disabled'}>선택 프리셋 덮어쓰기</button>
                <button type="button" class="menu_button" data-verba-base-action="delete" ${state.selectedId ? '' : 'disabled'}>선택 프리셋 삭제</button>
            </div>
            <label for="verba-base-scoped">분리 번역 기본 지침 · 기본 경로</label>
            <textarea id="verba-base-scoped" class="text_pole" rows="10" spellcheck="false">${escape(state.draft.scoped)}</textarea>
            <details class="verba-tool-details">
                <summary>통합 번역 기본 지침 · 대체 경로</summary>
                <div class="verba-help">통합 번역에서도 같은 취향을 사용하려면 이 지침도 수정하세요. 프리셋에는 두 지침이 함께 저장됩니다.</div>
                <textarea id="verba-base-mixed" class="text_pole" rows="10" spellcheck="false" aria-label="통합 번역 기본 지침">${escape(state.draft.mixed)}</textarea>
            </details>
            <small id="verba-base-status">${state.enabled ? '저장한 지침 적용 중' : '기본값 사용 중'}${changed ? ' · 미적용 편집 내용 있음' : ''} · 분리 ${state.draft.scoped.length.toLocaleString()}자 / 통합 ${state.draft.mixed.length.toLocaleString()}자</small>
            <div class="verba-base-buttons">
                <button type="button" class="menu_button" data-verba-base-action="apply">저장·적용</button>
                <button type="button" class="menu_button" data-verba-base-action="restore">기본값 복원</button>
            </div>
            <div class="verba-help">입력 중인 내용은 보관되며 ‘저장·적용’ 또는 프리셋 저장 후 요청에 반영됩니다. 프리셋을 선택하면 즉시 적용됩니다. 이미 시작한 요청과 기존 번역문은 소급 변경하지 않습니다.</div>
        </div>
    </details>`;
}

// Delegate to the persistent settings panel: developer mode replaces its own
// subtree, so attaching directly to editor controls would lose their handlers.
export function bindBaseTranslationEditor(panel, settings, { save, notify, confirm = message => globalThis.confirm(message) }) {
    const state = () => settings.baseTranslationCustom;
    const render = () => {
        const old = panel.querySelector('#verba-base-editor');
        if (!old) return;
        const open = old.open;
        const holder = document.createElement('div');
        holder.innerHTML = baseTranslationEditorMarkup(state());
        const next = holder.firstElementChild;
        next.open = open;
        old.replaceWith(next);
    };
    const validDraft = () => {
        if (modes.some(mode => !state().draft[mode].trim())) {
            notify('분리·통합 기본 지침을 모두 입력해 주세요. 원래 지침은 기본값 복원으로 되돌릴 수 있어요.', 'warning');
            return false;
        }
        return true;
    };
    const applyDraft = () => {
        for (const mode of modes) state()[mode] = state().draft[mode];
        state().enabled = true;
    };
    panel.addEventListener('input', event => {
        if (!settings.developerMode) return;
        const id = event.target?.id;
        const mode = modes.find(key => id === `verba-base-${key}`);
        if (mode) {
            state().draft[mode] = event.target.value;
            const status = panel.querySelector('#verba-base-status');
            if (status) status.textContent = `${state().enabled ? '저장한 지침 적용 중' : '기본값 사용 중'} · 미적용 편집 내용 있음 · 분리 ${state().draft.scoped.length.toLocaleString()}자 / 통합 ${state().draft.mixed.length.toLocaleString()}자`;
            save();
        } else if (id === 'verba-base-name') {
            state().name = event.target.value.slice(0, 60);
            save();
        }
    });
    panel.addEventListener('change', event => {
        if (!settings.developerMode) return;
        if (event.target?.id === 'verba-base-enabled') {
            state().enabled = event.target.checked;
            save();
            render();
        } else if (event.target?.id === 'verba-base-preset') {
            const preset = state().presets.find(row => row.id === event.target.value);
            state().selectedId = preset?.id || '';
            if (preset) {
                state().name = preset.name;
                for (const mode of modes) state().draft[mode] = preset[mode];
                applyDraft();
                notify(`기본 지침 프리셋 “${preset.name}”을 적용했어요.`, 'success');
            }
            save();
            render();
        }
    });
    panel.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-verba-base-action]');
        if (!button || !settings.developerMode || button.disabled) return;
        const action = button.dataset.verbaBaseAction;
        event.preventDefault();
        if (action === 'restore') {
            if (!confirm('편집 중인 두 기본 지침을 기본값으로 복원할까요? 전용 프리셋과 기존 번역 설정은 유지됩니다.')) return;
            for (const mode of modes) state().draft[mode] = state()[mode] = defaultBaseTranslationPrompt(mode);
            state().enabled = false;
            state().selectedId = '';
            state().name = '';
        } else if (action === 'delete') {
            const preset = state().presets.find(row => row.id === state().selectedId);
            if (!preset || !confirm(`기본 지침 프리셋 “${preset.name}”을 삭제할까요? 현재 지침은 유지됩니다.`)) return;
            state().presets = state().presets.filter(row => row.id !== preset.id);
            state().selectedId = '';
        } else if (action === 'apply' || action === 'new' || action === 'overwrite') {
            if (!validDraft()) return;
            if (action !== 'apply') {
                const name = state().name.trim();
                if (!name) { notify('전용 프리셋 이름을 입력해 주세요.', 'warning'); return; }
                const previous = state().presets.find(row => row.id === state().selectedId);
                if (action === 'overwrite' && !previous) return;
                const id = action === 'overwrite' ? previous.id : (globalThis.crypto?.randomUUID?.() || `base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                const preset = { id, name, scoped: state().draft.scoped, mixed: state().draft.mixed };
                if (action === 'overwrite') state().presets = state().presets.map(row => row.id === id ? preset : row);
                else state().presets.push(preset);
                state().selectedId = id;
                state().name = name;
            }
            applyDraft();
        } else return;
        save();
        render();
        notify(action === 'delete' ? '전용 프리셋을 삭제했어요.' : action === 'restore' ? '기본 번역 지침을 복원했어요.' : '기본 번역 지침을 저장하고 적용했어요.', 'success');
    });
}
