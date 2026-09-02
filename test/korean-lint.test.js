/**
 * korean-lint — the enforcement half of the Korean writing guidance.
 *
 * These tests pin the two properties that decide whether the feature is worth
 * having: it must catch the clause human review actually misses (figurative
 * vocabulary), and it must stay quiet on code, quotations, and clean prose.
 * A checker that cries wolf gets turned off, which reopens the hole it exists
 * to close.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const lint = createRequire(import.meta.url)('../src/korean-lint.cjs');

test('catches figurative vocabulary that reads fine in isolation', () => {
  const findings = lint.lintKoreanText('이 결정은 정책이 갈리는 자리입니다.');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, '비유 어휘');
  assert.equal(findings[0].line, 1);
});

test('catches the metaphors that slipped through review in hn124', () => {
  const text = [
    '값이 내려간 자리에서 점수가 올랐다',
    '가격 인하가 이 지점에 닿습니다',
    '그 습관을 학습으로 걷어내려 했습니다',
  ].join('\n');
  const findings = lint.lintKoreanText(text);
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map((f) => f.line), [1, 2, 3]);
});

test('catches translationese, repeated 의, and separators', () => {
  const findings = lint.lintKoreanText('성능에 대한 분석 — 지출의 비용의 추론의 결과입니다');
  const rules = new Set(findings.map((f) => f.rule));
  assert.ok(rules.has('번역체'));
  assert.ok(rules.has('구분자'));
  assert.ok(rules.has("'의' 반복"));
});

test('stays quiet on clean prose', () => {
  const text = '앤트로픽이 가격을 25% 내렸다고 밝혔습니다. 주간 한도는 9월 14일부터 줄어듭니다.';
  assert.deepEqual(lint.lintKoreanText(text), []);
});

test('ignores fenced code blocks and inline code', () => {
  const text = ['```js', "const 자리 = '값이 내려간 자리';", '```', '본문은 정상입니다.'].join('\n');
  assert.deepEqual(lint.lintKoreanText(text), []);
});

test('ignores markdown table rows using the pipe character', () => {
  const findings = lint.lintKoreanText('| 항목 | 값 |');
  assert.deepEqual(findings, []);
});

test('the default scope covers every text file, prose scope only documents', () => {
  // Korean in a comment or a UI string reaches a reader the same way a
  // document does, and generated artifacts are assembled from those strings,
  // so `all` is the default and `prose` is the narrow opt-out.
  assert.equal(lint.isLintTarget('docs/KOREAN-STYLE.md'), true);
  assert.equal(lint.isLintTarget('src/compile-spec.mjs'), true);
  assert.equal(lint.isLintTarget('app/main.py'), true);
  assert.equal(lint.isLintTarget('src/compile-spec.mjs', 'prose'), false);

  // Dependencies, lockfiles, and binaries are never authored Korean.
  assert.equal(lint.isLintTarget('node_modules/pkg/README.md'), false);
  assert.equal(lint.isLintTarget('package-lock.json'), false);
  assert.equal(lint.isLintTarget('public/images/hn124/cost.png'), false);
  assert.equal(lint.isLintTarget('out/report.pdf'), false);

  // Build output is checked: it is what the reader actually receives.
  assert.equal(lint.isLintTarget('dist/report.html'), true);
  assert.equal(lint.isLintTarget('build/captions.vtt'), true);
  assert.equal(lint.isLintTarget('src/data/hnpulse/hn124.gen.ts'), true);
});

test('extracts the text each write-shaped tool put on disk', () => {
  assert.equal(lint.writtenTextOf('Write', { content: '본문' }), '본문');
  assert.equal(lint.writtenTextOf('Edit', { new_string: '본문' }), '본문');
  assert.equal(lint.writtenTextOf('MultiEdit', { edits: [{ new_string: '가' }, { new_string: '나' }] }), '가\n나');
  assert.equal(lint.writtenTextOf('Bash', { command: 'ls' }), null);
});

test('lintToolUse fires on a Korean markdown write and skips code files', () => {
  const dirty = {
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/doc.md', content: '분석의 흐름을 정리했습니다.' },
  };
  const result = lint.lintToolUse(dirty);
  assert.ok(result);
  assert.equal(result.filePath, '/tmp/doc.md');
  assert.ok(lint.formatFindings(result.filePath, result.findings).includes('분석의 흐름'));

  // A comment is a deliverable too — this is the case the narrow scope missed.
  const code = {
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/x.js', content: "// 분석의 흐름을 정리한다\nconst a = 1;" },
  };
  const codeResult = lint.lintToolUse(code);
  assert.ok(codeResult);
  assert.equal(codeResult.findings[0].rule, '비유 어휘');
  assert.equal(lint.lintToolUse(code, { scope: 'prose' }), null);

  // `|` is an operator in source, so it must not be read as a separator.
  const pipe = {
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/x.js', content: 'const 상태 = a | b; // 상태를 합칩니다' },
  };
  assert.equal(lint.lintToolUse(pipe), null);

  const english = {
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/doc.md', content: 'Plain English prose.' },
  };
  assert.equal(lint.lintToolUse(english), null);
});
