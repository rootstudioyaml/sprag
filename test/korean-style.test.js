/**
 * Korean writing guidance: opt-in, injected once per session through the
 * SessionStart hook, and never silently on. The vendored text must keep its
 * MIT attribution shipping alongside it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-korean-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

test('off by default — a token-saving tool must not spend tokens unasked', async (t) => {
  isolated(t);
  const ks = await import('../src/korean-style.js?default');
  assert.equal(ks.koreanStyleEnabled(), false);
  assert.equal(ks.koreanStyleInjection(), null);
});

test('turning it on produces an injection block that frames the rules', async (t) => {
  isolated(t);
  const ks = await import('../src/korean-style.js?on');
  ks.setKoreanStyleEnabled(true);
  assert.equal(ks.koreanStyleEnabled(), true);

  const block = ks.koreanStyleInjection();
  assert.ok(block, 'an injection block is produced');
  // Framing: without it the model can read the text as a topic to discuss
  // rather than as rules governing its own writing.
  assert.match(block, /sprag korean-style/);
  assert.match(block, /지침을 따르십시오/);
  // Provenance travels with the text.
  assert.match(block, /snflkd/);
  assert.match(block, /MIT/);
  // The guidance itself is present, not just the framing.
  assert.match(block, /문장을 끝까지 씁니다/);
  // Scope has to read as inclusion. The old wording ("답변·문서·주석이 아닌
  // 산문 전반") parses far more naturally as EXCLUDING documents, and a
  // session that read it that way shipped 18 em dashes in a markdown
  // deliverable while the rules were active.
  assert.match(block, /적용 대상:.*문서/s);
  assert.match(block, /적용 예외:/);
  assert.doesNotMatch(block, /문서·주석이 아닌/, 'no negation governing the scope list');

  ks.setKoreanStyleEnabled(false);
  assert.equal(ks.koreanStyleInjection(), null);
});

test('the scope lines alone decide whether code comments are covered', async (t) => {
  isolated(t);
  const ks = await import('../src/korean-style.js?precedence');
  ks.setKoreanStyleEnabled(true);

  // The vendored fluent-korean text disclaimed code comments while the wide
  // scope claimed them, and the model guessed wrong in September 2026. The
  // rules file now says nothing about comments, so the scope lines are the
  // only sentence on it and no override is needed.
  assert.doesNotMatch(ks.koreanStyleText(), /코드 주석에는 이 지침들을 적용하지 않습니다/);
  const wide = ks.koreanStyleInjection();
  assert.match(wide, /적용 대상:.*코드 주석/);
  assert.doesNotMatch(wide, /우선합니다/);

  const narrow = ks.koreanStyleInjection({ cfg: { koreanStyle: { enabled: true, lintScope: 'prose' } } });
  assert.match(narrow, /적용 예외:.*코드 주석/);

  ks.setKoreanStyleEnabled(false);
});

test('the attribution line does not break the rule it cites', async () => {
  const ks = await import('../src/korean-style.js?source');
  // 구 단위 4번 조항이 엠대시를 금지합니다. 출처 문구가 그 표기를 쓰고 있으면
  // 지침 스스로 어기는 예시가 되므로 콜론으로 적습니다.
  assert.doesNotMatch(ks.KOREAN_STYLE_SOURCE, /—/);
  assert.match(ks.KOREAN_STYLE_SOURCE, /snflkd/);
});

test('the rules text drops the provenance comment but keeps the rules', async () => {
  const ks = await import('../src/korean-style.js?text');
  const raw = readFileSync(ks.KOREAN_STYLE_PATH, 'utf8');
  assert.match(raw, /KatFishNet/, 'the file records the evidence behind each clause');
  const text = ks.koreanStyleText();
  // Every token of the HTML comment would be billed per session, so it is
  // stripped from what gets injected.
  assert.doesNotMatch(text, /Evidence \(full list/);
  assert.match(text, /연결어미 뒤에는 쉼표를 찍지 않습니다/);
  assert.match(text, /가운뎃점으로 나열하지 않습니다/);
});

test('the MIT license ships for the clauses adapted from fluent-korean', async () => {
  const ks = await import('../src/korean-style.js?license');
  assert.ok(existsSync(ks.KOREAN_STYLE_LICENSE_PATH), 'license file is present');
  const license = readFileSync(ks.KOREAN_STYLE_LICENSE_PATH, 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 snflkd/);
});

test('locale decides the install-time default, not a coin flip', async () => {
  const ks = await import('../src/korean-style.js?locale');
  const on = (env, platform = 'linux') => ks.koreanLocaleDetected({ env, platform });
  assert.equal(on({ LANG: 'ko_KR.UTF-8' }), true);
  assert.equal(on({ LC_ALL: 'ko_KR.UTF-8' }), true);
  assert.equal(on({ LANGUAGE: 'ko:en' }), true);
  assert.equal(on({ LANG: 'en_US.UTF-8' }), false);
  assert.equal(on({}), false);
  // "kok" (Konkani) and "tok" must not be mistaken for Korean.
  assert.equal(on({ LANG: 'kok_IN.UTF-8' }), false);
  assert.equal(on({ LANG: 'tok_XX.UTF-8' }), false);
});

test('the injected rules obey their own comma and middle-dot clauses', async () => {
  // The rules are read by the model every session, and the model copies the
  // style of its context. A rules file that breaks its own clauses teaches the
  // habit it bans, which is how the old lint hint spread middle dots.
  const ks = await import('../src/korean-style.js?selfcheck');
  const lint = (await import('../src/korean-lint.cjs')).default;
  const findings = lint.lintKoreanText(ks.koreanStyleText(), { maxFindings: 100 });
  assert.deepEqual(findings, []);
});

test('the injection no longer carries the fluent-korean scope override', async () => {
  const ks = await import('../src/korean-style.js?override');
  for (const line of ks.koreanScopeLines({ koreanStyle: { lintScope: 'all' } })) {
    assert.doesNotMatch(line, /fluent-korean 본문/);
  }
});
