'use strict';

// Work only on a separate translation-source copy. The original provider reply
// is preserved so SillyTavern and Ttotto can collect and remove their own tag.
const MACHINE_BLOCK = /<(scene_state|sfw_scene)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu;

function verifiedBlocks(text) {
    const source = String(text ?? '');
    const spans = [];
    for (const match of source.matchAll(MACHINE_BLOCK)) {
        let payload;
        try { payload = JSON.parse(match[2].trim()); } catch { continue; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
        // Require a recognizable scene schema, not arbitrary RP markup.
        if (!('scene' in payload || 'characters' in payload || 'location' in payload
            || 'heat' in payload || 'intensity' in payload || 'stage' in payload
            || 'acts' in payload || 'important_objects' in payload)) continue;
        spans.push([match.index, match.index + match[0].length]);
    }
    return spans;
}

function excludeVerifiedSceneReports(value) {
    const source = String(value ?? '');
    const spans = verifiedBlocks(source);
    if (!spans.length) return {source, removed: 0, removedChars: 0};
    let out = '', offset = 0, removedChars = 0;
    for (const [start, end] of spans) {
        out += source.slice(offset, start);
        removedChars += end - start;
        offset = end;
    }
    out += source.slice(offset);
    // Do not turn a report-only generation into an empty translation request.
    if (!out.trim()) return {source, removed: 0, removedChars: 0};
    return {source: out.trim(), removed: spans.length, removedChars};
}

module.exports = {excludeVerifiedSceneReports};
