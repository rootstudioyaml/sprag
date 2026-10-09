/**
 * The reset mark on the savings counters, and the stale-scan caveat.
 *
 * `sprag saved reset` zeroes the routing and doc2md counters by recording a
 * timestamp, and the statusline used to drop a chip or line whose total was
 * zero. Right after a reset that made "counter was just reset" look the same as
 * "feature is off". With a mark on record a zero is now shown, dated; with none
 * it stays hidden, so a direct-API user who never delegated still sees no "$0".
 *
 * The savings come from the ledger route-scan fills, so they are only as fresh
 * as the last scan. The formatter says so once that scan is older than three
 * days and keeps quiet before then.
 *
 * Formatter cases first; the last cases drive the real CLI, because the
 * formatter reads `delegationTotals.since` and `routeScanAt` and nothing but
 * bin/cli.js can fail to supply them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatReport } from '../src/formatters/statusline.js';
import { MIN_VOTES } from '../src/model-alias.js';
import { resetSaved } from '../src/saved-reset.cjs';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

const DAY = 24 * 3600 * 1000;
const YEAR = new Date().getFullYear();
// Local noon on Oct 9 of the current year: far from any midnight, so a
// timezone offset cannot move the date the formatter prints.
const SINCE = new Date(YEAR, 9, 9, 12).getTime();

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
    delegationSaved: 0,
    ...extra,
  };
}

const routing = (total, since, pairs = []) => ({
  delegationSaved: total,
  delegationTotals: { week: 0, month: 0, total, pairs, since },
});

const opts = { color: false, timer: false };
const lines = (out) => out.split('\n');

test('a reset mark dates the routing headline', () => {
  const out = formatReport(data(routing(3.2, SINCE)), opts);
  assert.match(lines(out)[0], /^Routing saved \$3\.20 since 10\/9$/);
  const icon = formatReport(data(routing(3.2, SINCE)), { ...opts, mode: 'icon' });
  assert.match(lines(icon)[0], /^🔀 Routing saved \$3\.20 since 10\/9$/);
});

test('a zero total is shown, dated, once the counter has been reset', () => {
  const out = formatReport(data(routing(0, SINCE)), opts);
  assert.equal(lines(out).length, 2, 'the headline line is back');
  assert.match(lines(out)[0], /^Routing saved \$0\.00 since 10\/9$/);
  assert.match(lines(out)[1], /Cache hit/, 'diagnostics still close the output');
});

test('a zero total with no mark stays hidden', () => {
  for (const since of [null, undefined]) {
    const out = formatReport(data(routing(0, since)), opts);
    assert.ok(!out.includes('\n'), `since ${String(since)} must not add a line`);
    assert.doesNotMatch(out, /Routing saved/);
  }
  // And a ledger that could not be read at all is not a reset.
  assert.doesNotMatch(formatReport(data({ delegationTotals: null }), opts), /Routing saved/);
});

test('an unusable mark counts as no mark', () => {
  for (const since of [0, -5, NaN, '', 'soon', {}]) {
    const out = formatReport(data(routing(0, since)), opts);
    assert.doesNotMatch(out, /Routing saved/, `since ${JSON.stringify(since)} must not render`);
  }
});

test('the single-line chip is dated in the form each mode has room for', () => {
  const single = { ...opts, singleLine: true };
  assert.match(formatReport(data(routing(0, SINCE)), single), /Routing saved \$0\.00 since 10\/9/);
  assert.match(formatReport(data(routing(0, SINCE)), { ...single, mode: 'icon' }), /🔀 \$0\.00 \(10\/9~\)/);
  assert.match(formatReport(data(routing(0, SINCE)), { ...single, mode: 'narrow' }), /⇉ \$0\.00 \(10\/9~\)/);
  // Verbose icon has the room again, so it spells the sentence out.
  assert.match(
    formatReport(data(routing(0, SINCE)), { ...single, mode: 'icon', verbose: true }),
    /🔀 Routing saved \$0\.00 since 10\/9/,
  );
  // A nonzero total carries the same mark.
  assert.match(formatReport(data(routing(3.2, SINCE)), { ...single, mode: 'icon' }), /🔀 \$3\.20 \(10\/9~\)/);
});

test('the year appears only when the mark is not from this year', () => {
  const old = new Date(2020, 0, 5, 12).getTime();
  assert.match(lines(formatReport(data(routing(1, old)), opts))[0], /since 2020\/1\/5$/);
  assert.match(lines(formatReport(data(routing(1, SINCE)), opts))[0], /since 10\/9$/);
});

test('a dated zero is not painted the savings green', () => {
  const truecolor = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
  const GREEN = truecolor ? '\x1b[38;2;52;211;153m' : '\x1b[32m';
  const head = formatReport(data(routing(0, SINCE)), { timer: false }).split('\n')[0];
  assert.ok(!head.includes(GREEN), 'nothing earned yet, so nothing green');
  const earned = formatReport(data(routing(3.2, SINCE)), { timer: false }).split('\n')[0];
  assert.ok(earned.includes(GREEN), 'and a real total still is');
});

test('the dropped-runs chip survives a dated zero', () => {
  const dropped = { unresolvedRuns: MIN_VOTES };
  // Multi-line: the headline owns the zero, the unresolved count rides on line 2.
  const multi = formatReport(data({ ...routing(0, SINCE), ...dropped }), { ...opts, mode: 'icon' });
  assert.match(lines(multi)[0], /^🔀 Routing saved \$0\.00 since 10\/9$/);
  assert.match(lines(multi)[1], new RegExp(`🔀 ${MIN_VOTES} unresolved`));
  // Single-line: both chips, in that order.
  const single = formatReport(data({ ...routing(0, SINCE), ...dropped }), { ...opts, mode: 'icon', singleLine: true });
  assert.match(single, /🔀 \$0\.00 \(10\/9~\).*🔀 \d+ unresolved/);
  // With no mark the count stands alone, as it always did.
  const bare = formatReport(data({ ...routing(0, null), ...dropped }), { ...opts, singleLine: true });
  assert.match(bare, /unresolved/);
  assert.doesNotMatch(bare, /since/);
  // Real savings replace it, as they always did.
  assert.doesNotMatch(
    formatReport(data({ ...routing(3.2, SINCE), ...dropped }), { ...opts, singleLine: true }),
    /unresolved/,
  );
});

test('doc2md carries the mark too, and shows a dated zero as a chip', () => {
  const zero = { doc2mdTotals: { total: 0, docs: 0, byExt: [], since: SINCE } };
  assert.match(formatReport(data(zero), opts), /Doc2md saved \$0\.00 since 10\/9/);
  assert.match(formatReport(data(zero), { ...opts, mode: 'icon' }), /📄 \$0\.00 \(10\/9~\)/);
  // Never reset and never converted: nothing to say.
  assert.doesNotMatch(
    formatReport(data({ doc2mdTotals: { total: 0, docs: 0, byExt: [], since: null } }), opts),
    /Doc2md/,
  );
  // Conversions that saved nothing are a count, and the count is since the mark.
  const counted = { doc2mdTotals: { total: 0, docs: 3, byExt: [], since: SINCE } };
  assert.match(formatReport(data(counted), opts), /Doc2md 3 docs since 10\/9/);
  // Real money gets its headline line, dated.
  const paid = { doc2mdTotals: { total: 1.8, docs: 2, byExt: [{ ext: 'pdf', docs: 2, usd: 1.8 }], since: SINCE } };
  assert.match(formatReport(data(paid), opts), /^Doc2md saved \$1\.80 since 10\/9  \|  pdf 2× \$1\.80/);
  assert.match(formatReport(data(paid), { ...opts, singleLine: true }), /Doc2md saved \$1\.80 since 10\/9/);
});

test('the two counters are dated independently', () => {
  const out = formatReport(data({
    ...routing(0, SINCE),
    doc2mdTotals: { total: 0, docs: 0, byExt: [], since: null },
  }), opts);
  assert.match(out, /Routing saved \$0\.00 since 10\/9/);
  assert.doesNotMatch(out, /Doc2md/, 'only the routing counter was reset');
});

// ---------------------------------------------------------------------------
// Stale scan
// ---------------------------------------------------------------------------

const scanned = (ageMs) => ({ routeScanAt: Date.now() - ageMs });

test('a scan older than three days is named beside the savings', () => {
  const out = formatReport(data({ ...routing(3.2, SINCE), ...scanned(4 * DAY) }), opts);
  assert.match(lines(out)[0], /^Routing saved \$3\.20 since 10\/9 scan 4d$/);
  // Between the figure and the breakdown, not after it.
  const withPairs = formatReport(data({
    ...routing(3.2, SINCE, [{ from: 'opus', to: 'haiku', runs: 2, usd: 3.2 }]),
    ...scanned(4 * DAY),
  }), opts);
  assert.match(lines(withPairs)[0], /\$3\.20 since 10\/9 scan 4d {2}\| {2}opus→haiku 2× \$3\.20$/);
});

test('the same caveat rides on the single-line chip, and verbose spells it out', () => {
  const single = formatReport(data({ ...routing(3.2, null), ...scanned(5 * DAY) }), { ...opts, singleLine: true });
  assert.match(single, /Routing saved \$3\.20 scan 5d/);
  const verbose = formatReport(data({ ...routing(3.2, null), ...scanned(5 * DAY) }), { ...opts, singleLine: true, verbose: true });
  assert.match(verbose, /Routing saved \$3\.20 last scan 5d ago/);
});

test('a scan within three days, or none on record, adds nothing', () => {
  for (const at of [Date.now() - 2 * DAY, Date.now() - (3 * DAY - 60_000), Date.now(), null, undefined, NaN, 'never']) {
    const out = formatReport(data({ ...routing(3.2, SINCE), routeScanAt: at }), opts);
    assert.doesNotMatch(out, /scan/, `routeScanAt ${String(at)} must not add a caveat`);
  }
  // Just past the line it does.
  const past = formatReport(data({ ...routing(3.2, SINCE), ...scanned(3 * DAY + 60_000) }), opts);
  assert.match(past, /scan 3d/);
});

test('an ISO timestamp is read as well as epoch milliseconds', () => {
  const iso = new Date(Date.now() - 6 * DAY).toISOString();
  assert.match(formatReport(data({ ...routing(3.2, null), routeScanAt: iso }), opts), /scan 6d/);
});

test('no savings figure means no caveat to attach', () => {
  const out = formatReport(data({ ...routing(0, null), ...scanned(9 * DAY) }), opts);
  assert.doesNotMatch(out, /scan/);
  // Nor on the document counter, which no scan feeds.
  const doc = formatReport(data({
    doc2mdTotals: { total: 1.8, docs: 2, byExt: [{ ext: 'pdf', docs: 2, usd: 1.8 }], since: SINCE },
    ...scanned(9 * DAY),
  }), opts);
  assert.doesNotMatch(doc, /scan/);
});

test('the caveat is dim, like the rest of the qualifiers', () => {
  const truecolor = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
  const GRAY = truecolor ? '\x1b[38;2;100;116;139m' : '\x1b[90m';
  const head = formatReport(data({ ...routing(3.2, SINCE), ...scanned(4 * DAY) }), { timer: false }).split('\n')[0];
  assert.ok(head.includes(`${GRAY}scan 4d`), 'scan age is gray');
  assert.ok(head.includes(`${GRAY}since 10/9`), 'and so is the mark');
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI
// ---------------------------------------------------------------------------

const PAYLOAD = { model: { display_name: 'Opus 5' }, context_window: { context_window_size: 1000000, used_percentage: 12 } };
// Verbose is the shipped default (statuslineDefaults), so the compact wording
// these cases pin has to be asked for.
const COMPACT = { args: ['--no-verbose'] };

test('the CLI passes the reset mark and scan age to the formatter', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-marks' });
    // The mark goes in through the same API `sprag saved reset` uses.
    resetSaved(['routing', 'doc2md'], { dir: home.dataDir, now: SINCE });
    writeFileSync(
      join(home.dataDir, 'route-scan.json'),
      JSON.stringify({ scannedAt: new Date(Date.now() - 5 * DAY).toISOString(), candidates: [], resolved: [] }),
    );
    const out = renderStatusline(home, PAYLOAD, COMPACT);
    assert.match(out.split('\n')[0], /^🔀 Routing saved \$0\.00 since 10\/9 scan 5d$/, 'the headline carries both');
    assert.match(out, /📄 \$0\.00 \(10\/9~\)/, 'and so does the document counter');
    // The same data, spelled out.
    const verbose = renderStatusline(home, PAYLOAD, { args: ['--verbose'] });
    assert.match(verbose.split('\n')[0], /^🔀 Routing saved \$0\.00 since 10\/9 last scan 5d ago$/);
    assert.match(verbose, /📄 Doc2md saved \$0\.00 since 10\/9/);
  } finally {
    home.cleanup();
  }
});

test('the CLI shows no counter at all when nothing was ever reset or earned', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-fresh' });
    const out = renderStatusline(home, PAYLOAD, COMPACT);
    assert.doesNotMatch(out, /Routing saved|since|📄/);
    assert.doesNotMatch(out, /scan \d/, 'and a missing scan cache is not a stale one');
  } finally {
    home.cleanup();
  }
});

test('the CLI keeps a recent scan quiet', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-recent' });
    resetSaved(['routing'], { dir: home.dataDir, now: SINCE });
    writeFileSync(
      join(home.dataDir, 'route-scan.json'),
      JSON.stringify({ scannedAt: new Date(Date.now() - 1 * DAY).toISOString(), candidates: [], resolved: [] }),
    );
    const out = renderStatusline(home, PAYLOAD, COMPACT);
    assert.match(out.split('\n')[0], /^🔀 Routing saved \$0\.00 since 10\/9$/);
  } finally {
    home.cleanup();
  }
});
