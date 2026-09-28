/**
 * preset-ratchet — accepted presets live in a tool-owned file of their own.
 *
 * Driven through the CLI against a throwaway HOME, starting from what an older
 * version left behind: a global harness block without the preset import and a
 * preset appended to ratchet.md next to a rule the user wrote.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { presetRuleEntries } from '../src/harness.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function sandbox(t, { codex = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-preset-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  if (codex) mkdirSync(join(home, '.codex'), { recursive: true });
  const env = childEnv({ HOME: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1', CTS_LANG: 'ko',
    ...(codex ? { CODEX_HOME: join(home, '.codex') } : {}) });
  // stdin is closed unless a payload is passed: an open pipe with no writer
  // would leave any child that reads stdin waiting forever.
  const run = (args, input) => execFileSync(process.execPath, [CLI, ...args], {
    env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 120_000 });
  return { dir, home, run };
}

const ruleLines = (text) => (text.match(/^- \[fix-[0-9a-f]{6}\]/gm) || []).length;

test('an upgrade moves old presets out of ratchet.md and wires the import once', (t) => {
  const s = sandbox(t);
  s.run(['harness', 'init', '--global']);
  const claudeMd = join(s.home, '.claude', 'CLAUDE.md');
  const ratchet = join(s.home, '.claude', 'ratchet.md');
  writeFileSync(claudeMd, readFileSync(claudeMd, 'utf8').replace('@~/.claude/ratchet-preset.md\n', ''));
  const preset = presetRuleEntries()[0].ko;
  writeFileSync(ratchet, `${readFileSync(ratchet, 'utf8')}- 2026-09-15: ${preset}\n- 2026-09-20: 사용자가 직접 쓴 룰\n`);

  const out = s.run(['install']);
  assert.match(out, /추천 룰 1건을 .*ratchet-preset\.md 로 옮겼습니다/);

  const own = readFileSync(ratchet, 'utf8');
  assert.ok(own.includes('사용자가 직접 쓴 룰'), 'a rule the user wrote stays in ratchet.md');
  assert.ok(!own.includes(preset), 'the preset leaves ratchet.md');
  assert.ok(existsSync(`${ratchet}.bak-preset-migration`), 'the original is kept');

  const presetFile = readFileSync(join(s.home, '.claude', 'ratchet-preset.md'), 'utf8');
  assert.ok(presetFile.includes(preset), 'the moved preset is rendered in the preset file');
  assert.ok(ruleLines(presetFile) >= 2, 'the automatic install adds the rest');

  // A second run must not add the import again or move anything twice.
  s.run(['install']);
  assert.equal((readFileSync(claudeMd, 'utf8').match(/^@~\/\.claude\/ratchet-preset\.md$/gm) || []).length, 1);
});

test('skipping an accepted preset removes it from the file, and reset empties it', (t) => {
  const s = sandbox(t);
  s.run(['install']);
  const file = join(s.home, '.claude', 'ratchet-preset.md');
  const before = readFileSync(file, 'utf8');
  const id = before.match(/^- \[(fix-[0-9a-f]{6})\]/m)[1];
  assert.match(s.run(['seed', 'skip', id]), /프리셋 파일에서 뺐습니다/);
  const after = readFileSync(file, 'utf8');
  assert.equal(ruleLines(after), ruleLines(before) - 1);
  assert.ok(!after.includes(`[${id}]`));
  assert.match(s.run(['harness', 'list', '--global']), /Preset rules \[global\]/);

  s.run(['seed', 'reset']);
  assert.equal(ruleLines(readFileSync(file, 'utf8')), 0, 'the file mirrors the recorded answers');
  // Presets never go to ratchet.md when accepted globally.
  s.run(['seed', 'accept', 'all', '--global']);
  assert.ok(ruleLines(readFileSync(file, 'utf8')) > 0);
  assert.doesNotMatch(readFileSync(join(s.home, '.claude', 'ratchet.md'), 'utf8'), /^- \d{4}-/m);
});

test('Codex reads its preset file at session start', (t) => {
  const s = sandbox(t, { codex: true });
  s.run(['install']);
  const file = join(s.home, '.codex', 'ratchet-preset.md');
  assert.ok(ruleLines(readFileSync(file, 'utf8')) > 0, 'the automatic install registers Codex presets');
  const out = JSON.parse(s.run(['codex-hook', '--event', 'session-start', '--agent', 'codex'],
    JSON.stringify({ cwd: s.dir, source: 'startup' })));
  assert.match(out.hookSpecificOutput.additionalContext, /\[Sprag Codex ratchet: preset\]/);
});
