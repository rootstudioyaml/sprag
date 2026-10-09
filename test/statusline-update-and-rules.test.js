/**
 * Two verbose-only chips that describe setup rather than the next minute:
 *
 *   rules 10 · ⚠1     the delegation rules that apply here, and how many are
 *                     flagged for review (the same `review` status that raises
 *                     the 🅷 `rule-health` warning)
 *   v3.59.0 ✓6h       the running version is the latest, as of the last time the
 *                     registry was asked
 *
 * Neither appears in the default layout. The update chip's existing behaviour
 * when a newer release exists is unchanged and checked here too, because the
 * new age suffix shares its builder.
 *
 * The formatter cases pin the rendering. The CLI cases pin the wiring: the
 * counts are computed in bin/cli.js (and only when verbose, so the default
 * render pays nothing for them), and the age needs `checkedAt` carried out of
 * the update-check state file, which the existing status object does not hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport } from '../src/formatters/statusline.js';
import { delegationRuleStats } from '../src/statusline-data.js';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

const PKG_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).version;
const HOUR = 3600 * 1000;

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d', version: '3.59.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 0,
    ...extra,
  };
}

const opts = { color: false, timer: false };

// ---------------------------------------------------------------------------
// Rule counts
// ---------------------------------------------------------------------------

const RULES = ['rules'];

test('the rules chip counts the registry and the rules flagged for review', () => {
  const d = data({ ruleStats: { total: 10, review: 1 } });
  for (const mode of [undefined, 'icon', 'narrow']) {
    assert.match(formatReport(d, { ...opts, mode, segments: RULES }), /rules 10 · ⚠1/, `mode ${mode}`);
  }
});

test('a healthy registry reads as a bare count', () => {
  const out = formatReport(data({ ruleStats: { total: 4, review: 0 } }), { ...opts, segments: RULES });
  assert.match(out, /rules 4\b/);
  assert.doesNotMatch(out, /rules 4 · ⚠/, 'no ⚠ when nothing is flagged');
});

test('the chip is opt-in: no layout shows it unless --segments names it', () => {
  const d = data({ ruleStats: { total: 10, review: 1 } });
  // Verbose is the shipped default, so verbose must not be enough on its own.
  for (const verbose of [false, true]) {
    assert.doesNotMatch(formatReport(d, { ...opts, verbose }), /rules/, `verbose ${verbose}`);
    assert.doesNotMatch(formatReport(d, { ...opts, verbose, segments: ['harness'] }), /rules/, 'harness alone does not bring it');
  }
});

test('no registry, or an empty one, shows nothing', () => {
  for (const stats of [undefined, null, { total: 0, review: 0 }, { total: 'x' }]) {
    const out = formatReport(data({ ruleStats: stats }), { ...opts, segments: RULES });
    assert.doesNotMatch(out, /rules/, `${JSON.stringify(stats)} must render no chip`);
  }
});

test('the chip can be asked for alone, and is printed once beside harness', () => {
  const d = data({ ruleStats: { total: 10, review: 1 } });
  const only = formatReport(d, { ...opts, segments: RULES });
  assert.match(only, /^rules 10 · ⚠1$/);
  const both = formatReport(d, { ...opts, segments: ['harness', 'rules'] });
  assert.equal(both.split('rules 10').length - 1, 1);
});

test('delegationRuleStats counts what applies here and skips what does not', async (t) => {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'sprag-rules-'));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, 'claude-token-saver'), { recursive: true });
  const rule = (extra) => ({ tier: 'T2', category: 'check', signature: 's', status: 'active', ...extra });
  writeFileSync(join(dir, 'claude-token-saver', 'model-rules.json'), JSON.stringify({
    rules: [
      rule({ scope: 'global' }),
      rule({ scope: 'global', status: 'review' }),
      rule({ scope: 'global', status: 'off' }),                       // switched off: not counted
      rule({ scope: 'project', targetRoot: '/work/here' }),
      rule({ scope: 'project', targetRoot: '/work/here', status: 'review' }),
      rule({ scope: 'project', targetRoot: '/work/elsewhere', status: 'review' }), // another project's
    ],
  }));
  assert.deepEqual(delegationRuleStats('/work/here'), { total: 4, review: 2 });
  assert.deepEqual(delegationRuleStats('/work/elsewhere'), { total: 3, review: 2 });
  // No registry at all is zero, not an error.
  rmSync(join(dir, 'claude-token-saver', 'model-rules.json'));
  assert.deepEqual(delegationRuleStats('/work/here'), { total: 0, review: 0 });
});

// ---------------------------------------------------------------------------
// Update age
// ---------------------------------------------------------------------------

const upToDate = (checkedAgoMs, extra = {}) => ({
  update: { available: false, latest: '3.59.0', checkedAt: Date.now() - checkedAgoMs, ...extra },
});

test('verbose shows how long ago the version was last confirmed', () => {
  const out = formatReport(data(upToDate(6 * HOUR)), { ...opts, verbose: true });
  assert.match(out, /v3\.59\.0 ✓6h/);
  assert.match(formatReport(data(upToDate(6 * HOUR)), { ...opts, verbose: true, mode: 'icon' }), /v3\.59\.0 ✓6h/);
});

test('the age steps through minutes, hours and days', () => {
  const age = (ms) => formatReport(data(upToDate(ms)), { ...opts, verbose: true }).match(/✓(\S+)/)?.[1];
  assert.equal(age(20 * 1000), '<1m');
  assert.equal(age(45 * 60 * 1000), '45m');
  assert.equal(age(3 * HOUR + 59 * 60 * 1000), '3h');
  assert.equal(age(23 * HOUR), '23h');
  assert.equal(age(50 * HOUR), '2d');
});

test('the default layout keeps the bare version', () => {
  const out = formatReport(data(upToDate(6 * HOUR)), opts);
  assert.match(out, /v3\.59\.0(?! ✓)/);
  assert.doesNotMatch(out, /✓/);
});

test('nothing is claimed without a recorded check or a known latest version', () => {
  for (const update of [
    { available: false, latest: '3.59.0' },                                   // no checkedAt
    { available: false, latest: '3.59.0', checkedAt: null },
    { available: false, latest: null, checkedAt: Date.now() - HOUR },         // never got an answer
    { available: false, latest: '3.59.0', checkedAt: Date.now() + HOUR },     // clock skew
    null,
  ]) {
    const out = formatReport(data({ update }), { ...opts, verbose: true });
    assert.doesNotMatch(out, /✓\d|✓</, `${JSON.stringify(update)} must not claim a check`);
    assert.match(out, /v3\.59\.0/, 'the version itself still shows');
  }
});

test('an available update keeps its chip exactly as before', () => {
  const update = { available: true, latest: '3.60.0', checkedAt: Date.now() - HOUR };
  const out = formatReport(data({ update }), { ...opts, mode: 'icon', verbose: true });
  assert.match(out, /⬆ Update v3\.59\.0 → 3\.60\.0/);
  assert.doesNotMatch(out, /✓\d/);
  assert.match(formatReport(data({ update }), { ...opts, mode: 'icon' }), /⬆ v3\.59\.0 → 3\.60\.0/);
});

test('the age is dim, like the version it qualifies', () => {
  const truecolor = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
  const GRAY = truecolor ? '\x1b[38;2;100;116;139m' : '\x1b[90m';
  const out = formatReport(data(upToDate(6 * HOUR)), { timer: false, verbose: true });
  assert.ok(out.includes(`${GRAY}v3.59.0 ✓6h`), 'version and age share one gray span');
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI
// ---------------------------------------------------------------------------

const PAYLOAD = { model: { display_name: 'Opus 5' }, context_window: { context_window_size: 1000000, used_percentage: 12 } };

test('the CLI computes the rule counts only when --segments asks for them', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-rules' });
    const rule = (extra) => ({ tier: 'T2', category: 'check', signature: 's', status: 'active', scope: 'global', ...extra });
    writeFileSync(join(home.dataDir, 'model-rules.json'), JSON.stringify({
      rules: [rule(), rule({ status: 'review' }), rule({ status: 'off' }), rule()],
    }));
    const named = renderStatusline(home, PAYLOAD, { args: ['--segments', 'rules'] });
    assert.match(named, /rules 3 · ⚠1/, 'three active (one off is skipped), one in review');
    // Verbose is the shipped default; it must not bring the chip along.
    assert.doesNotMatch(renderStatusline(home, PAYLOAD, { args: ['--verbose'] }), /rules \d/, 'not in the default verbose layout');
  } finally {
    home.cleanup();
  }
});

test('the CLI carries the last check time out of the update state', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-update' });
    // A check six hours ago is inside the 24h interval, so the render neither
    // refreshes nor spawns anything, and the state file stays as written.
    writeFileSync(join(home.dataDir, 'update-check.json'), JSON.stringify({
      checkedAt: Date.now() - 6 * HOUR, latest: PKG_VERSION, current: PKG_VERSION,
    }));
    const env = { CTS_NO_UPDATE_CHECK: undefined };
    const verbose = renderStatusline(home, PAYLOAD, { args: ['--verbose'], env });
    assert.match(verbose, new RegExp(`v${PKG_VERSION.replace(/\./g, '\\.')} ✓6h`));
    assert.doesNotMatch(renderStatusline(home, PAYLOAD, { args: ['--no-verbose'], env }), /✓/, 'bare version when compact');
    // With checks switched off the state file is a leftover and says nothing.
    const off = renderStatusline(home, PAYLOAD, { args: ['--verbose'], env: { CTS_NO_UPDATE_CHECK: '1' } });
    assert.doesNotMatch(off, /✓\d/);
  } finally {
    home.cleanup();
  }
});

test('the CLI leaves an available update alone', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-newer' });
    writeFileSync(join(home.dataDir, 'update-check.json'), JSON.stringify({
      checkedAt: Date.now() - HOUR, latest: '99.0.0', current: PKG_VERSION,
    }));
    const out = renderStatusline(home, PAYLOAD, { args: ['--verbose'], env: { CTS_NO_UPDATE_CHECK: undefined } });
    assert.match(out, new RegExp(`⬆ Update v${PKG_VERSION.replace(/\./g, '\\.')} → 99\\.0\\.0`));
    assert.doesNotMatch(out, /✓\d/);
  } finally {
    home.cleanup();
  }
});
