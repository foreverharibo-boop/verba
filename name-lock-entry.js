// A direct entry route remains usable when the browser cannot map a selection.
export function nameLockEntryMarkup(prefix, reference, escapeHtml) {
    const disabled = reference ? '' : 'disabled';
    const name = reference?.character?.name || '';
    return `<section class="${prefix}-name-lock-entry">
        <b>이름 직접 등록</b>
        <div class="${prefix}-help">${reference
            ? `${escapeHtml(name)} 카드에 저장합니다. 페르소나·NPC 이름도 등록할 수 있어요.`
            : '등록할 상대 캐릭터의 개별 채팅을 먼저 열어 주세요.'}</div>
        <label for="${prefix}-name-entry-source">원문 이름</label>
        <input id="${prefix}-name-entry-source" class="text_pole" maxlength="120" placeholder="예: Dana" ${disabled}>
        <label for="${prefix}-name-entry-target">번역할 이름</label>
        <input id="${prefix}-name-entry-target" class="text_pole" maxlength="120" placeholder="예: 다나" ${disabled}>
        <button type="button" id="${prefix}-name-entry-save" class="menu_button ${prefix}-wide" ${disabled}>이름 등록·저장</button>
        <div class="${prefix}-help">다음 번역부터 적용합니다. 이미 번역된 메시지는 재번역해 주세요. 같은 원문 이름은 입력한 표기로 갱신합니다.</div>
    </section>`;
}

export function bindNameLockEntry({ content, prefix, reference, currentReference, save, refresh, notify, reportError }) {
    const source = content.querySelector(`#${prefix}-name-entry-source`);
    const target = content.querySelector(`#${prefix}-name-entry-target`);
    const button = content.querySelector(`#${prefix}-name-entry-save`);
    if (!reference || !source || !target || !button) return;
    let busy = false;
    const submit = async () => {
        if (busy) return;
        const active = currentReference();
        if (!active || active.character !== reference.character || active.characterId !== reference.characterId) {
            notify('채팅이 바뀌었어요. 이름 고정 관리를 다시 열어 주세요.', 'warning');
            refresh();
            return;
        }
        const original = source.value.trim();
        const translated = target.value.trim();
        if (!original || !translated) {
            notify('원문 이름과 번역할 이름을 모두 입력해 주세요.', 'warning');
            (!original ? source : target).focus();
            return;
        }
        busy = true;
        button.disabled = true;
        try {
            await save(original, translated, reference);
            refresh();
            notify(`${original} → ${translated} 저장했어요. 다음 번역부터 적용됩니다.`, 'success');
        } catch (error) {
            reportError('name-lock-add', error, `이름 등록 실패: ${error?.message || String(error)}`);
        } finally {
            busy = false;
            if (button.isConnected) button.disabled = false;
        }
    };
    button.addEventListener('click', submit);
    for (const input of [source, target]) input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        void submit();
    });
}
