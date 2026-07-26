import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

/**
 * The SessionStart hook's output is injected verbatim into the model's
 * context, so its language is not cosmetic: a Korean-only briefing steers an
 * English session's entire first response into Korean. These tests drive the
 * real CLI in a sandboxed XDG dir with a seeded scan cache.
 */
function sandbox({ language, candidates }) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-i18n-'));
  const cfgDir = join(dir, 'claude-token-saver');
  mkdirSync(cfgDir, { recursive: true });
  if (language) writeFileSync(join(cfgDir, 'config.json'), JSON.stringify({ language }));
  writeFileSync(join(cfgDir, 'route-scan.json'), JSON.stringify({
    scannedAt: new Date().toISOString(),
    days: 14,
    totalEpisodes: 400,
    easyEpisodes: 100,
    candidates,
    resolved: [],
    // Far above RESCAN_BIG_DELTA_BYTES-era freshness checks so the hook reads
    // the cache instead of kicking a rescan mid-test.
    scannedBytes: Number.MAX_SAFE_INTEGER,
  }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const MODERN = {
  id: 1,
  signature: 'T2|check|proj',
  tier: 'T2',
  category: 'check',
  label: '상태 확인·검증',
  labelEn: 'status checks / verification',
  agent: 'haiku-explore',
  project: 'proj',
  projectPath: '/tmp/proj',
  count: 7,
  models: ['claude-opus-5'],
  example: 'is the build green',
  suggestedScope: 'project',
  rule: '"상태 확인·검증" 유형의 단순 요청은 haiku-explore로 위임한다',
  ruleEn: 'Delegate simple "status checks / verification" requests to the haiku-explore subagent',
};

// A candidate cached by an older version, before labelEn/ruleEn existed.
const LEGACY = { ...MODERN, id: 2, signature: 'T2|read|proj', category: 'read', label: '읽기·요약·설명' };
delete LEGACY.labelEn;
delete LEGACY.ruleEn;

function run(args, dir) {
  return execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: dir, NO_COLOR: '1' },
    input: JSON.stringify({ session_id: 'test-session' }),
    encoding: 'utf8',
  });
}

const HANGUL = /[가-힣]/;

test('the SessionStart hook briefing is English for an English user', () => {
  const { dir, cleanup } = sandbox({ language: 'en', candidates: [MODERN] });
  try {
    const out = run(['route-scan', '--hook'], dir);
    assert.match(out, /Candidate R1/);
    assert.match(out, /status checks \/ verification/);
    assert.match(out, /haiku-explore/);
    assert.doesNotMatch(out, HANGUL, 'no Korean may leak into an English session context');
  } finally {
    cleanup();
  }
});

test('the SessionStart hook briefing stays Korean for a Korean user', () => {
  const { dir, cleanup } = sandbox({ language: 'ko', candidates: [MODERN] });
  try {
    const out = run(['route-scan', '--hook'], dir);
    assert.match(out, /후보 R1/);
    assert.match(out, /상태 확인·검증/);
  } finally {
    cleanup();
  }
});

test('English default falls back to the Korean label for pre-i18n cache entries', () => {
  const { dir, cleanup } = sandbox({ language: null, candidates: [LEGACY] });
  try {
    // No `language` key at all — userLanguage() defaults to English.
    const out = run(['route-scan', '--hook'], dir);
    assert.match(out, /Candidate R2/, 'English scaffolding still applies');
    assert.match(out, /읽기·요약·설명/, 'the stale label is shown rather than dropped');
  } finally {
    cleanup();
  }
});

test('route-scan listing renders candidates in the configured language', () => {
  const en = sandbox({ language: 'en', candidates: [MODERN] });
  const ko = sandbox({ language: 'ko', candidates: [MODERN] });
  try {
    const outEn = run(['route-scan'], en.dir);
    assert.match(outEn, /Delegation candidates/);
    assert.match(outEn, /status checks \/ verification/);
    assert.doesNotMatch(outEn, HANGUL);

    const outKo = run(['route-scan'], ko.dir);
    assert.match(outKo, /위임 후보/);
    assert.match(outKo, /상태 확인·검증/);
  } finally {
    en.cleanup();
    ko.cleanup();
  }
});
