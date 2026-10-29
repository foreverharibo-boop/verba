import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { segmentSource, assembleTranslation, hasForeignText, maskProtectedForEnglishReview, protectSource, restoreProtected } from '../core.js';

function translate(source, words, options = {}) {
    const segmented = segmentSource(source, [], options);
    const translations = new Map(segmented.segments.map(row => [row.id, Object.entries(words).reduce((text, [a, b]) => text.split(a).join(b), row.text)]));
    const result = assembleTranslation(segmented, translations);
    assert.equal(assembleTranslation(segmented, translations), result, 'assembly is repeatable');
    return { segmented, result };
}

test('inline backticks, double backticks and multiple blocks expose natural language', () => {
    for (const source of ['`Happy`', '``Happy``', '```\nHappy\n```', '~~~text\nHappy\n~~~', '````text\nHappy\n```\n````', '```text\r\nHappy\r\n```', '```text\nHappy']) {
        const { segmented, result } = translate(source, { Happy: '행복함' });
        assert.equal(result, source.replace('Happy', '행복함'));
        assert.equal(hasForeignText(source), true);
        assert.equal(segmented.segments.length, 1);
        assert.equal(segmented.segments[0].type, 'tagged_content');
    }
    assert.equal(translate('`Happy` and `Ready`', { Happy: '행복함', Ready: '준비됨', and: '그리고' }).result, '`행복함` 그리고 `준비됨`');
});

test('code text stays independent of the paired-tag switch and dialogue styles', () => {
    const { segmented, result } = translate('```text\n"Stay here."\nStatus: Happy\n```', { 'Stay here.': '여기 있어.', 'Status: Happy': '상태: 행복함' }, { translateTaggedContent: false });
    assert.equal(result, '```text\n"여기 있어."\n상태: 행복함\n```');
    assert.ok(segmented.segments.every(row => row.type === 'tagged_content' && row.tagContext.includes('code')));
});

test('HTML attributes, CSS, script, macros and URLs survive inside fences', () => {
    const source = '```html\n<style>body { color: red; }</style>\n<div class="status" data-label="Keep me">Happy</div>\n<script>alert("Keep me")</script>\n{{keep}} https://example.com/path\n```';
    assert.equal(translate(source, { Happy: '행복함', 'Keep me': '바뀌면 안 됨' }).result, source.replace('>Happy<', '>행복함<'));
});

test('JSON translates values, preserves keys/types/escapes, and escapes introduced quotes', () => {
    const source = '```json\n{"status":"Happy", "message":"Stay here.", "id":"KEEP_CODE", "count":2,"active":true}\n```';
    const { result } = translate(source, { Happy: '행복함', 'Stay here.': '"여기" 있어. C:\\방' });
    const parsed = JSON.parse(result.split('\n')[1]);
    assert.deepEqual(parsed, { status: '행복함', message: '"여기" 있어. C:\\방', id: 'KEEP_CODE', count: 2, active: true });
    const escaped = '```json\n{"message":"Happy\\nStay here."}\n```';
    assert.equal(translate(escaped, { Happy: '행복함', 'Stay here.': '여기 있어.' }).result, '```json\n{"message":"행복함\\n여기 있어."}\n```');
});

test('program statements and identifiers stay executable while readable strings/comments translate', () => {
    const source = '```js\nconst count = 1;\nconst label = "Happy";\n// Stay here.\nconst result = count + 2;\n```';
    const { result } = translate(source, { Happy: '행복함', 'Stay here.': '여기 있어.' });
    const body = result.split('\n').slice(1, -1).join('\n');
    assert.equal(vm.runInNewContext(body + '\nresult'), 3);
    assert.equal(vm.runInNewContext(body + '\nlabel'), '행복함');
    assert.match(body, /\/\/ 여기 있어\./);
    for (const code of ['`KEEP_CODE`', '`user_id`', '`foo.bar()`', '```js\nconst count = 1;\n```']) {
        assert.equal(translate(code, {}).result, code);
        assert.equal(hasForeignText(code), false);
    }
});

test('opaque outer blocks remain opaque even when containing fences', () => {
    for (const tag of ['style', 'script', 'analysis', 'thinking', 'starter']) {
        const source = `<${tag}>\n\x60\x60\x60text\nHappy\n\x60\x60\x60\n</${tag}>`;
        assert.equal(translate(source, { Happy: '행복함' }).result, source);
    }
});

test('English review keeps offsets and can see untranslated fenced prose', () => {
    const source = '```html\r\n<div class="status">Happy</div>\r\n```';
    const masked = maskProtectedForEnglishReview(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.indexOf('Happy'), source.indexOf('Happy'));
    assert.doesNotMatch(masked, /status|html/);
});

test('name locks apply inside backticks and no structural tokens leak', () => {
    const segmented = segmentSource('`Dana is happy.`', [{ source: 'Dana', target: '다나' }]);
    const row = segmented.segments[0];
    const result = assembleTranslation(segmented, new Map([[row.id, row.text.replace('is happy.', '행복하다.')]]));
    assert.equal(result, '`다나 행복하다.`');
    assert.doesNotMatch(result, /@@/);
    const protectedSource = protectSource('`Happy`');
    assert.equal(restoreProtected(protectedSource.protectedText, protectedSource.tokens), '`Happy`');
});


test('ordinary prose beginning with programming-like words is not mistaken for code', () => {
    const source = '```text\nif you need help, ask me.\nreturn to the room.\n```';
    assert.equal(translate(source, { 'if you need help, ask me.': '도움이 필요하면 말해.', 'return to the room.': '방으로 돌아가.' }).result, '```text\n도움이 필요하면 말해.\n방으로 돌아가.\n```');
});


test('template strings, regular expressions, raw strings and macros keep machine syntax', () => {
    for (const source of [
        '```js\nconst regex = /"Happy"/;\nconst template = `"Happy" ${value}`;\n```',
        '```python\nvalue = r"Happy"\n```',
        '```sql\nSELECT "Happy" FROM records;\n```',
        '`{{user}}`',
    ]) assert.equal(translate(source, { Happy: '행복함' }, { speakerIdentity: { userName: 'Dana' } }).result, source);
});
