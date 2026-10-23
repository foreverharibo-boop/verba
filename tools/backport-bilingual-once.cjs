const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const roots = process.argv.slice(2).map(value => path.resolve(value));
if (roots.length !== 2) throw new Error('Usage: node backport-bilingual-once.cjs VERBA_ROOT DEEP_ROOT');

const planImport = "import { buildBilingualVerdictPrompt, bilingualPromptsNeedingVerdict, resolveBilingualIntent } from './bilingual-intent.js';";
const planFunction = `/**
 * Optional bilingual-intent check. Only uncertain direct-dialogue formatting
 * requests reach the AI, with one provider attempt and a bounded
 * 20-second / 512-token decision request.
 */
async function planBilingualDialogueVerdicts(segmented, options = {}) {
    if (settings.translationEngine === 'google-free') return;
    if (!segmented?.segments?.some(item => item.type === 'dialogue_candidate')) return;
    const pending = bilingualPromptsNeedingVerdict(settings);
    if (!pending.length) return;
    const profiles = configuredProfileCycle();
    if (!profiles.active) return;
    for (const prompt of pending) {
        if (options.signal?.aborted) throw abortError();
        await resolveBilingualIntent(prompt, async (text, sharedSignal) => {
            const expected = [{ id: 'bilingual_0000', type: 'bilingual_check', text }];
            const response = await sendProfileRequest(buildBilingualVerdictPrompt({ prompt: text }), {
                profileId: profiles.active,
                profileSlot: profiles.slot,
                signal: sharedSignal,
                stage: 'bilingual-check',
                timeoutSecondsOverride: 20,
                timing: options.timing,
            });
            const result = collectPartialSegmentTranslations(extractResponseText(response), expected);
            if (result.parseError || result.partial.size !== 1) return null;
            const verdict = String(result.partial.get('bilingual_0000') ?? '').trim().toLowerCase();
            return verdict === 'true' ? true : verdict === 'false' ? false : null;
        }, options.signal);
    }
}
`;

function git(root, ...args) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
function fromMain(root, file) {
    return git(root, 'show', `origin/main:${file}`);
}
function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}
function replaceOnce(text, before, after, label) {
    const first = text.indexOf(before);
    if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
    if (text.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
    return text.slice(0, first) + after + text.slice(first + before.length);
}
function functionSlice(text, name) {
    const start = text.indexOf(`async function ${name}(`);
    if (start < 0) throw new Error(`Missing function ${name}`);
    const nextAsync = text.indexOf('\nasync function ', start + 20);
    const nextPlain = text.indexOf('\nfunction ', start + 20);
    const candidates = [nextAsync, nextPlain].filter(value => value > start);
    const end = candidates.length ? Math.min(...candidates) : text.length;
    return { start, end, body: text.slice(start, end) };
}
function replaceFunction(text, name, body) {
    const current = functionSlice(text, name);
    return text.slice(0, current.start) + body + text.slice(current.end);
}
function movePromptInsideTry(body, builder, prelude, label) {
    if (body.includes(prelude.trim())) return body;
    const expression = new RegExp(`    const prompt = (${builder}\\(\\{[\\s\\S]*?\\n    \\}\\));\\n`);
    const match = body.match(expression);
    if (!match) throw new Error(`Missing ${label} prompt block`);
    const call = match[1];
    body = body.replace(match[0], '    let prompt;\n');
    const promptAt = body.indexOf('    let prompt;');
    const tryAt = body.indexOf('    try {', promptAt);
    if (tryAt < 0) throw new Error(`Missing ${label} try block`);
    const insertion = `    try {\n${prelude}\n        prompt = ${call};`;
    return body.slice(0, tryAt) + insertion + body.slice(tryAt + '    try {'.length);
}

function serverRegressionTest() {
    return `import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine as verba } from '../engines/verba.mjs';
import { createEngine as deep } from '../engines/verba-deep.mjs';

const snapshot = settings => ({
  settings: { profileId: 'A', activeProfileSlot: 'A', autoProfileFallback: false, serverRetryLimit: 1, developerMinimalPromptEnabled: false, developerMode: false, dialogueEndingRepetitionReduction: false, ...settings },
  profiles: { A: {} },
  nameLocks: [{ source: 'Dana', target: '다나' }],
  character: { name: 'Chris' },
  context: { name1: 'Dana', name2: 'Chris' },
});

function transportFor({ verdict = null } = {}) {
  const calls = [];
  const transport = async (_id, messages, maxTokens) => {
    const prompt = String(messages?.[0]?.content || '');
    calls.push({ prompt, maxTokens });
    if (prompt.includes('bilingual_0000')) {
      assert.equal(maxTokens, 512);
      return { content: JSON.stringify({ segments: [{ id: 'bilingual_0000', translation: verdict === true ? 'true' : 'false' }] }) };
    }
    const ids = [...new Set([...prompt.matchAll(/\"id\"\\s*:\\s*\"(seg_\\d+)\"/g)].map(match => match[1]))];
    const name = prompt.match(/@@VERBA_(?:DEEP_)?NAME_\\d+@@/)?.[0] || '다나';
    return { content: JSON.stringify({ segments: ids.map(id => ({ id, translation: \`안녕, \${name}.\` })) }) };
  };
  return { calls, transport };
}

for (const [name, createEngine] of [['verba', verba], ['deep', deep]]) {
  test(name + ' keeps explicit bilingual denial Korean-only', async () => {
    const { calls, transport } = transportFor();
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'Bilingual dialogue should not be used. Korean translation only.' }), transport);
    const result = await engine.output('\"Hi, Dana.\"', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), false);
    assert.equal(calls.some(call => call.maxTokens === 512), false);
  });

  test(name + ' preserves explicit bilingual output', async () => {
    const { transport } = transportFor();
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'For dialogue, always output both the original English and its Korean translation.' }), transport);
    const result = await engine.output('\"Hi, Dana.\"', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), true);
    assert.equal(result.translation.includes('다나'), true);
  });

  test(name + ' uses one bounded verdict request for uncertain bilingual wording', async () => {
    const { calls, transport } = transportFor({ verdict: true });
    const engine = createEngine(snapshot({ allDialoguePromptEnabled: true, allDialoguePrompt: 'Bilingual.' }), transport);
    const result = await engine.output('\"Hi, Dana.\"', { speakerIdentity: { sourceUserName: 'Dana', userName: '다나', characterName: 'Chris' } });
    assert.equal(result.translation.includes('Hi, Dana'), true);
    assert.equal(calls.filter(call => call.maxTokens === 512).length, 1);
  });
}
`;
}

function patchRoot(root) {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const deep = manifest.name === 'verba-deep';
    const version = deep ? '0.6.43' : '0.6.65';
    const title = deep ? '긴르바' : '베르바';

    write(path.join(root, 'bilingual-intent.js'), fromMain(root, 'bilingual-intent.js'));
    write(path.join(root, 'core.js'), fromMain(root, 'core.js'));
    for (const file of ['tests/bilingual-intent.mjs', 'tests/bilingual-source-recovery-smoke.mjs']) {
        write(path.join(root, file), fromMain(root, file));
    }

    let index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    if (!index.includes(planImport)) index = `${planImport}\n${index}`;
    if (!index.includes('async function planBilingualDialogueVerdicts(')) {
        index = replaceOnce(
            index,
            '\nasync function translateOutputText(source, options = {}) {',
            `\n${planFunction}\nasync function translateOutputText(source, options = {}) {`,
            `${title} bilingual planner`,
        );
    }
    if (!index.includes('await planBilingualDialogueVerdicts(initialSegmented')) {
        index = replaceOnce(
            index,
            "    const initialSegmented = segmentSource(source, characterNameLocks, segmentationOptions);\n    if (minimalOutputEnabled(settings)) {",
            "    const initialSegmented = segmentSource(source, characterNameLocks, segmentationOptions);\n    await planBilingualDialogueVerdicts(initialSegmented, { signal: options.signal, timing: options.timing });\n    if (minimalOutputEnabled(settings)) {",
            `${title} output verdict call`,
        );
    }
    if (!index.includes("options.stage === 'bilingual-check' ? 512 : VERBA_MAX_TOKENS")) {
        index = replaceOnce(
            index,
            "                    VERBA_MAX_TOKENS,\n                    { signal: controller.signal },",
            "                    options.stage === 'bilingual-check' ? 512 : VERBA_MAX_TOKENS,\n                    { signal: controller.signal },",
            `${title} bilingual token cap`,
        );
    }

    let bundle = functionSlice(index, 'retranslateSelectionBundle').body;
    bundle = movePromptInsideTry(
        bundle,
        'buildMultiSelectionPrompt',
        "        await planBilingualDialogueVerdicts({ segments: bundleHasDialogue ? [{ type: 'dialogue_candidate' }] : [] }, { signal: controller.signal });",
        `${title} bundle selection`,
    );
    index = replaceFunction(index, 'retranslateSelectionBundle', bundle);

    let selection = functionSlice(index, 'retranslateSelection').body;
    selection = movePromptInsideTry(
        selection,
        'buildSelectionPrompt',
        "        await planBilingualDialogueVerdicts({ segments: selectionHasDialogue ? [{ type: 'dialogue_candidate' }] : [] }, { signal: controller.signal });",
        `${title} selection`,
    );
    index = replaceFunction(index, 'retranslateSelection', selection);

    index = index.replace(/const EXTENSION_VERSION = '[^']+';/, `const EXTENSION_VERSION = '${version}';`);
    index = index.replace(/const SERVER_ENGINE_VERSION = '[^']+';/, `const SERVER_ENGINE_VERSION = '${version}';`);
    fs.writeFileSync(path.join(root, 'index.js'), index);

    manifest.version = version;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const serverPackagePath = path.join(root, 'server-plugin/package.json');
    const serverPackage = JSON.parse(fs.readFileSync(serverPackagePath, 'utf8'));
    serverPackage.version = '0.1.5';
    fs.writeFileSync(serverPackagePath, `${JSON.stringify(serverPackage, null, 2)}\n`);

    const readmePath = path.join(root, 'README.md');
    let readme = fs.readFileSync(readmePath, 'utf8');
    const heading = `## v${version} · 서버 번역 실험판 한영병기 동기화`;
    const note = `${heading}\n\n- 메인의 엄격한 한영병기 의도 판정, 부정문·선택사항 오인 방지, 한영병기 OFF 시 영어 원문 비조립, 검증된 이름 보호토큰 복구를 서버 번역 실험판에도 적용했습니다.\n- 애매한 지시만 20초·512토큰 제한의 단일 판정 요청을 사용하며, 브라우저 번역과 서버 백그라운드 번역이 같은 규칙을 사용합니다.\n\n`;
    if (!readme.includes(heading)) {
        const headingEnd = readme.indexOf('\n') + 1;
        readme = readme.slice(0, headingEnd) + '\n' + note + readme.slice(headingEnd);
        fs.writeFileSync(readmePath, readme);
    }

    write(path.join(root, 'server-plugin/tests/bilingual-backport.test.mjs'), serverRegressionTest());
}

roots.forEach(patchRoot);
