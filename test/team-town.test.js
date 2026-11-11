/**
 * `sprag team town`: asks the team server for a 12-hour town link (town_view_link), prints it and opens it.
 * fetch and the browser opener are injected and the data dir is a temp dir, so nothing here reaches the network or a browser.
 * Output wording follows the configured language, so assertions pin the URL, the calls and the exit codes, not prose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveTeamState, TEAM_API_URL } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';
import { run, townUrl, TOWN_URL } from '../src/commands/team.js';

const TOKEN = 'stv_' + 'ab12'.repeat(16);
const EXPIRES = '2026-11-11T21:00:00.000Z';

function isolate(t, { syncOff = false, townUrlEnv } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-town-'));
  const keys = ['XDG_CONFIG_HOME', 'SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'SPRAG_TOWN_URL', 'HOME', 'USERPROFILE', 'CODEX_HOME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.XDG_CONFIG_HOME = root;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.CODEX_HOME = join(root, '.codex');
  delete process.env.SPRAG_TEAM_TOKEN;
  if (townUrlEnv) process.env.SPRAG_TOWN_URL = townUrlEnv; else delete process.env.SPRAG_TOWN_URL;
  if (syncOff) process.env.SPRAG_NO_TEAM_SYNC = '1'; else delete process.env.SPRAG_NO_TEAM_SYNC;
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mockFetch(routes = {}) {
  const calls = [];
  const f = async (url, init) => {
    const fn = url.replace(TEAM_API_URL, '').split('/rpc/')[1];
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

const joined = () => ({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'Mina', lastSyncAt: 7 });

async function runTeam(argv, { fetch, openUrl }) {
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
  try { await run({ args, hasFlag, getArg, version: '0.0.0', fetch, openUrl }); }
  catch (e) { if (!(e instanceof Exit)) throw e; }
  finally { console.log = origLog; console.error = origErr; process.exit = origExit; }
  return { code, out: lines.join('\n'), err: errs.join('\n') };
}

test('town prints the link with the token in the fragment, opens it and sends the member key only', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ town_view_link: { json: { token: TOKEN, expires_at: EXPIRES } } });
  const opened = [];
  const r = await runTeam(['town'], { fetch: f, openUrl: (u) => opened.push(u) });
  const url = `https://sprag.io/town/#t=${TOKEN}`;
  assert.equal(r.code, 0);
  assert.deepEqual(f.calls, [{ fn: 'town_view_link', body: { member_key: 'spk_secret' } }]);
  assert.ok(r.out.includes(url), r.out);
  assert.deepEqual(opened, [url]);
  assert.ok(r.out.includes(new Date(EXPIRES).toLocaleString()), 'the expiry is printed in local time');
});

test('town --no-open prints the link and does not open a browser', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ town_view_link: { json: { token: TOKEN, expires_at: EXPIRES } } });
  const opened = [];
  const r = await runTeam(['town', '--no-open'], { fetch: f, openUrl: (u) => opened.push(u) });
  assert.equal(r.code, 0);
  assert.deepEqual(opened, []);
  assert.ok(r.out.includes(`#t=${TOKEN}`));
});

test('town without a team exits 1, asks for nothing and opens nothing', async (t) => {
  isolate(t);
  const f = mockFetch({});
  const opened = [];
  const r = await runTeam(['town'], { fetch: f, openUrl: (u) => opened.push(u) });
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('sprag team join'), r.err);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(opened, []);
});

test('town after leaving the team counts as not joined', async (t) => {
  const dir = isolate(t);
  saveTeamState({ ...joined(), left: true }, dir);
  const f = mockFetch({});
  const r = await runTeam(['town'], { fetch: f, openUrl: () => assert.fail('opened') });
  assert.equal(r.code, 1);
  assert.deepEqual(f.calls, []);
});

test('town maps the rate-limit error to a plain message and exits 1', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const f = mockFetch({ town_view_link: { status: 400, json: { message: 'too many town links, try again later' } } });
  const r = await runTeam(['town'], { fetch: f, openUrl: () => assert.fail('opened') });
  assert.equal(r.code, 1);
  assert.ok(!r.err.includes('town_view_link:'), 'not the raw RPC error: ' + r.err);
  assert.ok(r.err.length > 10);
  assert.equal(r.out, '');
});

test('town on an older server and on a malformed reply fail with exit 1 and no browser', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const old = await runTeam(['town'], { fetch: mockFetch({ town_view_link: { status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.town_view_link' } } }), openUrl: () => assert.fail('opened') });
  assert.equal(old.code, 1);
  assert.ok(!old.err.includes('PGRST202') && !old.err.includes('town_view_link:'), old.err);
  for (const bad of [null, {}, { token: 'stv_short', expires_at: EXPIRES }, { token: TOKEN.replace('stv_', 'xyz_'), expires_at: EXPIRES }]) {
    const r = await runTeam(['town'], { fetch: mockFetch({ town_view_link: { json: bad } }), openUrl: () => assert.fail('opened') });
    assert.equal(r.code, 1, JSON.stringify(bad));
  }
});

test('any other server error is shown as is with exit 1', async (t) => {
  const dir = isolate(t);
  saveTeamState(joined(), dir);
  const r = await runTeam(['town'], { fetch: mockFetch({ town_view_link: { status: 400, json: { message: 'invalid member key' } } }), openUrl: () => assert.fail('opened') });
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('invalid member key'));
});

test('SPRAG_TOWN_URL points the link at another page, and the usage lists the command', async (t) => {
  const dir = isolate(t, { townUrlEnv: 'http://localhost:8788/town/' });
  saveTeamState(joined(), dir);
  assert.equal(townUrl(), 'http://localhost:8788/town/');
  const r = await runTeam(['town', '--no-open'], { fetch: mockFetch({ town_view_link: { json: { token: TOKEN, expires_at: EXPIRES } } }), openUrl: () => {} });
  assert.ok(r.out.includes(`http://localhost:8788/town/#t=${TOKEN}`));
  delete process.env.SPRAG_TOWN_URL;
  assert.equal(townUrl(), TOWN_URL);
  const u = await runTeam([], { fetch: mockFetch({}), openUrl: () => {} });
  assert.match(u.out, /town \[--no-open\]/);
});
