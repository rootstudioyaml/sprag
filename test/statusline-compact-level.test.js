/**
 * Compact levels 0..3. Level 0 and 1 are the existing verbose and short-label
 * layouts and must render byte for byte as before; 2 and 3 fold the headline
 * lines and trim the default chips. An explicit `--segments` list is never
 * trimmed by the level.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.js resolves its file when first loaded, and the formatter pulls it in
// transitively, so the temp dir is set before anything from src/ is imported.
const tmp = mkdtempSync(join(tmpdir(), 'cts-compact-'));
const prevXdg = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = tmp;
const { formatReport, formatNoSession } = await import('../src/formatters/statusline.js');
const config = await import('../src/config.js');

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function rich({ fiveHourPct = 95 } = {}) {
  const totals = {
    week: 0, month: 0, total: 3.2, spent: 0, spentMissing: 0, since: null,
    pairs: [{ from: 'opus', to: 'haiku', runs: 2, usd: 2.1 }, { from: 'opus', to: 'sonnet', runs: 1, usd: 1.1 }],
  };
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d', version: '3.0.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [{ key: 'five_hour', usedPct: fiveHourPct }, { key: 'seven_day', usedPct: 10 }] },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 3.2,
    delegationTotals: totals,
    doc2mdTotals: { total: 1.8, docs: 3 },
    modelShare: { totalUsd: 10, families: [{ family: 'opus', usd: 9 }, { family: 'haiku', usd: 1 }], since: Date.now() - 86400000 },
    monthSpend: { label: 'Sep', usd: 804 },
    team: { label: 'member-1a2b3c4d', lang: 'en', standing: null },
  };
}

const opts = { color: false, timer: false, mode: 'icon' };

test('level 0 and level 1 render exactly as verbose:true and verbose:false did', () => {
  for (const columns of [0, 120]) {
    const verbose = formatReport(rich(), { ...opts, verbose: true, columns });
    const short = formatReport(rich(), { ...opts, verbose: false, columns });
    assert.equal(formatReport(rich(), { ...opts, verbose: true, columns, compactLevel: 0 }), verbose);
    assert.equal(formatReport(rich(), { ...opts, verbose: false, columns, compactLevel: 1 }), short);
    // Level 1 means short labels even if the caller left verbose on.
    assert.equal(formatReport(rich(), { ...opts, verbose: true, columns, compactLevel: 1 }), short);
    assert.notEqual(verbose, short, 'the two label styles differ on this fixture');
  }
  assert.match(strip(formatReport(rich(), { ...opts, columns: 120 })), /Routing saved/, 'the headline line is there at level 0');
});

test('level 2 folds the headline lines and drops the extra chips', () => {
  const out = strip(formatReport(rich(), { ...opts, compactLevel: 2, columns: 120 }));
  assert.doesNotMatch(out, /Routing saved|Effort guard/, 'no headline line');
  assert.doesNotMatch(out, /member-/, 'no team line');
  assert.match(out, /🔀/, 'the routing chip stands in for the headline');
  for (const [name, glyph] of [['hit', '🧠'], ['saved', '💰']]) {
    assert.ok(!out.includes(glyph), `${name} chip is gone`);
  }
  assert.doesNotMatch(out, /Sep|Model used|Doc2md|📄/, 'month, share and doc2md chips are gone');
  for (const [name, glyph] of [['cap-warn', '🚨'], ['ctx', '📦'], ['usage', '📅'], ['model', '🤖']]) {
    assert.ok(out.includes(glyph), `${name} chip stays`);
  }
  assert.ok(out.split('\n').length <= 2, 'at most two lines');
});

test('level 2 keeps the version chip only while an upgrade is available', () => {
  const plain = strip(formatReport(rich(), { ...opts, compactLevel: 2, columns: 120 }));
  const upgrade = strip(formatReport({ ...rich(), update: { available: true, latest: '9.9.9' } }, { ...opts, compactLevel: 2, columns: 120 }));
  assert.doesNotMatch(plain, /9\.9\.9|3\.0\.0/);
  assert.match(upgrade, /9\.9\.9/);
});

test('level 3 keeps only the chips that stop the work, on one line', () => {
  const out = strip(formatReport(rich(), { ...opts, compactLevel: 3, columns: 100 }));
  assert.ok(!out.includes('🤖'), 'model chip is gone');
  assert.ok(!out.includes('🔀'), 'routing chip is gone');
  assert.doesNotMatch(out, /Routing saved|member-/);
  for (const glyph of ['🚨', '📦', '📅']) assert.ok(out.includes(glyph), `${glyph} stays`);
  assert.equal(out.split('\n').length, 1, 'one line');
  // A narrow terminal gives up the tail, never the chips that stop the work.
  const narrow = strip(formatReport(rich(), { ...opts, compactLevel: 3, columns: 30 }));
  for (const glyph of ['🚨', '📦']) assert.ok(narrow.includes(glyph), `${glyph} survives a narrow terminal`);
});

test('level 3 drops the running-subagents chip, level 2 keeps it', () => {
  const running = { count: 2, families: [], lang: 'en' };
  const d = { ...rich(), runningSubagents: running };
  const base2 = strip(formatReport(rich(), { ...opts, compactLevel: 2, columns: 120 }));
  const with2 = strip(formatReport(d, { ...opts, compactLevel: 2, columns: 120 }));
  const base3 = strip(formatReport(rich(), { ...opts, compactLevel: 3, columns: 120 }));
  const with3 = strip(formatReport(d, { ...opts, compactLevel: 3, columns: 120 }));
  assert.notEqual(with2, base2, 'running chip shows at level 2');
  assert.equal(with3, base3, 'and not at level 3');
});

test('an explicit segments list is not trimmed by the level', () => {
  const out = strip(formatReport(rich(), { ...opts, compactLevel: 2, columns: 120, segments: ['month', 'ctx'] }));
  assert.match(out, /Sep/, 'month was asked for by name');
  assert.ok(out.includes('📦'));
  assert.ok(!out.includes('🧠'), 'and the list is still a whitelist');
  // Level 3 keeps the whitelist too; only the one-line budget applies.
  const three = strip(formatReport(rich(), { ...opts, compactLevel: 3, columns: 120, segments: ['month', 'ctx'] }));
  assert.match(three, /Sep/);
});

test('formatNoSession trims by level', () => {
  const input = {
    caps: { windows: [{ key: 'five_hour', usedPct: 95 }] },
    model: 'Opus 5', effort: 'high', version: '3.0.0', windowLabel: '1d',
    team: { label: 'member-1a2b3c4d', lang: 'en', standing: null },
  };
  const full = strip(formatNoSession(input, { ...opts, columns: 120 }));
  assert.match(full, /Opus/);
  assert.match(full, /member-/);
  assert.equal(formatNoSession(input, { ...opts, columns: 120, compactLevel: 1 }), formatNoSession(input, { ...opts, columns: 120 }));

  const two = strip(formatNoSession(input, { ...opts, columns: 120, compactLevel: 2 }));
  assert.doesNotMatch(two, /member-|3\.0\.0/, 'team and an idle version are gone');
  assert.match(two, /Opus/, 'the model stays at level 2');

  const three = strip(formatNoSession(input, { ...opts, columns: 120, compactLevel: 3 }));
  assert.match(three, /🚨/);
  assert.match(three, /no session data/);
  assert.doesNotMatch(three, /Opus|member-|3\.0\.0/);
  assert.equal(three.split('\n').length, 1);
});

after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('compact=N is stored and verbose / compact clear it again', () => {
  assert.ok(config.configPath().startsWith(tmp), 'the test must not touch the real config');
  assert.equal(config.statuslineDefaults().compactLevel, 0, 'the default is verbose');
  assert.equal(config.statuslineDefaults().verbose, true);

  const r = config.applyMode(['compact=2']);
  assert.deepEqual(r.applied, ['compact=2']);
  let eff = config.statuslineDefaults();
  assert.equal(eff.compactLevel, 2);
  assert.equal(eff.verbose, false);

  config.applyMode(['compact=3']);
  assert.equal(config.statuslineDefaults().compactLevel, 3);

  config.applyMode(['verbose']);
  eff = config.statuslineDefaults();
  assert.equal(eff.compactLevel, 0);
  assert.equal(eff.verbose, true);

  config.applyMode(['compact=2']);
  config.applyMode(['compact']);
  eff = config.statuslineDefaults();
  assert.equal(eff.compactLevel, 1);
  assert.equal(eff.verbose, false);

  config.applyMode(['compact=3']);
  config.applyMode(['compact=1']);
  assert.equal(config.statuslineDefaults().compactLevel, 1);
  config.applyMode(['compact=0']);
  eff = config.statuslineDefaults();
  assert.equal(eff.compactLevel, 0);
  assert.equal(eff.verbose, true);

  assert.deepEqual(config.applyMode(['compact=4']).unknown, ['compact=4']);
  assert.ok(config.VALID_KEYWORDS.some((k) => k.startsWith('compact=0..3')));
});
