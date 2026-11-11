/**
 * Rates on spend since install. A machine's row from team_member_usage carries `since` (its join date or its first
 * delegation day, whichever is earlier); sinceUsage cuts the row to the days from then on. Savings only exist after
 * install, so a rate over the whole range is diluted by spend from before it.
 *
 * sinceUsage lives twice: in site/assets/scene/office-scene.js (a module) and in site/assets/admin-ux.js (a plain
 * script). The tests pin that both give the same result, that the rate surfaces use the since basis when the server
 * sends it, and that an old server (no since, no *_since fields) renders as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sinceUsage: sinceOffice, usageTotal } = await import('../site/assets/scene/office-scene.js');
const { townSceneData, townTeamRows } = await import('../site/assets/scene/town-scene.js');

const ux = readFileSync(new URL('../site/assets/admin-ux.js', import.meta.url), 'utf8');
function extract(startMark, endMark, name) {
  const start = ux.indexOf(startMark);
  const end = ux.indexOf(endMark, start);
  assert.ok(start > 0 && end > start, `${startMark} block not found in site/assets/admin-ux.js`);
  return new Function(`${ux.slice(start, end)}\nreturn ${name};`)();
}
const sinceUx = extract('/* sinceUsage */', '/* end of sinceUsage */', 'sinceUsage');
const savingsModel = extract('/* savings model */', '/* end of savings model */', 'savingsModel');

const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
/** a machine installed on the 3rd: spend on all four days, savings and delegation only from then on */
function machine(extra = {}) {
  return {
    since: '2026-11-03', spent: 40, saved: 4, total_spent: 60, gateway_spent: 20, gateway_user_hash: 'h1', delegated_cost: 3,
    series: [
      { day: days[0], spent: 10, total: 15, gateway: 5, saved: 0, delegated_cost: null },
      { day: days[1], spent: 10, total: 15, gateway: 5, saved: 0, delegated_cost: null },
      { day: days[2], spent: 10, total: 15, gateway: 5, saved: 2, delegated_cost: 1 },
      { day: days[3] + 'T00:00:00Z', spent: 10, total: 15, gateway: 5, saved: 2, delegated_cost: 2 },
    ],
    ...extra,
  };
}

test('sinceUsage returns the same object when there is no since or no series (old server)', () => {
  for (const sinceUsage of [sinceOffice, sinceUx]) {
    const noSince = machine({ since: undefined });
    assert.equal(sinceUsage(noSince), noSince);
    const noSeries = machine({ series: undefined });
    assert.equal(sinceUsage(noSeries), noSeries);
    assert.equal(sinceUsage(null), null);
    assert.equal(sinceUsage(undefined), undefined);
    const empty = {};
    assert.equal(sinceUsage(empty), empty);
  }
});

test('sinceUsage keeps the days from since on and re-sums every figure', () => {
  for (const sinceUsage of [sinceOffice, sinceUx]) {
    const m = machine(), s = sinceUsage(m);
    assert.equal(s.series.length, 2);
    assert.equal(s.spent, 20);
    assert.equal(s.saved, 4);
    assert.equal(s.total_spent, 30);
    assert.equal(s.gateway_spent, 10);
    assert.equal(s.delegated_cost, 3);
    assert.equal(s.gateway_user_hash, 'h1', 'other fields pass through');
    assert.equal(m.series.length, 4, 'the input is not mutated');
    assert.equal(m.spent, 40);
  }
});

test('sinceUsage gives null gateway and delegated cost when no kept row carries a finite one', () => {
  for (const sinceUsage of [sinceOffice, sinceUx]) {
    const m = machine({ series: [
      { day: days[0], spent: 10, total: 15, gateway: 5, saved: 0, delegated_cost: 1 },
      { day: days[2], spent: 7, saved: 1 },
    ] });
    const s = sinceUsage(m);
    assert.equal(s.gateway_spent, null);
    assert.equal(s.delegated_cost, null);
    assert.equal(s.total_spent, 7, 'total falls back to spent');
    const none = sinceUsage(machine({ since: '2026-12-01' }));
    assert.deepEqual(none.series, []);
    assert.equal(none.spent, 0);
    assert.equal(none.total_spent, 0);
    assert.equal(none.delegated_cost, null);
  }
});

test('the office-scene and admin-ux copies of sinceUsage agree on the same fixtures', () => {
  const fixtures = [
    machine(),
    machine({ since: '2026-11-04' }),
    machine({ since: '2026-10-01' }),
    machine({ since: '2026-12-01' }),
    machine({ since: undefined }),
    machine({ gateway_user_hash: null, series: [{ day: days[2], spent: 3, saved: 1 }, { day: days[3], spent: 'x', total: null, gateway: 'n/a', delegated_cost: '2' }] }),
    { spent: 5 },
    null,
  ];
  for (const f of fixtures) assert.deepEqual(sinceUx(f), sinceOffice(f));
});

test('usageTotal over since-cut machines excludes pre-install spend', () => {
  const full = usageTotal([machine()]).total, cut = usageTotal([sinceOffice(machine())]).total;
  /* a day with a gateway figure counts that figure (once per hash) instead of the row total: 4 days x 5 against 2 days x 5 */
  assert.equal(full, 20);
  assert.equal(cut, 10);
});

test('savingsModel rate uses rtot when present and tot otherwise', () => {
  const ds = days.slice();
  const cur = (extra) => ({ sp: 0, sv: 6, dl: 1, tot: 600, dc: null, unp: 0, byDay: {}, ...extra });
  const m = savingsModel({ days: ds, teams: [
    { id: 'a', name: 'A', members: 2, cur: cur({ rtot: 200 }), prev: null },
    { id: 'b', name: 'B', members: 2, cur: cur({}), prev: null },
  ] });
  const a = m.teams.find((r) => r.id === 'a'), b = m.teams.find((r) => r.id === 'b');
  assert.equal(a.tot, 600, 'the spend column stays full');
  assert.equal(a.rtot, 200);
  assert.equal(a.rate, 6 / 200);
  assert.equal(b.rtot, 600);
  assert.equal(b.rate, 6 / 600);
  assert.equal(m.org.rtot, 800);
  assert.equal(m.org.tot, 1200);
  assert.equal(m.org.rate, 12 / 800);
});

const stubT = (k) => k;
const org = (extra) => ({ id: 'o1', name: 'Northwind', plan: 'pro', status: 'active', seats_used: 3, seat_limit: 5, saved: 20, total_spent: 1000, spent: 1000, delegated_cost: 50, ...extra });
const townOf = (orgs) => townSceneData({ orgs, attention: {}, t: stubT, money: (n) => '$' + n, revenue: () => 0, rangeLabel: 'r', rel: String });

test('town org rate and delegation use total_spent_since when present', () => {
  const t = townOf([org({ total_spent_since: 250, delegated_cost_since: 10 })]);
  const c = t.companies[0];
  assert.equal(c.rate, 20 / 250);
  assert.equal(c.dlg, 10 / 250);
  assert.equal(c.spent, 1000, 'the shown spend stays the full figure');
  assert.equal(t.rate, 20 / 250, 'the HUD rate is on the since basis');
});

test('town org rate falls back to total_spent when the server sends no *_since fields', () => {
  const t = townOf([org()]);
  const c = t.companies[0];
  assert.equal(c.rate, 20 / 1000);
  assert.equal(c.dlg, 50 / 1000);
  assert.equal(t.rate, 20 / 1000);
});

test('town team rows rate on spend since install and keep the shown spend full', () => {
  const rows = [{ member_id: 'm1', team_id: 't1', team_name: 'Apps', signal: 'ok' }];
  const teams = [{ id: 't1', name: 'Apps' }];
  const [x] = townTeamRows({ rows, usage: { m1: machine() }, teams });
  assert.equal(x.spent, 20);
  assert.equal(x.saved, 4);
  assert.equal(x.rate, 4 / 10);
  assert.equal(x.dlg, 3 / 10);
  const [old] = townTeamRows({ rows, usage: { m1: machine({ since: undefined }) }, teams });
  assert.equal(old.rate, 4 / 20);
  assert.equal(old.dlg, 3 / 20);
});
