// Clipboard restrictions must not prevent exporting a complete diagnostic.
export function downloadDebugText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    try {
        document.documentElement.append(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        // Mobile browsers may consume the object URL after the click returns.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
}

export async function exportDebugText(text, { copy, filename, fileOnly = false, download = downloadDebugText }) {
    if (!fileOnly) {
        try {
            await copy(text);
            return 'clipboard';
        } catch {
            // Keep the exact snapshot, including Unicode and long reports.
        }
    }
    await download(text, filename);
    return 'file';
}
