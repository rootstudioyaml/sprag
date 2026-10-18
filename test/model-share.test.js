/**
 * Model share: the cost split by family behind the statusline's bar and the
 * table `sprag saved` prints. Pure functions first, then the real CLI over a
 * sandbox HOME, because the data assembly lives inline in bin/cli.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundShares, computeModelShare, shareLegend } from '../src/model-share.js';
import { resetSaved } from '../src/saved-reset.cjs';
import { childEnv } from './helpers/child-env.js';
import { makeHome, writeSession, renderStatusline, strip } from './helpers/statusline-home.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('roundShares: largest remainder, exact sum, ties keep order', () => {
  assert.deepEqual(roundShares([71.2, 21.9, 6.9], 10), [7, 2, 1]);
  const hundred = roundShares([71.2, 21.9, 6.9], 100);
  assert.equal(sum(hundred), 100);
  assert.deepEqual(roundShares([1, 1, 1], 10), [4, 3, 3]);
  assert.deepEqual(roundShares([0, 0], 10), [0, 0]);
  assert.deepEqual(roundShares([5], 10), [10]);
  assert.deepEqual(roundShares([], 10), []);
});

const totals = (output) => ({
  input: 10, cacheCreation: 0, cacheRead: 0, output,
  cacheCreation5m: 0, cacheCreation1h: 0,
});
const NOENV = { env: {} };

test('computeModelShare: families, subagent share and unpriced parts', () => {
  const sessions = [{
    model: 'claude-opus-5',
    totals: totals(1_000_000),
    subagentRuns: [
      { model: 'claude-haiku-5', totals: totals(1_000_000) },
      { model: 'claude-sonnet-5', totals: totals(1_000_000) },
    ],
  }];
  const r = computeModelShare(sessions, NOENV);
  assert.equal(r.unpriced, 0);
  assert.deepEqual(r.families.map((f) => f.family).sort(), ['haiku', 'opus', 'sonnet']);
  assert.ok(Math.abs(sum(r.families.map((f) => f.pct)) - 100) < 1e-6);
  assert.ok(Math.abs(sum(r.families.map((f) => f.usd)) - r.totalUsd) < 1e-9);
  assert.ok(r.families[0].usd >= r.families[1].usd, 'sorted by usd descending');
  const opus = r.families.find((f) => f.family === 'opus');
  assert.ok(opus.usd > 0);
  assert.deepEqual(r.subagent.families.map((f) => f.family).sort(), ['haiku', 'sonnet']);
  assert.ok(Math.abs(r.subagent.usd - (r.totalUsd - opus.usd)) < 1e-9);
  assert.ok(Math.abs(r.subagent.pct - (100 - opus.pct)) < 1e-6);
});

// A direct call prices any model (unknown ids fall back to a default tier), so
// "no price" only happens behind a gateway whose price table lacks the model.
const GATEWAY_NO_PRICES = { env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' } };

test('computeModelShare: nothing priced means no families', () => {
  const r = computeModelShare([{ model: 'claude-opus-5', totals: totals(1_000_000) }], GATEWAY_NO_PRICES);
  assert.equal(r.totalUsd, 0);
  assert.deepEqual(r.families, []);
  assert.equal(r.unpriced, 1);
  assert.deepEqual(computeModelShare([], NOENV).families, []);
});

const fams = [
  { family: 'opus', usd: 71.2 },
  { family: 'sonnet', usd: 21.9 },
  { family: 'haiku', usd: 6.9 },
];

test('shareLegend: coloured dot, name and whole percent; a share under 1% reads <1%', () => {
  assert.equal(shareLegend(fams, { color: false }), 'Opus 71%  Sonnet 22%  Haiku 7%');
  const coloured = shareLegend(fams, { color: true });
  assert.match(coloured, /\x1b\[/);
  assert.equal(strip(coloured), '● Opus 71%  ● Sonnet 22%  ● Haiku 7%');
  const nums = shareLegend(fams, { color: false }).match(/\d+(?=%)/g).map(Number);
  assert.equal(sum(nums), 100);
  assert.equal(shareLegend([{ family: 'opus', usd: 1000 }, { family: 'haiku', usd: 0.001 }], { color: false }), 'Opus 100%  Haiku <1%');
  assert.equal(shareLegend([{ family: 'opus', usd: 1 }, { family: 'haiku', usd: 0 }], { color: false }), 'Opus 100%', 'a family that spent nothing is left out');
  assert.equal(shareLegend([{ family: 'gemma', usd: 1 }, { family: 'fable', usd: 1 }], { color: false }), 'gemma 50%  Fable 50%');
  assert.equal(shareLegend([], { color: false }), '');
});

// ---------------------------------------------------------------------------
// Real CLI
// ---------------------------------------------------------------------------

function sandboxWithSessions() {
  const home = makeHome('sprag-share-');
  // Costs are rounded to the cent, so the fixture has to spend real money:
  // about $10 on opus in the session and $1 on haiku in its subagent.
  writeSession(home, { sessionId: 'main-1', model: 'claude-opus-5', output: 400_000, subagents: ['claude-haiku-5'], subagentOutput: 200_000 });
  // A reset mark inside the window makes the savings chip appear (a dated zero).
  resetSaved(['routing'], { dir: home.dataDir, now: Date.now() - 3600_000 });
  return home;
}

test('statusline: the share legend follows the Routing saved chip; no-share removes it', (t) => {
  const home = sandboxWithSessions();
  t.after(home.cleanup);
  const out = renderStatusline(home, {}, { args: ['--single-line'] });
  assert.match(out, /Routing saved \$0\.00 since \S+  \|  (?:\S+ )?Model used Opus \d+%  Haiku \d+%/);
  const multi = renderStatusline(home, {});
  assert.match(multi.split('\n')[0], /Routing saved .*  \|  (?:\S+ )?Model used Opus \d+%/);

  writeFileSync(join(home.dir, 'cfg', 'claude-token-saver', 'config.json'), JSON.stringify({ statusline: { modelShare: false } }));
  const off = renderStatusline(home, {}, { args: ['--single-line'] });
  assert.match(off, /Routing saved/);
  assert.doesNotMatch(off, /Model used|Opus \d+%/);
});

test('sprag saved prints the model-share table', (t) => {
  const home = sandboxWithSessions();
  t.after(home.cleanup);
  const out = strip(execFileSync(process.execPath, [CLI, 'saved'], {
    cwd: home.project,
    env: childEnv({ HOME: home.dir, XDG_CONFIG_HOME: join(home.dir, 'cfg'), APPDATA: join(home.dir, 'cfg'), NO_COLOR: '1', SPRAG_NO_UPDATE_CHECK: '1', LANG: 'en_US.UTF-8' }),
    encoding: 'utf8',
  }));
  assert.match(out, /Model share|모델별 사용 비중/);
  assert.match(out, /Opus\s+█*░*\s+\d+\.\d%\s+\$/);
  assert.match(out, /Haiku\s+[█░]{20}\s+\d+\.\d%\s+\$/);
  assert.match(out, /Subagents: \d+% \(haiku \d+%\)|서브에이전트 몫: \d+% \(haiku \d+%\)/);
});
