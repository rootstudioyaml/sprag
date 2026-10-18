/**
 * team-sync — daily aggregation, sync gating, join/leave state, rpc errors.
 * XDG_CONFIG_HOME points at a temp dir so no test touches the real data dir;
 * fetch is injected, so nothing here reaches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateDaily, syncTeam, autoJoin, joinTeam, leaveTeam, rpc, loadTeamState, saveTeamState,
  teamStatePath, teamRulesCachePath, autoJoinNotice, TEAM_SYNC_INTERVAL_MS,
} from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';

const TOKEN = 'spt_' + 'a'.repeat(32);

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-team-'));
  const saved = { xdg: process.env.XDG_CONFIG_HOME, off: process.env.SPRAG_NO_TEAM_SYNC, tok: process.env.SPRAG_TEAM_TOKEN };
  process.env.XDG_CONFIG_HOME = root;
  delete process.env.SPRAG_NO_TEAM_SYNC;
  delete process.env.SPRAG_TEAM_TOKEN;
  t.after(() => {
    for (const [k, v] of [['XDG_CONFIG_HOME', saved.xdg], ['SPRAG_NO_TEAM_SYNC', saved.off], ['SPRAG_TEAM_TOKEN', saved.tok]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeFetch(handlers = {}) {
  const calls = [];
  const f = async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body, headers: init.headers });
    const h = handlers[fn];
    const r = typeof h === 'function' ? h(body) : h;
    if (r && r.status && r.status >= 400) return { ok: false, status: r.status, json: async () => r.json };
    return { ok: true, status: 200, json: async () => (r === undefined ? true : r) };
  };
  f.calls = calls;
  return f;
}

const JOINED = {
  member_key: 'spk_secret', member_id: 'm1', team_id: 't1', team_name: 'Acme', plan: 'free', prompt_capture: false,
};
const joinedState = (extra = {}) => ({
  version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'me', lastSyncAt: null, ...extra,
});

test('aggregateDaily buckets by local day, sums savings, counts runs, shares families, adds session spend', async (t) => {
  const dir = isolate(t);
  const d1 = new Date(2026, 9, 10, 9, 0).getTime();
  const d1b = new Date(2026, 9, 10, 23, 30).getTime();
  const d2 = new Date(2026, 9, 12, 1, 0).getTime();
  const old = new Date(2026, 7, 1, 12).getTime();
  const now = new Date(2026, 9, 15, 12).getTime();
  writeFileSync(join(dir, 'delegation-ledger.json'), JSON.stringify({
    version: 2,
    events: {
      'a/subagents/1': { ts: d1, usd: 1.5, to: 'claude-haiku-4-5' },
      'b/subagents/2': { ts: d1b, usd: 0.5, to: 'claude-haiku-4-5' },
      'c/subagents/3': { ts: d1b, usd: 1, to: 'claude-sonnet-5' },
      'd/subagents/4': { ts: d1b, usd: 1, to: 'claude-haiku-4-5' },
      'e/subagents/5': { ts: d2, usd: 2, to: 'claude-opus-4' },
      'f/subagents/6': { ts: old, usd: 99, to: 'claude-opus-4' },
    },
  }));
  writeFileSync(join(dir, 'doc2md-ledger.json'), JSON.stringify({
    version: 1, events: { '/x.pdf': { ts: d1, usd: 0.25, ext: 'pdf' } },
  }));
  const session = (start, input) => ({
    startTime: new Date(start), endTime: new Date(start), model: 'claude-sonnet-4-5',
    totals: { input, output: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0 },
  });
  const rows = await aggregateDaily({
    now, dir, days: 30, sessions: [session(d2, 1_000_000), session(old, 1_000_000)],
  });
  assert.deepEqual(rows.map((r) => r.day), ['2026-10-10', '2026-10-12']);
  const [a, b] = rows;
  assert.equal(a.saved_usd, 4.25);
  assert.equal(a.delegated_runs, 4);
  assert.deepEqual(a.family_share, { haiku: 0.75, sonnet: 0.25 });
  assert.equal(a.delegated_errors, null);
  assert.equal(a.spent_usd, 0);
  assert.equal(b.delegated_runs, 1);
  assert.deepEqual(b.family_share, { opus: 1 });
  assert.ok(b.spent_usd > 0, 'session spend lands on its start day');
});

test('syncTeam skips without any fetch for disabled, not-joined, left, not-due; force bypasses not-due', async (t) => {
  const dir = isolate(t);
  const f = fakeFetch({ ledger_upsert: 0, team_rules_get: { rules: [], removed: [] } });
  const now = Date.now();
  assert.deepEqual(await syncTeam({ dir, fetch: f, now, env: { SPRAG_NO_TEAM_SYNC: '1' } }), { skipped: 'disabled' });
  assert.deepEqual(await syncTeam({ dir, fetch: f, now, env: {} }), { skipped: 'not-joined' });
  saveTeamState({ version: 1, left: true }, dir);
  assert.deepEqual(await syncTeam({ dir, fetch: f, now, env: {} }), { skipped: 'left' });
  saveTeamState(joinedState({ lastSyncAt: now - 1000 }), dir);
  assert.deepEqual(await syncTeam({ dir, fetch: f, now, env: {}, sessions: [] }), { skipped: 'not-due' });
  assert.equal(f.calls.length, 0);
  const r = await syncTeam({ dir, fetch: f, now, env: {}, force: true, sessions: [] });
  assert.equal(r.uploaded, 0);
  assert.equal(f.calls.length, 2);
});

test('syncTeam reports a pause once without usage data, then the resume before the next upload', async (t) => {
  const dir = isolate(t);
  const f = fakeFetch({ member_set_sync: { sync_state: 'x' }, ledger_upsert: 0, team_rules_get: { rules: [], removed: [] } });
  const now = Date.now();
  saveTeamState(joinedState({ lastSyncAt: now - 1000 }), dir);
  const off = { SPRAG_NO_TEAM_SYNC: '1' };
  assert.deepEqual(await syncTeam({ dir, fetch: f, now, env: off }), { skipped: 'disabled', reported: 'paused' });
  assert.deepEqual(f.calls.map((c) => [c.fn, c.body.paused]), [['member_set_sync', true]]);
  assert.equal(await syncTeam({ dir, fetch: f, now, env: off }).then((r) => r.skipped), 'disabled');
  assert.equal(f.calls.length, 1, 'a reported pause is not sent again');
  const r = await syncTeam({ dir, fetch: f, now, env: {}, sessions: [] });
  assert.deepEqual(f.calls.slice(1).map((c) => c.fn), ['member_set_sync', 'ledger_upsert', 'team_rules_get']);
  assert.equal(f.calls[1].body.paused, false);
  assert.equal(r.uploaded, 0, 'the resume forces an upload even before the interval');
  assert.equal(loadTeamState(dir).pausedReported, undefined);
});

test('syncTeam keeps retrying the pause report when the server refuses it', async (t) => {
  const dir = isolate(t);
  const f = fakeFetch({ member_set_sync: { status: 404, json: { message: 'no such function' } } });
  saveTeamState(joinedState(), dir);
  const r = await syncTeam({ dir, fetch: f, env: { SPRAG_NO_TEAM_SYNC: '1' } });
  assert.equal(r.skipped, 'disabled');
  assert.match(r.error, /no such function/);
  assert.equal(loadTeamState(dir).pausedReported, undefined);
});

test('syncTeam happy path uploads, caches rules and updates state', async (t) => {
  const dir = isolate(t);
  const now = Date.now();
  saveTeamState(joinedState({ lastSyncAt: now - TEAM_SYNC_INTERVAL_MS - 1, lastError: 'old' }), dir);
  writeFileSync(join(dir, 'delegation-ledger.json'), JSON.stringify({
    version: 2, events: { 'a/subagents/1': { ts: now - 1000, usd: 1, to: 'claude-haiku-4-5' } },
  }));
  const f = fakeFetch({
    ledger_upsert: 1,
    team_rules_get: { team_id: 't1', team_name: 'Acme2', plan: 'pro', prompt_capture: true,
      rules: [{ id: 'r1', text: 'be nice', scope: 'ratchet', approved_at: 'x' }], removed: ['r0'] },
  });
  const r = await syncTeam({ dir, fetch: f, now, env: {}, version: '9.9.9', sessions: [] });
  assert.deepEqual(r, { uploaded: 1, rules: 1 });
  assert.deepEqual(f.calls.map((c) => c.fn), ['ledger_upsert', 'team_rules_get']);
  assert.equal(f.calls[0].body.member_key, 'spk_secret');
  assert.equal(f.calls[0].body.rows.length, 1);
  assert.equal(f.calls[0].body.sprag_version, '9.9.9');
  const cache = JSON.parse(readFileSync(teamRulesCachePath(dir), 'utf8'));
  assert.equal(cache.rules[0].text, 'be nice');
  assert.deepEqual(cache.removed, ['r0']);
  const st = loadTeamState(dir);
  assert.equal(st.lastSyncAt, now);
  assert.equal(st.lastSyncRows, 1);
  assert.equal(st.teamName, 'Acme2');
  assert.equal(st.plan, 'pro');
  assert.equal(st.lastError, undefined);
});

test('syncTeam on fetch failure returns error, backs off and never throws', async (t) => {
  const dir = isolate(t);
  const now = Date.now();
  saveTeamState(joinedState(), dir);
  const f = async () => { throw new Error('offline'); };
  const r = await syncTeam({ dir, fetch: f, now, env: {}, sessions: [] });
  assert.match(r.error, /offline/);
  const st = loadTeamState(dir);
  assert.equal(st.lastSyncAt, now);
  assert.match(st.lastError, /offline/);
});

test('autoJoin joins once from the env token and never after leaving', async (t) => {
  const dir = isolate(t);
  const f = fakeFetch({ team_join: JOINED });
  const env = { SPRAG_TEAM_TOKEN: TOKEN };
  const st = await autoJoin({ env, fetch: f, dir, version: '1.0.0' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.auto_joined, true);
  assert.equal(st.memberKey, 'spk_secret');
  assert.equal(st.autoJoinNoticePending, true);
  assert.equal(await autoJoin({ env, fetch: f, dir }), null);
  assert.equal(f.calls.length, 1);

  const dir2 = join(dir, 'other');
  mkdirSync(dir2);
  saveTeamState({ version: 1, left: true }, dir2);
  assert.equal(await autoJoin({ env, fetch: f, dir: dir2 }), null);
  assert.equal(f.calls.length, 1);
  assert.equal(await autoJoin({ env: { SPRAG_TEAM_TOKEN: 'bad' }, fetch: f, dir: join(dir, 'x') }), null);
});

test('autoJoinNotice clears the flag and speaks both languages', () => {
  const s = { autoJoinNoticePending: true, teamName: 'Acme' };
  assert.match(autoJoinNotice(s, 'ko'), /Acme/);
  assert.equal(s.autoJoinNoticePending, false);
  assert.equal(autoJoinNotice(s, 'ko'), null);
  assert.match(autoJoinNotice({ autoJoinNoticePending: true, teamName: 'A' }, 'en'), /daily aggregates only/);
});

test('joinTeam rejects a malformed token before any fetch', async (t) => {
  const dir = isolate(t);
  const f = fakeFetch({ team_join: JOINED });
  await assert.rejects(() => joinTeam({ token: 'nope', displayName: 'x', fetch: f, dir }), /invalid invite token/);
  assert.equal(f.calls.length, 0);
});

test('leaveTeam drops the member key, marks left and deletes the rules cache', async (t) => {
  const dir = isolate(t);
  saveTeamState(joinedState(), dir);
  writeFileSync(teamRulesCachePath(dir), '{}');
  const f = fakeFetch({ team_leave: true });
  await leaveTeam({ fetch: f, dir, now: 5 });
  assert.equal(f.calls[0].body.member_key, 'spk_secret');
  const st = loadTeamState(dir);
  assert.equal(st.memberKey, undefined);
  assert.equal(st.left, true);
  assert.equal(st.leftAt, 5);
  assert.equal(st.teamName, 'Acme');
  assert.equal(existsSync(teamRulesCachePath(dir)), false);
});

test('team.json is written with mode 0600', { skip: process.platform === 'win32' }, (t) => {
  const dir = isolate(t);
  saveTeamState(joinedState(), dir);
  assert.equal(statSync(teamStatePath(dir)).mode & 0o777, 0o600);
});

test('rpc throws with the server message on a 400', async () => {
  const f = fakeFetch({ team_join: { status: 400, json: { message: 'invalid invite', code: 'P0001' } } });
  await assert.rejects(() => rpc('team_join', {}, { fetch: f }), /team_join: invalid invite/);
});
