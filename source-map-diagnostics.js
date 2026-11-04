// Local diagnostics only. Never retain RP text, DOM nodes, or message objects.
export function sourceMapSummary(record, hashText, selection = null) {
    const translation = String(record?.translation || '');
    const raw = Array.isArray(record?.sourceMap) ? record.sourceMap : [];
    const rows = raw.flatMap((entry, index) => {
        const source = String(entry?.source || '').trim();
        const start = Number(entry?.start);
        const end = Number(entry?.end);
        if (!source || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return [];
        return [{
            index,
            id: String(entry?.id || `seg_${index}`).slice(0, 100),
            start, end,
            inBounds: start >= 0 && end <= translation.length,
            sourceLength: source.length,
            sourceHash: hashText(source),
            translationHash: hashText(translation.slice(start, end)),
        }];
    });
    const hasSelection = Number.isInteger(selection?.start) && Number.isInteger(selection?.end)
        && selection.end > selection.start;
    const overlaps = hasSelection
        ? rows.filter(row => selection.start < row.end && selection.end > row.start) : [];
    // Include rows around the selected range even in exceptionally long messages.
    const selectedIndexes = new Set(overlaps.map(row => row.index));
    const shown = [...rows.filter(row => selectedIndexes.has(row.index)),
        ...rows.filter(row => !selectedIndexes.has(row.index))].slice(0, 80)
        .sort((a, b) => a.index - b.index);
    return {
        present: Boolean(record),
        hasMapArray: Array.isArray(record?.sourceMap),
        translationLength: translation.length,
        translationHash: hashText(translation),
        rawRowCount: raw.length,
        validRowCount: rows.length,
        invalidRowCount: raw.length - rows.length,
        outOfBoundsCount: rows.filter(row => !row.inBounds).length,
        mapHash: hashText(JSON.stringify(rows)),
        rows: shown,
        omittedRowCount: rows.length - shown.length,
        ...(hasSelection ? {
            selection: {
                start: selection.start, end: selection.end,
                inBounds: selection.start >= 0 && selection.end <= translation.length,
                selectedLength: String(selection.selected || '').length,
                selectedHash: hashText(String(selection.selected || '')),
                matchesStoredSlice: translation.slice(selection.start, selection.end) === String(selection.selected || ''),
                overlapCount: overlaps.length,
                outcome: overlaps.length ? 'mapped' : rows.length ? 'unmapped-selection' : 'no-usable-map',
            },
        } : {}),
    };
}

export function createSourceViewDiagnostics({ enabled, hashText }) {
    const events = [];
    return {
        record(snapshot, currentRecord = null) {
            if (!enabled() || !snapshot) return;
            events.push({
                at: Date.now(),
                messageId: Number.isInteger(snapshot.messageId) ? snapshot.messageId : null,
                swipeId: snapshot.swipeId ?? null,
                sourceLength: String(snapshot.source || '').length,
                sourceHash: hashText(String(snapshot.source || '')),
                snapshot: sourceMapSummary(snapshot, hashText, snapshot),
                current: sourceMapSummary(currentRecord, hashText, snapshot),
                translationMatchesCurrent: Boolean(currentRecord && snapshot.translation === currentRecord.translation),
            });
            if (events.length > 4) events.shift();
        },
        diagnostics() {
            return {
                enabled: enabled(),
                events: enabled() ? JSON.parse(JSON.stringify(events)) : [],
                limitation: 'Local source-view attempts and saved offsets only; no RP text. Hashes are non-cryptographic. These snapshots do not prove which earlier translation stage created or removed a row.',
            };
        },
    };
}
