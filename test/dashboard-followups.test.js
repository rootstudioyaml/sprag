/**
 * Dashboard follow-ups to the since-install rates (handoff/dashboard-followups-2026-11-11.md): the pre-install previous period, the
 * since-install part of spend, delegating machines, work share, the shared sumUsage and the ops trend and decline rules.
 * admin-ux.js is a plain script, so the blocks under test are cut out of its source and run in isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { workShareOf } = await import('../site/assets/scene/office-scene.js');
const { townSceneData, savedTrend, isDeclining } = await import('../site/assets/scene/town-scene.js');

const ux = readFileSync(new URL('../site/assets/admin-ux.js', import.meta.url), 'utf8');
const opsHtml = readFileSync(new URL('../site/ops/index.html', import.meta.url), 'utf8');
function cut(src, startMark, endMark) {
  const a = src.indexOf(startMark), b = src.indexOf(endMark, a);
  assert.ok(a >= 0 && b > a, `${startMark} block not found`);
  return src.slice(a, b);
}
const H = new Function('esc', 'u', `${cut(ux, '/* sinceUsage */', '/* end of savings model */')}
${cut(ux, 'function chipOf(it){', 'function countUp')}
return { sinceUsage, sumUsage, prePrev, rateOf, workShare, usageKpis, savingsModel, chipOf };`)((v) => String(v), (k) => k);
const { sumUsage, prePrev, workShare, usageKpis, savingsModel, chipOf } = H;

const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
/** installed on the 3rd: spend on all four days, savings only from then on; the gateway figure is part of each day's total */
function machine(extra = {}) {
  return {
    since: '2026-11-03', spent: 40, saved: 4, total_spent: 60, gateway_spent: 20, gateway_user_hash: 'h1', delegated_cost: 3, delegated: 2,
    series: days.map((d, i) => ({ day: d, spent: 10, total: 15, gateway: 5, saved: i >= 2 ? 2 : 0, delegated_cost: i >= 2 ? 1.5 : null })),
    ...extra,
  };
}

test('prePrev: the previous period is mostly before install under half of its spend', () => {
  assert.equal(prePrev({ tot: 100, rtot: 20 }), true);
  assert.equal(prePrev({ tot: 100, rtot: 49.9 }), true);
  assert.equal(prePrev({ tot: 100, rtot: 50 }), false);
  assert.equal(prePrev({ tot: 0, rtot: 0 }), false, 'no spend is the normal case');
  assert.equal(prePrev({ tot: 100 }), false, 'a result without since fields is the normal case');
  assert.equal(prePrev(null), false);
});

test('chipOf with prevPre is a neutral chip with the pre-install text and no percentage or direction', () => {
  const c = chipOf({ cur: 10, prev: 5, prevPre: true, judge: 'good' });
  assert.equal(c.text, 'prepre');
  assert.equal(c.cls, 'none');
  assert.equal(c.dir, undefined);
  assert.equal(chipOf({ cur: 10, prev: 5, judge: 'good' }).text, '100%');
});

test('usageKpis marks every compared card prevPre when the previous period is mostly pre-install', () => {
  const cur = sumUsage([{ members: [machine()] }]);
  const mk = (prev) => usageKpis(cur, prev, { t: (k) => k, money: (v) => '$' + v, prevLabel: 'p' });
  const pre = mk({ ...cur, tot: 100, rtot: 10 });
  for (const id of ['sp', 'sv', 'sr', 'dl', 'dm', 'dr', 'dc']) assert.equal(pre[id].prevPre, true, id);
  const normal = mk({ ...cur });
  for (const id of ['sp', 'sv', 'sr', 'dl', 'dm', 'dr', 'dc']) assert.equal(normal[id].prevPre, undefined, id);
  assert.equal(mk(null).sp.prevPre, undefined);
});

test('savingsModel nulls the delta of a team whose previous period is mostly pre-install, and of the organization', () => {
  const cur = (sv) => ({ sv, dl: 1, tot: 100, rtot: 100, byDay: {} });
  const m = savingsModel({ days, teams: [
    { id: 'a', name: 'A', members: 1, cur: cur(10), prev: { sv: 2, tot: 100, rtot: 10 } },
    { id: 'b', name: 'B', members: 1, cur: cur(10), prev: { sv: 5, tot: 100, rtot: 90 } },
  ] });
  const a = m.teams.find((r) => r.id === 'a'), b = m.teams.find((r) => r.id === 'b');
  assert.equal(a.delta, null);
  assert.equal(a.deltaPct, null);
  assert.equal(a.prevSv, null);
  assert.equal(b.delta, 5);
  assert.equal(b.deltaPct, 1);
  assert.notEqual(m.org.prevSv, null, 'the organization previous period is half pre-install here (100 of 200), not under half');
  const all = savingsModel({ days, teams: [{ id: 'a', name: 'A', members: 1, cur: cur(10), prev: { sv: 2, tot: 100, rtot: 10 } }, { id: 'b', name: 'B', members: 1, cur: cur(10), prev: { sv: 2, tot: 100, rtot: 20 } }] });
  assert.equal(all.org.prevSv, null);
  assert.equal(all.org.deltaPct, null);
  const old = savingsModel({ days, teams: [{ id: 'a', name: 'A', members: 1, cur: cur(10), prev: { sv: 2, tot: 100 } }] });
  assert.equal(old.teams[0].delta, 8, 'an old server (no rtot) keeps the delta');
});

test('sumUsage carries rByDay (since-install per-day spend) beside byDay', () => {
  const s = sumUsage([{ members: [machine()] }]);
  assert.equal(s.tot, 60);
  assert.equal(s.rtot, 30);
  assert.deepEqual(s.rByDay, { '2026-11-03': 15, '2026-11-04': 15 });
  for (const d of days) {
    const pre = Math.max(0, s.byDay[d].tot - (s.rByDay[d] || 0));
    assert.equal(pre, d < '2026-11-03' ? 15 : 0, `pre-install part of ${d}`);
  }
  const noSince = sumUsage([{ members: [machine({ since: undefined })] }]);
  assert.equal(noSince.rtot, noSince.tot, 'an old server: the since basis is the whole range');
  assert.deepEqual(noSince.rByDay, Object.fromEntries(days.map((d) => [d, 15])));
});

test('usageKpis puts the since-install part under spend only when rtot is below tot', () => {
  const t = (k, v) => k + (v ? JSON.stringify(v) : '');
  const money = (v) => '$' + v;
  const split = usageKpis(sumUsage([{ members: [machine()] }]), null, { t, money });
  assert.match(split.sp.sub, /ux\.sp\.since/);
  assert.match(split.sv.sub, /ux\.sv\.without\{"v":"\$34"\}/, 'without sprag = spend since install + saved');
  const whole = usageKpis(sumUsage([{ members: [machine({ since: undefined })] }]), null, { t, money });
  assert.doesNotMatch(whole.sp.sub, /ux\.sp\.since/);
});

test('mach counts machines with spend or delegation, dmach those that delegated (Claude or Codex)', () => {
  const s = sumUsage([{ members: [
    { spent: 5, delegated: 0 },
    { spent: 0, delegated: 2 },
    { spent: 0, delegated: 0 },
    { spent: 5, delegated: 0, codex_delegated: 1 },
    { total_spent: 3, spent: 0 },
  ] }]);
  assert.equal(s.mach, 4);
  assert.equal(s.dmach, 2);
  const kp = usageKpis(s, null, { t: (k, v) => (v ? k + JSON.stringify(v) : k), money: (v) => v });
  assert.equal(kp.dm.value, 2);
  assert.equal(kp.dm.fmt(2), 'ux.dm.of{"n":2,"of":4}', 'the denominator is the active PCs, named by the ux.dm.of key');
  assert.equal(kp.dm.sub, 'ux.dm.sub', 'a sub line says it is not the seat count');
});

test('workShare: (rdc + sv) / (rtot + sv) with since fields, dc / tot without, null when unknown', () => {
  assert.equal(workShare({ rtot: 100, rdc: 10, sv: 20, tot: 300, dc: 50 }), 30 / 120);
  assert.equal(workShare({ tot: 200, dc: 40, sv: 20 }), 0.2, 'an old server: delegation cost over spend');
  assert.equal(workShare({ rtot: 100, rdc: null, sv: 20, tot: 300, dc: 50 }), null);
  assert.equal(workShare({ tot: 200, dc: null, sv: 0 }), null);
  assert.equal(workShare({ rtot: 0, rdc: 0, sv: 0, tot: 0, dc: 0 }), null);
  assert.equal(workShare({ tot: 0, dc: 0, sv: 0 }), null);
  assert.equal(workShare(null), null);
  /* the office-scene helper (HUD, town) follows the same rule */
  assert.equal(workShareOf(10, 20, 100, true), 30 / 120);
  assert.equal(workShareOf(40, 20, 200, false), 0.2);
  assert.equal(workShareOf(NaN, 20, 200, true), null);
  assert.equal(workShareOf(0, 0, 0, true), null);
});

test('range tot is the sum of per-day totals: one gateway hash reporting on different days from two machines', () => {
  const a = { spent: 3, total_spent: 8, gateway_spent: 5, gateway_user_hash: 'h', series: [{ day: days[0], spent: 3, total: 8, gateway: 5 }] };
  const b = { spent: 2, total_spent: 9, gateway_spent: 7, gateway_user_hash: 'h', series: [{ day: days[1], spent: 2, total: 9, gateway: 7 }] };
  const s = sumUsage([{ members: [a, b] }]);
  const byDaySum = Object.values(s.byDay).reduce((x, y) => x + y.tot, 0);
  assert.equal(s.tot, 17, 'the old range figure (gateway counted once per hash) gave 12');
  assert.equal(s.tot, byDaySum);
  /* the same hash on the same day from both machines still counts once */
  const c = { spent: 1, total_spent: 6, gateway_spent: 5, gateway_user_hash: 'h', series: [{ day: days[0], spent: 1, total: 6, gateway: 5 }] };
  const same = sumUsage([{ members: [a, c] }]);
  assert.equal(same.tot, 8 - 5 + 6 - 5 + 5);
  /* a machine without a series keeps the range fallback */
  const flat = sumUsage([{ members: [a, { spent: 10, total_spent: 10 }] }]);
  assert.equal(flat.tot, 18);
});

const stubT = (k) => k;
const org = (extra) => ({ id: 'o1', name: 'Northwind', plan: 'pro', status: 'active', seats_used: 3, seat_limit: 5, saved: 20, total_spent: 1000, spent: 1000, delegated_cost: 50, ...extra });
const town = (orgs) => townSceneData({ orgs, attention: {}, t: stubT, money: (n) => '$' + n, revenue: () => 0, rangeLabel: 'r', rel: String });

test('savedTrend: arrow only when last week saved at least $20 and the move is at least 10%', () => {
  assert.equal(savedTrend({ saved_7d: 100, saved_prev_7d: 19.99 }), null);
  assert.equal(savedTrend({ saved_7d: 100 }), null, 'an old server sends no weekly figures');
  assert.equal(savedTrend(org()), null);
  assert.equal(savedTrend({ saved_7d: 130, saved_prev_7d: 100 }).arrow, '▲30%');
  assert.equal(savedTrend({ saved_7d: 70, saved_prev_7d: 100 }).arrow, '▼30%');
  assert.equal(savedTrend({ saved_7d: 110, saved_prev_7d: 100 }).arrow, '▲10%');
  assert.equal(savedTrend({ saved_7d: 105, saved_prev_7d: 100 }).arrow, '');
  assert.equal(savedTrend({ saved_7d: 0, saved_prev_7d: 20 }).arrow, '▼100%');
});

test('the town signboard saved line carries the arrow, and the detail rows carry delegating machines when sent', () => {
  const c = town([org({ saved_7d: 70, saved_prev_7d: 100, machines_active: 10, machines_delegating: 4 })]).companies[0];
  assert.ok(c.sign.saved.endsWith(' ▼30%'), c.sign.saved);
  assert.deepEqual(c.detail.rows.find((r) => r[0] === 'ux.dm'), ['ux.dm', '4 / 10']);
  const plain = town([org()]).companies[0];
  assert.equal(plain.sign.saved, 'tn.saved');
  assert.equal(plain.detail.rows.some((r) => r[0] === 'ux.dm'), false);
  assert.equal(plain.detail.rows.some((r) => r[0] === 'of.ws'), true, 'the company row is labelled as the work share');
  assert.equal(plain.dlg, 50 / 1000, 'no *_since fields: delegation cost over spend');
});

test('isDeclining: last week at least $20 and this week under 80% of it; the ops page uses the same rule', () => {
  const declining = new Function(`${cut(opsHtml, '/* declining */', '/* end of declining */')}\nreturn declining;`)();
  const cases = [
    [{ saved_7d: 79, saved_prev_7d: 100 }, true],
    [{ saved_7d: 80, saved_prev_7d: 100 }, false],
    [{ saved_7d: 0, saved_prev_7d: 20 }, true],
    [{ saved_7d: 0, saved_prev_7d: 19 }, false],
    [{ saved_7d: 50 }, false],
    [{}, false],
    [{ saved_7d: 10, saved_prev_7d: 100, status: 'suspended' }, false],
  ];
  for (const [o, want] of cases) {
    assert.equal(declining(o), want, JSON.stringify(o));
    if (o.status !== 'suspended') assert.equal(isDeclining(o), want, JSON.stringify(o));
  }
});
