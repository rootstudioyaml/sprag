/**
 * `sprag team name` and setDisplayName: renaming a member after it joined, and a
 * rejoin keeping the earlier name. fetch is injected and the data dir is a temp dir,
 * so nothing here reaches the network. Output wording follows the configured
 * language, so assertions pin names and calls, not prose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setDisplayName, loadTeamState, saveTeamState, TEAM_API_URL } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';
import { run } from '../src/commands/team.js';

const TOKEN = 'spt_' + 'c'.repeat(32);

function isolate(t, { syncOff = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-name-'));
  const keys = ['XDG_CONFIG_HOME', 'SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'HOME', 'USERPROFILE', 'CODEX_HOME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.XDG_CONFIG_HOME = root;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.CODEX_HOME = join(root, '.codex');
  delete process.env.SPRAG_TEAM_TOKEN;
  if (syncOff) process.env.SPRAG_NO_TEAM_SYNC = '1'; else delete process.env.SPRAG_NO_TEAM_SYNC;
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Routes by RPC name; records every call except the best-effort standing lookup. */
function mockFetch(routes = {}) {
  const calls = [];
  const f = async (url, init) => {
    const fn = url.replace(TEAM_API_URL, '').split('/rpc/')[1];
    if (fn === 'member_standing') return { ok: false, status: 404, json: async () => ({ code: 'PGRST202', message: 'Could not find the function' }) };
    const body = JSON.parse(init.body);
    calls.push({ fn, body });
    const h = routes[fn];
    const r = typeof h === 'function' ? h(body) : h || { status: 404, json: { message: 'no route' } };
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.json };
  };
  f.calls = calls;
  return f;
}

const joined = (extra = {}) => ({
  version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'member-0123abcd', lastSyncAt: 7, ...extra,
});

async function runTeam(argv, { fetch } = {}) {
  const args = ['team', ...argv];
  const getArg = (n) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  const hasFlag = (n) => args.includes(n);
  const lines = []; const errs = [];
  const origLog = console.log; const origErr = console.error; const origExit = process.exit;
  let code = 0;
  class Exit extends Error {}
  console.log = (s) => lines.push(String(s));
  console.error = (s) => errs.push(String(s));
  process.exit = (c) => { if (!code) code = c; throw new Exit(); };
  try { await run({ args, hasFlag, getArg, version: '0.0.0', fetch }); }
  catch (e) { if (!(e instanceof Exit)) throw e; }
  finally { console.log = origLog; console.error = origErr; process.exit = origExit; }
  return { code, out: lines.join('\n'), err: errs.join('\n') };
}

test('setDisplayName sends the trimmed name with the member key and stores the server answer', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ member_set_name: (b) => ({ json: b.display_name }) });
  assert.equal(await setDisplayName({ displayName: '  Mina Kim  ', fetch: f, dir }), 'Mina Kim');
  assert.deepEqual(f.calls, [{ fn: 'member_set_name', body: { member_key: 'spk_secret', display_name: 'Mina Kim' } }]);
  const st = loadTeamState(dir);
  assert.equal(st.displayName, 'Mina Kim');
  assert.equal(st.lastSyncAt, 7, 'other fields survive');
});

test('setDisplayName cuts at 80 code points without splitting an emoji', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ member_set_name: (b) => ({ json: b.display_name }) });
  const name = 'a'.repeat(79) + '😀😀';
  const stored = await setDisplayName({ displayName: name, fetch: f, dir });
  assert.equal(stored, 'a'.repeat(79) + '😀');
  assert.equal(Array.from(stored).length, 80);
});

test('setDisplayName refuses an empty name or a machine that is not joined, before any fetch', async (t) => {
  const dir = isolate(t);
  const f = mockFetch({});
  await assert.rejects(setDisplayName({ displayName: 'x', fetch: f, dir }), /not in a team/);
  saveTeamState(joined(), dir);
  await assert.rejects(setDisplayName({ displayName: '   ', fetch: f, dir }), /empty/);
  assert.equal(f.calls.length, 0);
});

test('team name <n> renames; several words become one name', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ member_set_name: (b) => ({ json: b.display_name }) });
  const r = await runTeam(['name', 'Mina', 'Kim'], { fetch: f });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Mina Kim/);
  assert.equal(f.calls[0].body.display_name, 'Mina Kim');
  assert.equal(loadTeamState(dir).displayName, 'Mina Kim');
});

test('team name without a name prints the current one and makes no call', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined({ displayName: 'Dana' }), dir);
  const f = mockFetch({});
  const r = await runTeam(['name'], { fetch: f });
  assert.equal(r.code, 0);
  assert.match(r.out, /Dana/);
  assert.match(r.out, /sprag team name/);
  assert.equal(f.calls.length, 0);
});

test('team name exits 2 when not joined, and 1 with a clear message on an older server', async (t) => {
  const dir = isolate(t);
  const r = await runTeam(['name', 'Mina'], { fetch: mockFetch({}) });
  assert.equal(r.code, 2);
  assert.match(r.err, /sprag team join/);

  saveTeamState(joined(), dir);
  const old = mockFetch({ member_set_name: { status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.member_set_name(display_name, member_key) in the schema cache' } } });
  const r2 = await runTeam(['name', 'Mina'], { fetch: old });
  assert.equal(r2.code, 1);
  assert.doesNotMatch(r2.err, /schema cache/);
  assert.equal(loadTeamState(dir).displayName, 'member-0123abcd', 'a refused rename keeps the old name');

  // Other refusals pass the server message through.
  const gone = mockFetch({ member_set_name: { status: 401, json: { message: 'member left the team' } } });
  const r3 = await runTeam(['name', 'Mina'], { fetch: gone });
  assert.equal(r3.code, 1);
  assert.match(r3.err, /member left the team/);
});

test('team name makes no call while team sync is off', async (t) => {
  const dir = isolate(t, { syncOff: true });
  saveTeamState(joined(), dir);
  const f = mockFetch({});
  const r = await runTeam(['name', 'Mina'], { fetch: f });
  assert.equal(r.code, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(loadTeamState(dir).displayName, 'member-0123abcd');
});

test('status points at team name only while the name is still the machine id', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  assert.match((await runTeam(['status'])).out, /sprag team name/);
  saveTeamState(joined({ displayName: 'Dana' }), dir);
  assert.doesNotMatch((await runTeam(['status'])).out, /sprag team name/);
});

test('join without --name after leave keeps the earlier display name', async (t) => {
  const dir = isolate(t, { syncOff: true });
  saveTeamState({ version: 1, left: true, leftAt: 1, teamName: 'Acme', displayName: 'Dana' }, dir);
  const f = mockFetch({ team_join: { json: { member_key: 'spk_new', member_id: 'm1', team_id: 't1', team_name: 'Acme', plan: 'team' } } });
  const r = await runTeam(['join', TOKEN, '--yes'], { fetch: f });
  assert.equal(r.code, 0, r.err);
  assert.equal(f.calls.find((c) => c.fn === 'team_join').body.display_name, 'Dana');
  assert.equal(loadTeamState(dir).displayName, 'Dana');
});
