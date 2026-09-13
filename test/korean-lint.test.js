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

test('catches the conservative translationese additions (2026-09-13)', () => {
  const cases = [
    '그 결과가 화면에 보여집니다',
    '이것은 성공에 다름 아니다',
    '지금 노력하지 않으면 안 된다고 했습니다',
    '모든 분야에 있어서 기준이 필요합니다',
    '이 함수는 세 가지 장점을 가지고 있습니다',
  ];
  for (const text of cases) {
    const findings = lint.lintKoreanText(text);
    assert.ok(findings.some((f) => f.rule === '번역체'), `should flag: ${text}`);
  }
});

test('the additions stay quiet on nearby legitimate forms', () => {
  const clean = [
    '창이 잘 보입니다.',           // 단일 피동
    '파일이 여기에 있어서 옮겼습니다.', // '있어서' 뒤 연결은 '~에 있어서' 관용구가 아니라 실제 존재 서술
    '자료를 가지고 왔습니다.',       // 소유가 아니라 이동 동사
  ];
  for (const text of clean) {
    const findings = lint.lintKoreanText(text).filter((f) => f.rule === '번역체');
    assert.deepEqual(findings, [], `should not flag: ${text}`);
  }
});

test('catches "fails loudly / fails silently" in either word order (2026-09-13)', () => {
  const cases = [
    '틀리면 시끄럽게 드러나는가',
    '실패가 시끄러운 작업은 위임해도 됩니다',
    '조용히 틀리는 작업은 위임하지 않습니다',
    '오류가 조용한 경우가 가장 위험합니다',
    '실패 자체가 안전망이기 때문입니다',
  ];
  for (const line of cases) {
    const found = lint.lintKoreanText(line, { scope: 'code' }) || [];
    assert.ok(found.length > 0, `missed: ${line}`);
    assert.equal(found[0].rule, '비유 어휘');
  }
});

test('the loud/quiet rule stays quiet on literal sound and plain wording', () => {
  const clean = [
    '조용한 환경에서 녹음했습니다.',
    '종료 코드로 바로 드러나는 작업입니다.',
    '빌드와 테스트가 결과를 검증합니다.',
  ];
  for (const line of clean) {
    assert.deepEqual(lint.lintKoreanText(line, { scope: 'code' }), [], `false positive: ${line}`);
  }
});

test('the rule table is exempt from its own lexicon', () => {
  assert.equal(lint.isLintTarget('src/korean-lint.cjs'), false);
  assert.equal(lint.isLintTarget('/home/u/.claude/cache-monitor-hook.cjs'), false);
  assert.equal(lint.isLintTarget('site/index.html'), true);
});

test('HTML: 마크업 텍스트의 구분자와 번역체가 걸린다', () => {
  const html = '<p>설계와 스펙은 메인 모델이 확정합니다 — 워커가 씁니다</p>';
  const out = lint.lintKoreanText(lint.stripHtml(html), { code: true });
  assert.ok(out.some((f) => f.rule === '구분자'));
});

test('HTML: 태그·주석·CSS는 걸리지 않고 줄 번호는 보존된다', () => {
  const html = '<!-- 시끄럽게 실패 -->\n<style>.a{}</style>\n<p>둘째 줄은 깨끗합니다</p>\n<p>보여지는 화면</p>';
  const out = lint.lintKoreanText(lint.stripHtml(html), { code: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 4);
});

test('HTML: script 안 한국어 문자열도 검사된다', () => {
  const html = "<script>const KO={a:'토큰을 아낍니다 — 그리고 막습니다'}</script>";
  const out = lint.lintKoreanText(lint.stripHtml(html), { code: true });
  assert.ok(out.some((f) => f.rule === '구분자'));
});

test('HTML: prose 스코프에서도 lint 대상이다', () => {
  assert.equal(lint.isLintTarget('site/index.html', 'prose'), true);
  assert.equal(lint.isHtmlFile('site/index.html'), true);
});

test('종결 반복: adjacent sentences closing on the same content predicate', () => {
  const hit = lint.lintKoreanText('역회전하는 순간 잠급니다. 에이전트는 그대로 일하고, 퇴행만 잠급니다.');
  assert.equal(hit.filter((f) => f.rule === '종결 반복').length, 1);

  // Auxiliary and copular closers are ordinary Korean, not a repeat to fix.
  for (const pair of [
    '값이 없습니다. 경로도 없습니다.',
    '이것은 캐시입니다. 저것은 로그입니다.',
    '먼저 검사합니다. 그다음 기록합니다.',
  ]) {
    assert.equal(lint.lintKoreanText(pair).filter((f) => f.rule === '종결 반복').length, 0, pair);
  }

  // Structured data holds independent values; neighbouring keys are not
  // neighbouring sentences.
  const yaml = 'name: "규칙을 만듭니다"\ntag: "규칙을 만듭니다"\n';
  assert.equal(lint.lintKoreanText(yaml).filter((f) => f.rule === '종결 반복').length, 0);
});

test('Bash writes are checked too — a heredoc is a write like any other', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'sprag-bash-lint-'));
  try {
    const file = join(dir, 'note.md');
    writeFileSync(file, '이 기능은 후보가 발견되면 자동으로 보여집니다.\n');

    const hit = lint.lintToolUse({ tool_name: 'Bash', tool_input: { command: `cat > ${file} <<'EOF'\n...\nEOF` } });
    assert.ok(hit, 'a redirect into a Korean document must be checked');
    assert.equal(hit.filePath, file);
    assert.equal(hit.findings[0].rule, '번역체');

    // Commands that write nothing, write elsewhere, or name a missing file must
    // stay silent: this runs after every shell command in the session.
    for (const command of [
      'git status --short',
      'node build.js > /dev/null 2>&1',
      `grep -n 보여집 ${file}`,
      `echo hi > ${join(dir, 'absent.md')}`,
    ]) {
      assert.equal(lint.lintToolUse({ tool_name: 'Bash', tool_input: { command } }), null, command);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writtenPathsOfBash: redirects and in-place edits, never the command body', () => {
  const paths = (c) => lint.writtenPathsOfBash(c);
  assert.deepEqual(paths("cat > a.md <<'EOF'"), ['a.md']);
  assert.deepEqual(paths('echo x >> docs/b.md'), ['docs/b.md']);
  assert.deepEqual(paths('foo | tee -a c.txt'), ['c.txt']);
  assert.deepEqual(paths("perl -pi -e 's/a/b/' README.ko.md"), ['README.ko.md']);
  assert.deepEqual(paths('node x.js 2>/dev/null'), []);
  assert.deepEqual(paths('grep 한국어 b.md'), []);
});

test('opt-out marker exempts a file that must quote the banned forms', () => {
  const banned = '이 값은 자동으로 ' + '보여집니다.';
  assert.ok(lint.lintKoreanText(banned).length > 0, 'sanity: the form is caught');
  assert.equal(lint.lintKoreanText('# korean-lint: off\n' + banned).length, 0);
  assert.equal(lint.lintKoreanText('<!-- korean-lint: ignore-file -->\n' + banned).length, 0);
});
