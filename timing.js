// In-memory output-job diagnostics. Never retain prompts, response bodies, or identities.
const PRIMARY = /^output-(?:translation|retranslation)(?::(?:narration|target_dialogue|other_dialogue|tagged_content))?$/;
const LABELS = [
    ['banned', '금지어 복구'], ['untranslated', '미번역 복구'],
    ['protected', '보호 토큰 복구'], ['token', '보호 토큰 복구'],
    ['quality-audit', '품질 검수'], ['role-term-plan', '용어 사전 정리'],
    ['role-term', '용어 일관성 복구'], ['speaker-attribution', '화자 분류'],
];
function describe(options) {
    const stage = String(options.stage || '');
    const retry = Number(options.retryAttempt) > 0 || Number(options.segmentAttempt) > 0 || options.fallback === true;
    const label = LABELS.find(([key]) => stage.includes(key))?.[1]
        || (stage.endsWith(':single') ? '누락 구간 개별 복구' : PRIMARY.test(stage) ? '본 번역' : '보조 요청');
    const kind = retry ? 'retry' : /repair|:single$/.test(stage) ? 'repair' : PRIMARY.test(stage) ? 'primary' : 'aux';
    const reason = options.fallback ? '대체 프로필' : Number(options.retryAttempt) > 0 ? '요청 오류 재시도'
        : Number(options.segmentAttempt) > 0 ? '응답 형식·구간 누락 재시도' : '';
    const batch = options.minimalBatchCount === 2 && [1, 2].includes(options.minimalBatchIndex)
        ? ` (${options.minimalBatchIndex}/2)` : '';
    return { kind, label: label + batch, reason, slot: ['A', 'B', 'C'].includes(options.profileSlot) ? options.profileSlot : '?' };
}

export function createOutputTiming({ now = () => performance.now(), date = () => new Date().toISOString() } = {}) {
    let enabled = false;
    let epoch = 0;
    let sequence = 0;
    let latest = null;
    const valid = job => enabled && job && job.epoch === epoch && job.end == null;
    return {
        setEnabled(value) {
            if (enabled === (value === true)) return;
            enabled = value === true;
            epoch += 1;
            latest = null;
        },
        begin({ retranslation = false, mode = '', slot = '?' } = {}) {
            if (!enabled) return null;
            return { id: ++sequence, epoch, start: now(), at: date(), retranslation,
                mode: ['일반', '압축', '미친압축', '최소 프롬프트'].includes(mode) ? mode : '일반',
                slot: ['A', 'B', 'C'].includes(slot) ? slot : '?', requests: [], waits: [], finishAt: null, end: null };
        },
        enqueue(job, options = {}) {
            if (!valid(job)) return null;
            const row = { ...describe(options), queued: now(), sent: null, end: null, status: '대기' };
            job.requests.push(row);
            return row;
        },
        sent(job, row) {
            if (valid(job) && row && row.end == null) { row.sent = now(); row.status = '응답 대기'; }
        },
        received(job, row) {
            if (valid(job) && row && row.end == null) { row.end = now(); row.status = '응답 수신'; }
        },
        settled(job, row, status) {
            if (!valid(job) || !row) return;
            row.end ??= now();
            row.status = ['응답 수신', '오류', '취소'].includes(status) ? status : '오류';
        },
        async wait(job, action) {
            if (!valid(job)) return action();
            const span = { start: now(), end: null };
            job.waits.push(span);
            try { return await action(); } finally { span.end = now(); }
        },
        applying(job) { if (valid(job)) job.finishAt = now(); },
        finish(job, status) {
            if (!valid(job)) return;
            job.end = now();
            // A replaced/older job must not overwrite the newest job's result.
            if (job.id !== sequence) return;
            latest = summarize(job, ['완료', '실패', '취소·전환'].includes(status) ? status : '실패');
        },
        latest() { return enabled ? latest : null; },
    };
}

function summarize(job, status) {
    const events = [];
    const add = (start, end, kind) => {
        const a = Math.max(job.start, start), b = Math.min(job.end, end ?? job.end);
        if (b > a) { events.push([a, kind, 1]); events.push([b, kind, -1]); }
    };
    for (const row of job.requests) {
        add(row.queued, row.sent ?? row.end, 'queue');
        if (row.sent != null) add(row.sent, row.end, row.kind);
    }
    for (const span of job.waits) add(span.start, span.end, 'backoff');
    if (job.finishAt != null) add(job.finishAt, job.end, 'apply');
    events.push([job.start, 'other', 0], [job.end, 'other', 0]);
    events.sort((a, b) => a[0] - b[0]);
    const keys = ['repair', 'retry', 'primary', 'aux', 'queue', 'backoff', 'apply', 'other'];
    const durations = Object.fromEntries(keys.map(k => [k, 0]));
    const active = Object.fromEntries(keys.map(k => [k, 0]));
    let previous = job.start;
    for (const [time, kind, delta] of events) {
        const owner = keys.find(k => active[k] > 0) || 'other';
        durations[owner] += time - previous;
        active[kind] += delta;
        previous = time;
    }
    const sent = job.requests.filter(r => r.sent != null);
    return {
        at: job.at, status, mode: job.mode, slot: job.slot, retranslation: job.retranslation,
        totalMs: job.end - job.start, durations,
        counts: { total: sent.length, repair: sent.filter(r => r.kind === 'repair').length,
            retry: sent.filter(r => r.kind === 'retry').length, aux: sent.filter(r => r.kind === 'aux').length },
        rows: job.requests.slice(0, 200).map(r => ({ label: r.label, reason: r.reason, slot: r.slot,
            status: r.status, sent: r.sent != null,
            queueMs: (r.sent ?? r.end ?? job.end) - r.queued,
            responseMs: r.sent == null ? 0 : (r.end ?? job.end) - r.sent })),
        omittedRows: Math.max(0, job.requests.length - 200),
    };
}

export function outputTimingText(record) {
    if (!record) return '디버그를 켠 뒤 출력 번역을 실행하면 마지막 소요 시간이 표시됩니다.';
    const seconds = ms => `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
    const d = record.durations;
    return [
        `마지막 출력 ${record.retranslation ? '재번역' : '번역'} · ${record.status} · 총 ${seconds(record.totalMs)}`,
        `${record.at} · 프로필 ${record.slot} · ${record.mode}`,
        `요청 전 준비·기타 처리: ${seconds(d.other)}`,
        `베르바 요청 대기열: ${seconds(d.queue)}`,
        `본 번역 응답 대기: ${seconds(d.primary)}`,
        `추가 복구 응답 대기: ${seconds(d.repair)} · ${record.counts.repair}회`,
        `재시도·대체 응답 대기: ${seconds(d.retry)} · ${record.counts.retry}회`,
        `보조·검수 응답 대기: ${seconds(d.aux)} · ${record.counts.aux}회`,
        `재요청 전 대기: ${seconds(d.backoff)}`,
        `마무리·화면 적용: ${seconds(d.apply)}`,
        `AI 요청: ${record.counts.total}회 (이 출력 작업만, 인풋 제외)`,
        '',
        ...record.rows.map((r, i) => `${i + 1}. ${r.label}${r.reason ? ` / ${r.reason}` : ''} · ${r.slot} · ${r.sent ? r.status : '전송 전 종료'} · 대기열 ${seconds(r.queueMs)} / 응답 ${seconds(r.responseMs)}`),
        ...(record.omittedRows ? [`요청 상세 ${record.omittedRows}건 생략`] : []),
        '',
        '응답 대기에는 네트워크·서버 대기·모델 생성이 포함됩니다. 응답 수신은 번역 품질 성공을 뜻하지 않습니다.',
        '합계는 병렬 중복을 제외한 실제 경과 시간입니다. 겹친 시간은 복구→재시도→본 번역→보조→대기열 순으로 배정하며, 요청별 시간은 서로 겹칠 수 있습니다.',
    ].join('\n');
}
