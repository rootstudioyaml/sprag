/**
 * The savings breakdown on the team overview (/team) and the organization detail (/ops) is built from one
 * pure model in site/assets/admin-ux.js. The block between the savings model markers is evaluated here, so
 * these checks pin what the pages actually run: bucket size by range length, the stacked totals, the color
 * slot identity (input order, never rank), and the change and trend figures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ux = readFileSync(new URL('../site/assets/admin-ux.js', import.meta.url), 'utf8');
const team = readFileSync(new URL('../site/team/index.html', import.meta.url), 'utf8');
const ops = readFileSync(new URL('../site/ops/index.html', import.meta.url), 'utf8');

function model() {
  const start = ux.indexOf('/* savings model */');
  const end = ux.indexOf('/* end of savings model */', start);
  assert.ok(start > 0 && end > start, 'savings model block not found in site/assets/admin-ux.js');
  return new Function(`${ux.slice(start, end)}\nreturn savingsModel;`)();
}

const savingsModel = model();
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} vs ${b}`);

/** n consecutive days starting 2026-01-01 (UTC arithmetic, so month rollovers are real). */
function range(n, from = '2026-01-01') {
  const d0 = Date.parse(from + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => new Date(d0 + i * 864e5).toISOString().slice(0, 10));
}
/** a sumUsage-shaped object whose byDay holds fn(index) savings per day; sv is the sum like sumUsage does. */
function usage(days, fn, tot = 100) {
  const byDay = {}; let sv = 0;
  days.forEach((d, i) => { const v = fn(i); byDay[d] = { sp: 0, sv: v, tot: 0, dc: null }; sv += v; });
  return { sp: 0, sv, dl: 3, tot, dc: null, unp: 0, byDay };
}
const team1 = (id, days, fn, extra = {}) => ({ id, name: 'Team ' + id, members: 4, cur: usage(days, fn), prev: null, ...extra });

test('bucket size follows the range length: day up to 45, week up to 180, month beyond', () => {
  for (const [n, gran] of [[1, 'day'], [45, 'day'], [46, 'week'], [180, 'week'], [181, 'month'], [365, 'month']]) {
    const days = range(n);
    const m = savingsModel({ days, teams: [team1('a', days, () => 1)] });
    assert.equal(m.gran, gran, `${n} days`);
  }
  const days = range(100);
  const w = savingsModel({ days, teams: [team1('a', days, () => 1)] });
  assert.equal(w.buckets.length, 15);
  assert.equal(w.buckets[0].a, days[0]);
  assert.equal(w.buckets[0].z, days[6]);
  assert.equal(w.buckets[14].z, days[99], 'the last week is a short chunk');
  const mo = range(200, '2026-01-15');
  const m = savingsModel({ days: mo, teams: [team1('a', mo, () => 1)] });
  assert.equal(m.buckets[0].a, '2026-01-15');
  assert.equal(m.buckets[0].z, '2026-01-31');
  assert.equal(m.buckets[1].a, '2026-02-01');
  assert.equal(m.buckets[1].z, '2026-02-28');
});

test('bucket sums equal the team totals and cum only rises', () => {
  const days = range(60);
  const teams = [team1('a', days, i => 1 + i % 3), team1('b', days, i => i % 5), team1('c', days, () => 0)];
  const m = savingsModel({ days, teams });
  assert.equal(m.gran, 'week');
  for (const r of m.teams) close(m.buckets.reduce((s, b) => s + b.byTeam[r.id], 0), r.sv, 'team ' + r.id);
  close(m.buckets.reduce((s, b) => s + b.total, 0), m.org.sv);
  close(m.buckets[m.buckets.length - 1].cum, m.org.sv);
  m.buckets.forEach((b, i) => {
    if (i) assert.ok(b.cum >= m.buckets[i - 1].cum, 'cum is monotonic');
    close(b.total, Object.values(b.byTeam).reduce((s, v) => s + v, 0));
  });
  m.teams.forEach(r => assert.equal(r.series.length, m.buckets.length));
});

test('a day missing from byDay counts as zero', () => {
  const days = range(5);
  const t = { id: 'a', name: 'A', members: 1, cur: { sv: 4, tot: 10, dl: 0, byDay: { [days[1]]: { sv: 4 } } }, prev: null };
  const m = savingsModel({ days, teams: [t] });
  assert.deepEqual(m.buckets.map(b => b.total), [0, 4, 0, 0, 0]);
});

test('share adds up to one, rate and per-member come from the team figures', () => {
  const days = range(10);
  const teams = [team1('a', days, () => 3), team1('b', days, () => 1), team1('c', days, () => 0)];
  teams[1].members = null;
  const m = savingsModel({ days, teams });
  close(m.teams.reduce((s, r) => s + r.share, 0), 1);
  close(m.teams[0].share, .75);
  close(m.teams[0].rate, 30 / 100);
  close(m.teams[0].perMember, 30 / 4);
  assert.equal(m.teams[1].perMember, null);
  assert.equal(m.teams[2].share, 0);
  const none = savingsModel({ days, teams: [team1('a', days, () => 0)] });
  assert.equal(none.teams[0].share, 0);
  assert.equal(none.org.best, null);
  assert.equal(none.org.peak, null);
  const free = savingsModel({ days, teams: [{ ...team1('a', days, () => 1), cur: { ...usage(days, () => 1), tot: 0 } }] });
  assert.equal(free.teams[0].rate, null);
});

test('deltaPct is null without a previous period and new when the previous was zero', () => {
  const days = range(10);
  const bare = savingsModel({ days, teams: [team1('a', days, () => 1)] });
  assert.equal(bare.teams[0].prevSv, null);
  assert.equal(bare.teams[0].delta, null);
  assert.equal(bare.teams[0].deltaPct, null);
  assert.equal(bare.org.prevSv, null);
  assert.equal(bare.org.deltaPct, null);

  const teams = [
    { ...team1('a', days, () => 2), prev: usage(days, () => 1) },
    { ...team1('b', days, () => 1), prev: usage(days, () => 0) },
    { ...team1('c', days, () => 0), prev: usage(days, () => 0) },
    { ...team1('d', days, () => 1), prev: usage(days, () => 2) }
  ];
  const m = savingsModel({ days, teams });
  const by = id => m.teams.find(r => r.id === id);
  close(by('a').delta, 10); close(by('a').deltaPct, 1);
  assert.equal(by('b').deltaPct, 'new');
  assert.equal(by('c').deltaPct, 0);
  close(by('d').deltaPct, -.5);
  close(m.org.prevSv, 10 + 0 + 0 + 20);
  close(m.org.deltaPct, (40 - 30) / 30);

  const half = savingsModel({ days, teams: [teams[0], team1('x', days, () => 1)] });
  assert.equal(half.org.prevSv, null, 'one team without a previous period makes the organization figure unknown');
  assert.equal(half.org.deltaPct, null);
});

test('trendPct compares the daily averages of the two halves and drops the middle day of an odd range', () => {
  const days = range(7);
  // first half = days 0..2, middle day 3 (ignored), second half = days 4..6
  const vals = [1, 1, 1, 100, 2, 2, 2];
  const m = savingsModel({ days, teams: [team1('a', days, i => vals[i])] });
  close(m.org.firstAvg, 1);
  close(m.org.secondAvg, 2);
  close(m.org.trendPct, 1);
  close(m.org.dailyAvg, 109 / 7);

  const even = range(4);
  const e = savingsModel({ days: even, teams: [team1('a', even, i => [4, 4, 2, 2][i])] });
  close(e.org.trendPct, -.5);

  const short = range(3);
  assert.equal(savingsModel({ days: short, teams: [team1('a', short, () => 1)] }).org.trendPct, null);
  const zero = range(6);
  assert.equal(savingsModel({ days: zero, teams: [team1('a', zero, i => (i < 3 ? 0 : 5))] }).org.trendPct, null, 'first half is zero');
});

test('rank follows savings while the color slot keeps the input order', () => {
  const days = range(8);
  const teams = [team1('a', days, () => 1), team1('b', days, () => 5), team1('c', days, () => 5), team1('d', days, () => 3)];
  const m = savingsModel({ days, teams });
  assert.deepEqual(m.ranked.map(r => r.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(m.teams.map(r => r.id), ['a', 'b', 'c', 'd'], 'teams stay in input order');
  assert.deepEqual(m.teams.map(r => r.rank), [4, 1, 2, 3], 'ties go by input order');
  assert.deepEqual(m.teams.map(r => r.slot), [0, 1, 2, 3]);
  assert.equal(m.org.best.id, 'b');
  assert.equal(m.ranked[0].slot, 1, 'the top saver keeps the slot of its input position');
});

test('more than eight teams fold from index 7 into other, exactly eight keep slot 7', () => {
  const days = range(6);
  const mk = n => Array.from({ length: n }, (_, i) => team1('t' + i, days, () => n - i));
  const nine = savingsModel({ days, teams: mk(9) });
  assert.deepEqual(nine.teams.map(r => r.slot), [0, 1, 2, 3, 4, 5, 6, 'other', 'other']);
  const eight = savingsModel({ days, teams: mk(8) });
  assert.deepEqual(eight.teams.map(r => r.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  const two = savingsModel({ days, teams: mk(2) });
  assert.deepEqual(two.teams.map(r => r.slot), [0, 1]);
});

test('peak is the busiest bucket and org.best the biggest saver', () => {
  const days = range(6);
  const m = savingsModel({ days, teams: [team1('a', days, i => (i === 4 ? 9 : 1)), team1('b', days, () => 2)] });
  assert.equal(m.org.peak.a, days[4]);
  close(m.org.peak.total, 11);
  assert.equal(m.org.best.id, 'a', 'a saves 14 in total against 12 for b');
});

test('both pages mount the shared component in its container', () => {
  assert.ok(team.includes('AdminUX.savings('), 'team page calls AdminUX.savings');
  assert.ok(ops.includes('AdminUX.savings('), 'ops page calls AdminUX.savings');
  assert.ok(team.includes('id="sv-box"'), 'team page has #sv-box');
  assert.ok(ops.includes('id="d-sv"'), 'ops page has #d-sv');
  assert.match(ux, /window\.AdminUX = \{[^}]*\bsavings\b[^}]*\bsavingsModel\b/, 'AdminUX exports savings and savingsModel');
});

test('recent7Avg, prior7Avg and recentPct compare the last 7 days with the 7 before', () => {
  const days = range(14);
  const m = savingsModel({ days, teams: [team1('a', days, i => (i < 7 ? 2 : 3))] });
  close(m.org.recent7Avg, 3);
  close(m.org.prior7Avg, 2);
  close(m.org.recentPct, .5);
  const down = savingsModel({ days, teams: [team1('a', days, i => (i < 7 ? 4 : 1))] });
  close(down.org.recentPct, -.75);
  const short = range(10);
  const s = savingsModel({ days: short, teams: [team1('a', short, () => 2)] });
  close(s.org.recent7Avg, 2);
  assert.equal(s.org.prior7Avg, null, 'fewer than 14 days');
  assert.equal(s.org.recentPct, null);
  const zero = savingsModel({ days, teams: [team1('a', days, i => (i < 7 ? 0 : 3))] });
  assert.equal(zero.org.prior7Avg, 0);
  assert.equal(zero.org.recentPct, null, 'a zero prior makes the change unknown');
});

test('per-team recentPct uses that team daily values', () => {
  const days = range(14);
  const m = savingsModel({ days, teams: [team1('a', days, i => (i < 7 ? 1 : 2)), team1('b', days, i => (i < 7 ? 4 : 2)), team1('c', days, () => 0)] });
  const by = id => m.teams.find(r => r.id === id);
  close(by('a').recentPct, 1);
  close(by('b').recentPct, -.5);
  assert.equal(by('c').recentPct, null);
  const short = range(9);
  assert.equal(savingsModel({ days: short, teams: [team1('a', short, () => 1)] }).teams[0].recentPct, null);
});

test('projection runs a current-month range on to the month end from the recent daily average', () => {
  const days = range(10, '2026-11-01');
  const teams = [team1('a', days, i => (i < 3 ? 1 : 2)), team1('b', days, () => 1)];
  const m = savingsModel({ days, teams, today: '2026-11-10' });
  const p = m.org.projection;
  assert.ok(p, 'projection exists');
  assert.equal(p.to, '2026-11-30');
  assert.equal(p.days, 20);
  const cum = m.buckets[m.buckets.length - 1].cum;
  // last 7 days (index 3..9): a saves 2, b saves 1 -> 3 a day
  close(m.org.recent7Avg, 3);
  close(p.total, cum + 3 * 20);

  assert.equal(savingsModel({ days, teams, today: '2026-11-12' }).org.projection, null, 'range does not end today');
  const mid = range(10, '2026-11-02');
  assert.equal(savingsModel({ days: mid, teams: [team1('a', mid, () => 1)], today: '2026-11-11' }).org.projection, null, 'range does not start on the 1st');
  const cross = range(10, '2026-10-25');
  assert.equal(savingsModel({ days: cross, teams: [team1('a', cross, () => 1)], today: '2026-11-03' }).org.projection, null, 'range spans two months');
  const full = range(30, '2026-11-01');
  assert.equal(savingsModel({ days: full, teams: [team1('a', full, () => 1)], today: '2026-11-30' }).org.projection, null, 'nothing remains on the last day');
  const feb = range(5, '2026-02-01');
  assert.equal(savingsModel({ days: feb, teams: [team1('a', feb, () => 2)], today: '2026-02-05' }).org.projection.to, '2026-02-28');
});

test('moving average: 7 day buckets from index 6, 3 week buckets from index 2, null when too few buckets', () => {
  const days = range(10);
  const m = savingsModel({ days, teams: [team1('a', days, i => i + 1)] });
  for (let i = 0; i < 6; i++) assert.equal(m.buckets[i].ma, null, 'bucket ' + i);
  close(m.buckets[6].ma, 4);
  close(m.buckets[9].ma, 7);
  const six = range(6);
  assert.ok(savingsModel({ days: six, teams: [team1('a', six, () => 1)] }).buckets.every(b => b.ma === null), 'fewer than 7 days');
  const wk = range(60);
  const w = savingsModel({ days: wk, teams: [team1('a', wk, () => 1)] });
  assert.equal(w.gran, 'week');
  assert.equal(w.buckets[0].ma, null);
  assert.equal(w.buckets[1].ma, null);
  close(w.buckets[2].ma, 7);
  const two = range(50);
  const tw = savingsModel({ days: two, teams: [team1('a', two, () => 1)] });
  assert.equal(tw.buckets.length, 8);
  assert.ok(tw.buckets[2].ma != null);
});

test('peakDay is the single best day, null when nothing was saved', () => {
  const days = range(8);
  const m = savingsModel({ days, teams: [team1('a', days, i => (i === 5 ? 7 : 1)), team1('b', days, i => (i === 2 ? 5 : 0))] });
  assert.equal(m.org.peakDay.day, days[5]);
  close(m.org.peakDay.sv, 7);
  assert.equal(savingsModel({ days, teams: [team1('a', days, () => 0)] }).org.peakDay, null);
});

test('the savings panel has no mode toggle and draws two charts, an insights list and the average legend', () => {
  assert.ok(!/svMode|svx-seg/.test(ux.replace(/\/\* [^*]*\*\//g, '')), 'no toggle memory or segment buttons remain');
  assert.ok(ux.includes('svx-chart2'), 'second chart container');
  assert.ok(ux.includes('class="svx-ins"'), 'insights list');
  assert.ok(ux.includes('stroke-dasharray="4 4"'), 'dashed projection line');
});

test('the ops spend and savings cards of the org detail are clickable and jump to the savings card', () => {
  const at = (id) => { const i = ops.indexOf(`{ id:'${id}', label:t('c.${id}') + rl`); assert.ok(i > 0, id + ' card'); return ops.slice(i, ops.indexOf('\n', i)); };
  for (const id of ['sp', 'sv']) {
    const line = at(id);
    assert.ok(!line.includes('static:true'), id + ' is not static');
    assert.ok(line.includes('onClick: toSv'), id + ' has an onClick');
  }
  assert.match(ops, /const toSv = \(\) => \{[^\n]*d-sv-card/, 'toSv jumps to d-sv-card');
});
