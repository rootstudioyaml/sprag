/**
 * `sprag team create` and the sign-in helpers. Output wording follows the user's
 * configured language, so assertions pin commands and URLs, not prose. fetch is injected and the data
 * dir is a temp dir, so nothing here reaches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  requestSignInCode, verifySignInCode, createTeam, joinTeam, loadTeamState, saveTeamState, teamStatePath,
  TEAM_API_URL, TEAM_ANON_KEY,
} from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';
import { run } from '../src/commands/team.js';
import { memberIdPath } from '../src/member-id.js';

const TOKEN = 'spt_' + 'b'.repeat(32);
const ACCESS = 'access-token-xyz';

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-create-'));
  const keys = ['XDG_CONFIG_HOME', 'SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'HOME', 'USERPROFILE', 'CODEX_HOME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.XDG_CONFIG_HOME = root;
  // a successful pull rewrites ~/.claude/ratchet-team.md: keep it in the temp dir
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.CODEX_HOME = join(root, '.codex');
  delete process.env.SPRAG_TEAM_TOKEN;
  process.env.SPRAG_NO_TEAM_SYNC = '1'; // join still runs (explicit action); the follow-up sync is skipped
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  mkdirSync(userDataDir(), { recursive: true });
}

/** Routes by URL path; records every call. */
function mockFetch(routes = {}) {
  const calls = [];
  const f = async (url, init) => {
    const path = url.replace(TEAM_API_URL, '');
    calls.push({ path, headers: init.headers, body: JSON.parse(init.body) });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    const r = key ? routes[key] : { status: 404, json: { message: 'no route' } };
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.json };
  };
  f.calls = calls;
  return f;
}

const happy = () => mockFetch({
  '/auth/v1/otp': { json: {} },
  '/auth/v1/verify': { json: { access_token: ACCESS, user: { id: 'u-1' } } },
  '/rest/v1/rpc/team_create': { json: { id: 't-1', name: 'Acme', org_id: 'o-1', org_name: 'Acme Org', invite_token: TOKEN, plan: 'team' } },
  '/rest/v1/rpc/team_join': { json: { member_key: 'spk_k', member_id: 'm1', team_id: 't-1', team_name: 'Acme', plan: 'team', prompt_capture: false, org_id: 'o-1', org_name: 'Acme Org', seats_used: 1, seat_limit: 5 } },
});

/** Runs the command with a fake process.exit/console; returns exit code and output. */
async function runCreate(argv, { fetch, interactive = false, ask, verb = 'create' } = {}) {
  const args = ['team', verb, ...argv];
  const getArg = (n) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  const hasFlag = (n) => args.includes(n);
  const lines = []; const errs = [];
  const origLog = console.log; const origErr = console.error; const origExit = process.exit;
  let code = 0;
  class Exit extends Error {}
  console.log = (s) => lines.push(String(s));
  console.error = (s) => errs.push(String(s));
  process.exit = (c) => { if (!code) code = c; throw new Exit(); };
  try { await run({ args, hasFlag, getArg, version: '0.0.0', fetch, interactive, ask }); }
  catch (e) { if (!(e instanceof Exit)) throw e; }
  finally { console.log = origLog; console.error = origErr; process.exit = origExit; }
  return { code, out: lines.join('\n'), err: errs.join('\n') };
}

test('requestSignInCode posts email + create_user with the anon key only', async () => {
  const f = mockFetch({ '/auth/v1/otp': { json: {} } });
  await requestSignInCode({ email: 'a@b.co', fetch: f });
  const c = f.calls[0];
  assert.equal(c.path, '/auth/v1/otp');
  assert.deepEqual(c.body, { email: 'a@b.co', create_user: true });
  assert.equal(c.headers.apikey, TEAM_ANON_KEY);
  assert.equal(c.headers.Authorization, undefined);
  assert.equal(c.headers['Content-Type'], 'application/json');
});

test('verifySignInCode posts type/email/token and returns accessToken + userId', async () => {
  const f = mockFetch({ '/auth/v1/verify': { json: { access_token: ACCESS, user: { id: 'u-1' } } } });
  const r = await verifySignInCode({ email: 'a@b.co', code: '123456', fetch: f });
  assert.deepEqual(r, { accessToken: ACCESS, userId: 'u-1' });
  assert.deepEqual(f.calls[0].body, { type: 'email', email: 'a@b.co', token: '123456' });
  assert.equal(f.calls[0].headers.Authorization, undefined);
});

test('createTeam calls rpc/team_create with Bearer and p_org_id, maps the row', async () => {
  const f = mockFetch({ '/rest/v1/rpc/team_create': { json: { id: 't-1', name: 'Acme', org_id: 'o-9', org_name: 'Big Org', invite_token: TOKEN, plan: 'business' } } });
  const r = await createTeam({ name: 'Acme', accessToken: ACCESS, userId: 'u-1', orgId: 'o-9', fetch: f });
  assert.deepEqual(r, { id: 't-1', name: 'Acme', inviteToken: TOKEN, plan: 'business', orgId: 'o-9', orgName: 'Big Org' });
  const c = f.calls[0];
  assert.equal(c.path, '/rest/v1/rpc/team_create');
  assert.equal(c.headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(c.headers.apikey, TEAM_ANON_KEY);
  assert.deepEqual(c.body, { p_name: 'Acme', p_org_id: 'o-9' });
});

test('createTeam without orgId sends p_org_id null', async () => {
  const f = happy();
  await createTeam({ name: 'Acme', accessToken: ACCESS, userId: 'u-1', fetch: f });
  assert.deepEqual(f.calls[0].body, { p_name: 'Acme', p_org_id: null });
});

test('helpers surface the server message from msg / error_description / message', async () => {
  for (const [json, want] of [[{ msg: 'bad msg' }, 'bad msg'], [{ error_description: 'bad desc' }, 'bad desc'], [{ message: 'bad message' }, 'bad message']]) {
    const f = mockFetch({ '/auth/v1/otp': { status: 422, json } });
    await assert.rejects(requestSignInCode({ email: 'a@b.co', fetch: f }), (e) => e.message.includes(want));
  }
  const f = mockFetch({ '/auth/v1/verify': { status: 500, json: null } });
  await assert.rejects(verifySignInCode({ email: 'a@b.co', code: '123456', fetch: f }), /HTTP 500/);
});

test('create without --code (no TTY) sends the code and prints the re-run hint', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme'], { fetch: f });
  assert.equal(r.code, 0);
  assert.match(r.out, /sprag team create --email a@b\.co --name "Acme" --code <(code|코드)>/);
  assert.deepEqual(f.calls.map((c) => c.path), ['/auth/v1/otp']);
});

test('create with --code verifies, creates, joins, saves state and prints the token', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456'], { fetch: f });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(f.calls.map((c) => c.path), ['/auth/v1/verify', '/rest/v1/rpc/team_create', '/rest/v1/rpc/team_join']);
  assert.ok(r.out.includes(TOKEN));
  assert.ok(r.out.includes(`npm i -g sprag-cli@latest && sprag team join ${TOKEN}`));
  assert.ok(r.out.includes(`export SPRAG_TEAM_TOKEN=${TOKEN}`));
  assert.match(r.out, /https:\/\/sprag\.io\/team\/ \(.*a@b\.co/); // en and ko wording differ
  assert.ok(!r.out.includes(ACCESS) && !r.err.includes(ACCESS));
  const st = loadTeamState();
  assert.equal(st.memberKey, 'spk_k');
  assert.ok(!readFileSync(teamStatePath(), 'utf8').includes(ACCESS));
});

test('--no-join creates the team but leaves this machine alone', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456', '--no-join'], { fetch: f });
  assert.equal(r.code, 0);
  assert.ok(!f.calls.some((c) => c.path.includes('team_join')));
  assert.equal(loadTeamState().memberKey, undefined);
});

test('invalid email or code exits 2 before any network call', async (t) => {
  isolate(t);
  for (const argv of [['--email', 'bad'], ['--email', 'a@b.co', '--name', 'x', '--code', '12345'], ['--email', 'a@b.co', '--name', 'x', '--code', 'abcdef']]) {
    const f = happy();
    const r = await runCreate(argv, { fetch: f });
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(f.calls.length, 0);
  }
});

test('--code without --name exits 2; no --email (no TTY) exits 2', async (t) => {
  isolate(t);
  let f = happy();
  assert.equal((await runCreate(['--email', 'a@b.co', '--code', '123456'], { fetch: f })).code, 2);
  assert.equal(f.calls.length, 0);
  f = happy();
  assert.equal((await runCreate([], { fetch: f })).code, 2);
  assert.equal(f.calls.length, 0);
});

test('already joined exits 1 unless --no-join', async (t) => {
  isolate(t);
  saveTeamState({ version: 1, memberKey: 'spk_old', teamName: 'Old' });
  let f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456'], { fetch: f });
  assert.equal(r.code, 1);
  assert.match(r.err, /sprag team leave/);
  assert.equal(f.calls.length, 0);
  f = happy();
  const r2 = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456', '--no-join'], { fetch: f });
  assert.equal(r2.code, 0);
  assert.equal(loadTeamState().memberKey, 'spk_old');
});

test('server error message is surfaced with exit 1', async (t) => {
  isolate(t);
  const f = mockFetch({ '/auth/v1/verify': { status: 403, json: { msg: 'Token has expired or is invalid' } } });
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456'], { fetch: f });
  assert.equal(r.code, 1);
  assert.match(r.err, /Token has expired or is invalid/);
});

test('interactive flow asks for email, code and name', async (t) => {
  isolate(t);
  const f = happy();
  const answers = ['a@b.co', '123456', 'Acme'];
  const r = await runCreate([], { fetch: f, interactive: true, ask: async () => answers.shift() });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(f.calls.map((c) => c.path), ['/auth/v1/otp', '/auth/v1/verify', '/rest/v1/rpc/team_create', '/rest/v1/rpc/team_join']);
  assert.equal(f.calls[2].body.p_name, 'Acme');
});

test('create --org sends p_org_id to rpc/team_create with Bearer and prints org seats', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'Acme', '--code', '123456', '--org', 'o-1'], { fetch: f });
  assert.equal(r.code, 0, r.err);
  const c = f.calls.find((x) => x.path === '/rest/v1/rpc/team_create');
  assert.deepEqual(c.body, { p_name: 'Acme', p_org_id: 'o-1' });
  assert.equal(c.headers.Authorization, `Bearer ${ACCESS}`);
  assert.ok(r.out.includes('Acme Org'));
  assert.match(r.out, /1\/5/);
  const st = loadTeamState();
  assert.equal(st.orgName, 'Acme Org');
  assert.equal(st.seatLimit, 5);
});

test('create --org without a value exits 2 before any network call', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate(['--email', 'a@b.co', '--name', 'x', '--org'], { fetch: f });
  assert.equal(r.code, 2);
  assert.equal(f.calls.length, 0);
});

test('seat limit reached on join: typed error, friendly message, exit 1', async (t) => {
  isolate(t);
  const f = mockFetch({ '/rest/v1/rpc/team_join': { status: 400, json: { message: 'seat limit reached', code: 'P0001' } } });
  await assert.rejects(joinTeam({ token: TOKEN, displayName: 'x', fetch: f }), (e) => e.code === 'SEAT_LIMIT');
  const args = ['team', 'join', TOKEN, '--yes'];
  const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const errs = []; const origErr = console.error; const origLog = console.log; const origExit = process.exit;
  let code = 0;
  console.error = (s) => errs.push(String(s)); console.log = () => {};
  process.exit = (c) => { code = c; throw new Error('exit'); };
  // run() reaches the network through the default fetch, so swap it for this call
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => f(url, init);
  try { await run({ args, hasFlag: (n) => args.includes(n), getArg, version: '0.0.0' }); } catch { /* exit */ }
  finally { console.error = origErr; console.log = origLog; process.exit = origExit; globalThis.fetch = origFetch; }
  assert.equal(code, 1);
  assert.match(errs.join('\n'), /(free seat|남은 좌석)/);
  assert.ok(!/P0001|team_join:/.test(errs.join('\n')));
});

test('status prints the organization name when the state has it', async (t) => {
  isolate(t);
  saveTeamState({ version: 1, memberKey: 'spk_k', teamName: 'Acme', orgName: 'Acme Org', plan: 'team', displayName: 'me' });
  const args = ['team', 'status'];
  const lines = []; const origLog = console.log;
  console.log = (s) => lines.push(String(s));
  try { await run({ args, hasFlag: (n) => args.includes(n), getArg: () => undefined, version: '0.0.0' }); }
  finally { console.log = origLog; }
  assert.ok(lines.some((l) => l.includes('Acme Org')));
});

test('join without --name sends a random member id, not the OS user name', async (t) => {
  isolate(t);
  const f = happy();
  const r = await runCreate([TOKEN, '--yes'], { fetch: f, verb: 'join' });
  assert.equal(r.code, 0);
  const call = f.calls.find((c) => c.path === '/rest/v1/rpc/team_join');
  assert.match(call.body.display_name, /^member-[0-9a-f]{8}$/);
  assert.notEqual(call.body.display_name, userInfo().username);
});

test('create without --code (no TTY) proposes a team name from the member id, not the OS user name', async (t) => {
  isolate(t);
  const r = await runCreate(['--email', 'x@example.com'], { fetch: happy() });
  assert.equal(r.code, 0);
  assert.match(r.out, /member-[0-9a-f]{8}'s team/);
  assert.ok(!r.out.includes(`${userInfo().username}'s team`));
});

test('status for a joined state does not create the member-id file', async (t) => {
  isolate(t);
  saveTeamState({ version: 1, memberKey: 'spk_k', teamName: 'Acme', plan: 'team', displayName: 'member-0a1b2c3d' });
  const r = await runCreate([], { verb: 'status' });
  assert.equal(r.code, 0);
  assert.equal(existsSync(memberIdPath()), false);
});
