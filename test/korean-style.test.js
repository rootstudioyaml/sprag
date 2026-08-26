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
    rmSync(dir, { recursive: true, force: true });
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
  assert.match(block, /claude-token-saver korean-style/);
  assert.match(block, /지침을 따르십시오/);
  // Provenance travels with the text.
  assert.match(block, /snflkd/);
  assert.match(block, /MIT/);
  // The guidance itself is present, not just the framing.
  assert.match(block, /문장 성분/);
  // Scope has to read as inclusion. The old wording ("답변·문서·주석이 아닌
  // 산문 전반") parses far more naturally as EXCLUDING documents, and a
  // session that read it that way shipped 18 em dashes in a markdown
  // deliverable while the rules were active.
  assert.match(block, /적용 대상:.*문서/s);
  assert.match(block, /적용 예외:/);
  assert.doesNotMatch(block, /문서·주석이 아닌/, 'no negation governing the scope list');
  // The exception list has to agree with the vendored text, which excludes
  // quotes, code and code comments.
  assert.match(block, /적용 예외:.*코드 주석/s);

  ks.setKoreanStyleEnabled(false);
  assert.equal(ks.koreanStyleInjection(), null);
});

test('the vendored text drops the provenance comment but keeps the rules', async () => {
  const ks = await import('../src/korean-style.js?text');
  const raw = readFileSync(ks.KOREAN_STYLE_PATH, 'utf8');
  assert.match(raw, /snflkd/, 'the file records where it came from');
  const text = ks.koreanStyleText();
  // Every token of the HTML comment would be billed per session, so it is
  // stripped from what gets injected.
  assert.doesNotMatch(text, /Vendored from/);
  assert.match(text, /조사와 어미를 생략하지 말아야 합니다/);
});

test('the MIT license ships alongside the vendored text', async () => {
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
