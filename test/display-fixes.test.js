// Regression tests for the display findings of the 2026-10-01 review (E1–E4):
// table colour, the Korean label in the English report, the default period the
// docs name, the help listing, and model and reset parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTableDemoData } from '../src/demo.js';
import { formatReport } from '../src/formatters/table.js';
import { bedrockDisplayFromId, extractCaps } from '../src/stdin-payload.js';
import { estimateCost } from '../src/cost.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const ANSI = /\x1b\[/;
const emptyHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'cts-display-'));
  return childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'cfg'), APPDATA: join(home, 'cfg') });
};

test('the table report takes its colour from the caller', () => {
  const data = buildTableDemoData({ version: '0.0.0' });
  assert.match(formatReport(data, { color: true }), ANSI);
  assert.doesNotMatch(formatReport(data, { color: false }), ANSI);
});

test('--no-color and a piped stdout both give a plain table', () => {
  // execFileSync pipes stdout, so even without the flag no escape code may
  // appear: this is `sprag | less`.
  for (const args of [['--demo', 'table'], ['--demo', 'table', '--no-color']]) {
    const out = execFileSync(process.execPath, [CLI, ...args], { env: emptyHome(), encoding: 'utf8' });
    assert.match(out, /Token spike detected/);
    assert.doesNotMatch(out, ANSI, `escape codes in: sprag ${args.join(' ')}`);
  }
});

test('the English report carries no Korean label', () => {
  const out = formatReport(buildTableDemoData({ version: '0.0.0' }), { color: false });
  assert.doesNotMatch(out, /[가-힣]/);
  assert.match(out, /How to handle it: .* last/);
});

test('a loss in the cost table reads as -$, not $-', () => {
  const data = buildTableDemoData({ version: '0.0.0' });
  data.cost = { ...data.cost, savings: -3.2, savingsRate: -0.1, extraCostIf5m: -1.5, extraCostIf5mApplicable: true };
  const out = formatReport(data, { color: false });
  assert.match(out, /Savings\s+│\s+-\$3\.2 \(-10\.0%\)/);
  assert.match(out, /Extra cost if 5m-only\s+│\s+-\$1\.5/);
  assert.doesNotMatch(out, /\$-/);
});

test('the docs name the default period the code uses', () => {
  assert.match(read('bin/cli.js'), /let windowHours = 30 \* 24;/);
  assert.match(read('docs/COMMANDS.md'), /\| `sprag` \| Last-30-day diagnostic report/);
  assert.match(read('docs/COMMANDS.ko.md'), /\| `sprag` \| 최근 30일 진단 리포트/);
  assert.match(read('README.md'), /\| `sprag` \| Last-30-day diagnostic report/);
  assert.match(read('README.ko.md'), /\| `sprag` \| 최근 30일 진단 리포트/);
  assert.match(read('src/installer.js'), /full table report \(default last 30 days\)/);
});

test('--help lists every subcommand the CLI dispatches', () => {
  const known = read('bin/cli.js').match(/const KNOWN_SUBCOMMANDS = new Set\(\[([\s\S]*?)\]\)/)[1]
    .match(/'([a-z0-9-]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(known.length >= 20);
  const help = execFileSync(process.execPath, [CLI, '--help'], { env: emptyHome(), encoding: 'utf8' });
  for (const name of known) {
    assert.match(help, new RegExp(`^\\s+sprag ${name}\\b`, 'm'), `--help does not mention: ${name}`);
  }
});

test('a model id with no minor version does not print its date stamp', () => {
  assert.equal(bedrockDisplayFromId('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(bedrockDisplayFromId('anthropic.claude-sonnet-4-20250514-v1:0'), 'Sonnet 4');
  assert.equal(bedrockDisplayFromId('global.anthropic.claude-opus-4-7-20251001-v1:0'), 'Opus 4.7');
  assert.equal(bedrockDisplayFromId('bedrock/anthropic.claude-haiku-4-5'), 'Haiku 4.5');
  assert.equal(bedrockDisplayFromId('claude-opus-4-1'), 'Opus 4.1');
});

test('a null reset time stays null instead of becoming 1970', () => {
  const caps = (resets_at) => extractCaps({ rate_limits: { five_hour: { used_percentage: 50, resets_at } } }).windows[0].resetsAt;
  assert.equal(caps(null), null);
  assert.equal(caps(undefined), null);
  assert.equal(caps(''), null);
  assert.equal(caps(0), null);
  assert.equal(caps(1777099200), 1777099200);
  assert.equal(caps('1777099200'), 1777099200);
});

test('version-first Haiku ids are priced at their own tier', () => {
  const totals = { input: 1_000_000, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
  assert.equal(estimateCost(totals, 'claude-3-5-haiku-20241022').tier, 'claude-haiku-3-5');
  assert.equal(estimateCost(totals, 'claude-3-haiku-20240307').tier, 'claude-haiku-3');
  assert.equal(estimateCost(totals, 'claude-haiku-3-5').tier, 'claude-haiku-3-5');
  assert.equal(estimateCost(totals, 'claude-haiku-4-5-20251001').tier, 'claude-haiku-4-5');
});
