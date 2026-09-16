// The enlarged editor forwards edits to the original textarea, so the existing
// settings save, conflict inspector and delayed backup remain authoritative.
export function bindPromptExpandEditors(panel) {
    const doc = panel.ownerDocument;
    const win = doc.defaultView;
    for (const source of panel.querySelectorAll('.verba-prompt-slot > textarea')) {
        const header = source.parentElement.querySelector('.verba-prompt-slot-head');
        if (!header || header.querySelector('.verba-prompt-expand')) continue;
        const title = header.querySelector('label')?.textContent.trim() || '프롬프트';
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'menu_button verba-prompt-expand';
        button.textContent = '확대';
        button.title = `${title} 크게 편집`;
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-haspopup', 'dialog');
        header.insertBefore(button, header.querySelector('.verba-prompt-slot-toggle'));

        button.addEventListener('click', () => {
            if (doc.getElementById('verba-prompt-editor')) return;
            const dialog = doc.createElement('dialog');
            dialog.id = 'verba-prompt-editor';
            dialog.setAttribute('aria-labelledby', 'verba-prompt-editor-title');
            const heading = doc.createElement('strong');
            heading.id = 'verba-prompt-editor-title';
            heading.textContent = title;
            const editor = doc.createElement('textarea');
            editor.id = 'verba-prompt-editor-text';
            editor.className = 'text_pole';
            editor.setAttribute('aria-labelledby', heading.id);
            editor.value = source.value;
            editor.placeholder = source.placeholder;
            editor.spellcheck = source.spellcheck;
            const close = doc.createElement('button');
            close.type = 'button';
            close.className = 'menu_button verba-prompt-editor-close';
            close.textContent = '닫기';
            dialog.append(heading, editor, close);

            const sync = () => {
                if (source.value === editor.value) return;
                source.value = editor.value;
                source.dispatchEvent(new win.Event('input', { bubbles: true }));
            };
            editor.addEventListener('input', sync);
            editor.addEventListener('change', sync);
            editor.addEventListener('compositionend', sync);

            // Android/iOS keyboards shrink or pan the visual viewport. Size the
            // editor to that visible area so its sole close button stays in reach.
            const viewport = win.visualViewport;
            const resize = () => {
                for (const [key, value] of Object.entries({
                    width: viewport?.width ?? win.innerWidth,
                    height: viewport?.height ?? win.innerHeight,
                    left: viewport?.offsetLeft ?? 0,
                    top: viewport?.offsetTop ?? 0,
                })) dialog.style.setProperty(`--verba-editor-${key}`, `${value}px`);
            };
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                editor.blur();
                sync();
                source.setSelectionRange(editor.selectionStart, editor.selectionEnd, editor.selectionDirection);
                source.scrollTop = editor.scrollTop;
                viewport?.removeEventListener('resize', resize);
                viewport?.removeEventListener('scroll', resize);
                win.removeEventListener('resize', resize);
                if (dialog.open) dialog.close();
                dialog.remove();
                if (button.isConnected) button.focus({ preventScroll: true });
            };
            close.addEventListener('click', finish);
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                finish();
            });
            dialog.addEventListener('close', finish);
            doc.documentElement.append(dialog);
            resize();
            viewport?.addEventListener('resize', resize);
            viewport?.addEventListener('scroll', resize);
            win.addEventListener('resize', resize);
            dialog.showModal();
            editor.focus({ preventScroll: true });
            editor.setSelectionRange(source.selectionStart, source.selectionEnd, source.selectionDirection);
            editor.scrollTop = source.scrollTop;
        });
    }
}
