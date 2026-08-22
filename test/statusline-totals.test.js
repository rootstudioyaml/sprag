/**
 * Multi-line statusline: when the delegation ledger carries lifetime savings,
 * a "Routing saved weekly $x · monthly $y · total $z" headline owns line 1 and every
 * other chip moves to line 2. --single-line and an empty ledger both fall
 * back to the legacy one-line layout. The savings ledger itself is covered
 * here too (upsert dedupe + rolling-window sums).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport } from '../src/formatters/statusline.js';

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 3.2,
    delegationTotals: { week: 1.25, month: 4.5, total: 9.75 },
    ...extra,
  };
}

const opts = { color: false, timer: false };

test('totals headline takes line 1, diagnostics take line 2', () => {
  const out = formatReport(data(), opts);
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Routing saved weekly \$1\.25 · monthly \$4\.50 · total \$9\.75$/);
  assert.match(lines[1], /Cache hit/);
  assert.match(lines[1], /Cache saved/);
  assert.doesNotMatch(lines[1], /Routing saved/, 'inline session chip is dropped when the headline renders');
});

test('icon mode keeps the 🔀 prefix on the headline', () => {
  const out = formatReport(data(), { ...opts, mode: 'icon' });
  assert.match(out.split('\n')[0], /^🔀 Routing saved weekly \$1\.25/);
});

test('--single-line falls back to the legacy layout', () => {
  const out = formatReport(data(), { ...opts, singleLine: true });
  assert.ok(!out.includes('\n'));
  assert.match(out, /Routing saved \$3\.2/, 'inline session chip returns');
});

test('empty or missing totals mean one line', () => {
  for (const totals of [null, undefined, { week: 0, month: 0, total: 0 }]) {
    const out = formatReport(data({ delegationTotals: totals }), opts);
    assert.ok(!out.includes('\n'), `totals ${JSON.stringify(totals)} should not add a line`);
  }
});

test('segment whitelist without "delegated" suppresses the headline', () => {
  const out = formatReport(data(), { ...opts, segments: ['hit', 'saved'] });
  assert.ok(!out.includes('\n'));
  assert.doesNotMatch(out, /Routing saved/);
});

test('no-color multi-line output carries no ANSI escapes', () => {
  assert.doesNotMatch(formatReport(data(), opts), /\x1b\[/);
});

test('ledger: upserts dedupe by run path and totals honor rolling windows', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ledger-'));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  const { recordDelegationEvents, delegationSavedTotals } = await import('../src/savings-ledger.js');
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  recordDelegationEvents([
    { key: '/a.jsonl', ts: now - 2 * day, usd: 1 },        // in week + month
    { key: '/b.jsonl', ts: now - 10 * day, usd: 2 },       // month only
    { key: '/c.jsonl', ts: now - 60 * day, usd: 4 },       // lifetime only
    { key: '/a.jsonl', ts: now - 2 * day, usd: 1 },        // duplicate — ignored
    { key: '/zero.jsonl', ts: now, usd: 0 },               // zero saving — skipped
  ]);
  const totals = delegationSavedTotals(now);
  assert.equal(totals.week, 1);
  assert.equal(totals.month, 3);
  assert.equal(totals.total, 7);
});

test('amounts render in the savings green, period markers in gray', () => {
  const out = formatReport(data(), { timer: false }).split('\n')[0];
  // The palette degrades to the 8-color codes when the terminal does not
  // advertise truecolor, so the expected escapes depend on the environment
  // the suite runs in — same branch the formatter takes.
  const truecolor =
    process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
  const GREEN = truecolor ? '\x1b[38;2;52;211;153m' : '\x1b[32m';
  const GRAY = truecolor ? '\x1b[38;2;100;116;139m' : '\x1b[90m';
  for (const amount of ['$1.25', '$4.50', '$9.75']) {
    assert.ok(out.includes(`${GREEN}${amount}`), `${amount} should be green`);
  }
  for (const label of ['weekly', 'monthly', 'total']) {
    assert.ok(out.includes(`${GRAY}${label}`), `${label} should stay gray`);
  }
});

test('ledger v1 events are discarded, not mixed into v2 totals', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ledger-v1-'));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const stateDir = join(dir, 'claude-token-saver');
  mkdirSync(stateDir, { recursive: true });
  // v1 priced against the session's priciest model — a different meaning.
  writeFileSync(
    join(stateDir, 'delegation-ledger.json'),
    JSON.stringify({ events: { '/old.jsonl': { ts: Date.now(), usd: 99 } } }),
  );
  const m = await import('../src/savings-ledger.js?v1');
  assert.deepEqual(m.delegationSavedTotals(), { week: 0, month: 0, total: 0, pairs: [] });

  // A v2 write starts the file over and stamps the version.
  m.recordDelegationEvents([
    { key: '/new.jsonl', ts: Date.now(), usd: 0.5, rule: 'T1|run|p', from: 'claude-fable-5', to: 'claude-sonnet-5' },
  ]);
  const led = m.loadLedger();
  assert.equal(led.version, 2);
  assert.equal(Object.keys(led.events).length, 1);
  assert.deepEqual(led.events['/new.jsonl'], {
    ts: led.events['/new.jsonl'].ts,
    usd: 0.5,
    rule: 'T1|run|p',
    from: 'claude-fable-5',
    to: 'claude-sonnet-5',
  });
});

test('ledger events keep the model change and the rule that caused it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ledger-pair-'));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  const m = await import('../src/savings-ledger.js?pair');
  m.recordDelegationEvents([
    { key: '/a.jsonl', ts: Date.now(), usd: 0.5, rule: 'T2|run|p', from: 'claude-opus-5', to: 'claude-haiku-4-5' },
    { key: '/b.jsonl', ts: Date.now(), usd: 0.2, rule: 'T1|paste|p', from: 'claude-fable-5', to: 'claude-sonnet-5' },
  ]);
  const evs = m.loadLedger().events;
  assert.equal(evs['/a.jsonl'].from, 'claude-opus-5');
  assert.equal(evs['/a.jsonl'].to, 'claude-haiku-4-5');
  assert.equal(evs['/a.jsonl'].rule, 'T2|run|p');
  assert.equal(evs['/b.jsonl'].from, 'claude-fable-5');
  // Every recorded dollar can be traced to a model change — nothing lands
  // without one, which is what makes `route-scan savings` auditable.
  for (const e of Object.values(evs)) {
    assert.ok(e.from && e.to && e.rule, 'each event carries rule/from/to');
  }
});

test('the headline names every model change, version-free', async () => {
  const { modelFamily } = await import('../src/savings-ledger.js');
  assert.equal(modelFamily('claude-opus-4-5-20251101-v1:0'), 'opus');
  assert.equal(modelFamily('us.anthropic.claude-haiku-4-5-v1:0'), 'haiku');
  assert.equal(modelFamily('claude-fable-5'), 'fable');
  assert.equal(modelFamily('prod-large'), 'prod-large', 'unmapped ids stay visible');

  const totals = {
    week: 1, month: 2, total: 2,
    pairs: [
      { from: 'fable', to: 'sonnet', runs: 1, usd: 0.72 },
      { from: 'opus', to: 'haiku', runs: 2, usd: 0.57 },
      { from: 'opus', to: 'sonnet', runs: 5, usd: 0.11 },
    ],
  };
  const line = formatReport(data({ delegationTotals: totals }), opts).split('\n')[0];
  assert.match(line, /fable→sonnet 1× \$0\.72/);
  assert.match(line, /opus→haiku 2× \$0\.57/);
  // Every pair is listed: the amounts sit next to a total, so a truncated
  // list would misstate what the total is made of.
  assert.match(line, /opus→sonnet 5× \$0\.11/);
  assert.doesNotMatch(line, /[45]-5|20251101/, 'no version digits reach the line');
});

test('no pairs means the headline is unchanged', () => {
  for (const pairs of [undefined, [], null]) {
    const line = formatReport(data({ delegationTotals: { week: 1, month: 2, total: 2, pairs } }), opts).split('\n')[0];
    assert.equal(line, 'Routing saved weekly $1.00 · monthly $2.00 · total $2.00');
  }
});
