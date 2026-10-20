'use strict';
const http = require('node:http');
const https = require('node:https');
const MAX_BYTES = 8 * 1024 * 1024;
const PATHS = new Set(['/api/backends/chat-completions/generate', '/api/backends/text-completions/generate']);
function failure(status, text) { return Object.assign(new Error(text), { status }); }
function ownConnection(req) {
    const socket = req.socket;
    if (!socket?.localAddress || !socket.localPort) throw failure(503, '서버 주소를 확인할 수 없습니다.');
    let address = socket.localAddress.replace(/^::ffff:/, '');
    const listener = socket.server?.address?.();
    if (listener?.address === '0.0.0.0') address = '127.0.0.1';
    if (listener?.address === '::') address = address.includes(':') ? '::1' : '127.0.0.1';
    const headers = { 'content-type': 'application/json', 'accept-encoding': 'identity' };
    for (const name of ['cookie', 'authorization', 'x-csrf-token', 'host', 'x-silly-pop'])
        if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
    return { address, port: socket.localPort, tls: !!socket.encrypted, headers };
}
// Only the listener which accepted the authenticated request can be called.
// No client-supplied URLs, ports, headers, credentials or filesystem paths.
function requestLocal(connection, route, payload, { signal, onHeaders = () => {}, onChunk = () => {} } = {}) {
    if (!PATHS.has(route)) return Promise.reject(failure(400, '지원하지 않는 생성 경로입니다.'));
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_BYTES) return Promise.reject(failure(413, '요청이 너무 큽니다.'));
    return new Promise((resolve, reject) => {
        const protocol = connection.tls ? https : http;
        const agent = new protocol.Agent({ keepAlive: false });
        let size = 0; const chunks = [];
        const request = protocol.request({ hostname: connection.address, port: connection.port, path: route,
            method: 'POST', signal, agent,
            headers: { ...connection.headers, 'content-length': Buffer.byteLength(body) } }, response => {
            const status = response.statusCode || 502;
            const type = String(response.headers['content-type'] || 'application/json');
            onHeaders(status, type);
            if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
                request.destroy(failure(502, '압축된 내부 응답은 지원되지 않습니다.')); return;
            }
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) { request.destroy(failure(413, '응답 크기 한도 초과')); return; }
                chunks.push(Buffer.from(chunk)); onChunk(chunk);
            });
            response.once('aborted', () => reject(failure(502, '응답이 중간에 끊겼습니다.')));
            response.once('error', reject);
            response.once('end', () => resolve({ status, type, body: Buffer.concat(chunks), retryAfter: response.headers['retry-after'] }));
        });
        request.once('error', reject);
        request.once('close', () => agent.destroy());
        request.end(body);
    });
}
function contentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter(p => !p.thought && (!p.type || ['text','output_text'].includes(p.type)))
        .map(p=>typeof p.text === 'string' ? p.text : '').join('');
    return '';
}
function textFromObject(data) {
    if (Array.isArray(data)) return data.map(textFromObject).join('');
    if (data?.error) throw failure(502, 'AI 응답 오류: ' + String(data.error.message || data.error).slice(0,600));
    if (data?.choices?.length) {
        const choice = data.choices.find(c => !c.index) || {};
        if (choice.message?.tool_calls?.length || choice.delta?.tool_calls?.length) throw failure(409, '도구 호출 답변은 최종 메시지 확정 후 번역합니다.');
        return contentText(choice.delta?.content ?? choice.message?.content ?? choice.text);
    }
    if (data?.candidates?.length) return contentText(data.candidates[0]?.content?.parts);
    if (data?.type === 'content_block_delta') return data.delta?.type === 'text_delta' ? String(data.delta.text || '') : '';
    if (data?.type === 'content_block_start') return data.content_block?.type === 'text' ? String(data.content_block.text || '') : '';
    if (data?.type === 'response.output_text.delta') return String(data.delta || '');
    if (data?.output) return data.output.map(item => contentText(item.content)).join('');
    if (data?.results) return String(data.results[0]?.text || '');
    return contentText(data?.content ?? data?.message?.content ?? data?.text ?? data?.response);
}
function extractReply(body, type) {
    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    if (!/text\/event-stream/i.test(type) && !/^\s*(?:event:|data:)/.test(raw)) return textFromObject(JSON.parse(raw));
    let text = '';
    for(const event of raw.replace(/\r\n/g,'\n').split('\n\n')) {
        const data = event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data || data==='[DONE]') continue;
        text += textFromObject(JSON.parse(data));
    }
    return text;
}
function fillTemplate(template, prompt, token) {
    if (typeof template === 'string') return template.split(token).join(prompt);
    if (Array.isArray(template)) return template.map(v=>fillTemplate(v,prompt,token));
    if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([k,v])=>[k,fillTemplate(v,prompt,token)]));
    return template;
}
async function sendProfile(connection, profiles, id, messages, maxTokens, options = {}) {
    const profile = profiles[id];
    if (!profile || !PATHS.has(profile.path) || typeof profile.marker !== 'string' || !profile.marker.startsWith('VERBA_CAPTURE_'))
        throw failure(400, '서버용 연결 프로필 준비가 필요합니다.');
    const prompt = messages.map(m=>m.content).join('\n');
    const payload = fillTemplate(profile.payload, prompt, profile.marker);
    payload.stream = false;
    const response = await requestLocal(connection, profile.path, payload, { signal: options.signal });
    if (response.status < 200 || response.status >= 300) {
        const error = failure(response.status, `HTTP ${response.status}: ${response.body.toString('utf8').slice(0,2000)}`);
        error.retryAfter = response.retryAfter; throw error;
    }
    return { content: extractReply(response.body, response.type) };
}
module.exports = { PATHS, MAX_BYTES, failure, ownConnection, requestLocal, extractReply, fillTemplate, sendProfile };
