// diag-log: the local log of swallowed errors on a joined machine (uploaded by the team sync).
// Temp dirs only; XDG_CONFIG_HOME points at one so debug() and the default paths never see the real data dir.

import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-diag-')));
process.env.XDG_CONFIG_HOME = join(root, 'xdg');
delete process.env.SPRAG_DEBUG;
delete process.env.CTS_DEBUG;
delete process.env.SPRAG_NO_DIAG;
delete process.env.SPRAG_NO_TEAM_SYNC;

const {
  recordDiag, readDiag, ackDiag, sanitizeDiag, diagPath, diagSrcDir, _resetDiagForTest, MAX_ENTRIES,
} = await import('../src/diag-log.js');
const { debug } = await import('../src/debug.js');
const { userDataDir } = await import('../src/paths.js');

after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
beforeEach(() => _resetDiagForTest());

let n = 0;
function tempDir({ joined = true } = {}) {
  const dir = join(root, `d${++n}`);
  mkdirSync(dir, { recursive: true });
  if (joined) writeFileSync(join(dir, 'team.json'), JSON.stringify({ memberKey: 'spk_secret' }));
  return dir;
}
const ENV = {}; // no SPRAG_* switches

test('sanitizeDiag masks home, URL hosts, secrets and e-mail, collapses whitespace and cuts to 300', () => {
  const home = homedir();
  assert.equal(sanitizeDiag(`ENOENT ${home}/.claude/projects`), 'ENOENT ~/.claude/projects');
  // paths keep only their last segment, so a project directory never goes up
  assert.equal(sanitizeDiag(`ENOENT: no such file, open '${home}/work/secret-app/notes.md'`), "ENOENT: no such file, open '~/…/notes.md'");
  assert.equal(sanitizeDiag(`read ${home}/.claude/projects/-Users-x-secret-app/abc.jsonl`), 'read ~/.claude/projects/…/abc.jsonl');
  assert.equal(sanitizeDiag('EACCES /usr/local/lib/node_modules/sprag-cli/x.js'), 'EACCES /…/x.js');
  assert.equal(sanitizeDiag('open C:\\Work\\secret-app\\a.json'), 'open C:\\…\\a.json');
  assert.equal(sanitizeDiag('model=claude-sonnet-4-5 reason=not-listed known=a/b,c'), 'model=claude-sonnet-4-5 reason=not-listed known=a/b,c');
  assert.equal(sanitizeDiag('GET https://llm.corp.example:4000/model/info failed'), 'GET <host>/model/info failed');
  assert.equal(sanitizeDiag('http://user:pw@internal.example/x'), '<host>/x');
  const secret = 'sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0';
  const out = sanitizeDiag(`bad key ${secret} for me`);
  assert.ok(!out.includes(secret));
  assert.match(out, /\[redacted\]/);
  assert.equal(sanitizeDiag('mail alice@corp.example now'), 'mail <email> now');
  assert.equal(sanitizeDiag('a\n\n  b\t c'), 'a b c');
  assert.equal(sanitizeDiag('x'.repeat(500)).length, 300);
  assert.equal(sanitizeDiag('arn:aws:bedrock:ap-northeast-2:123456789012:application-inference-profile/abc'),
    'arn:aws:bedrock:ap-northeast-2:<acct>:application-inference-profile/abc');
});

test('a machine that is not joined writes nothing', () => {
  const dir = tempDir({ joined: false });
  recordDiag('scope', new Error('boom'), { dir, env: ENV });
  assert.equal(existsSync(diagPath(dir)), false);
  // a team.json that has left is not joined either
  const left = tempDir({ joined: false });
  writeFileSync(join(left, 'team.json'), JSON.stringify({ memberKey: 'spk_secret', left: true }));
  recordDiag('scope', new Error('boom'), { dir: left, env: ENV });
  assert.equal(existsSync(diagPath(left)), false);
});

test('a joined machine gets an entry with scope, message, count and ISO times; the file is private', () => {
  const dir = tempDir();
  const now = Date.parse('2026-11-09T01:02:03Z');
  recordDiag('team-sync', new Error('first line\nsecond line'), { dir, now, env: ENV });
  const entries = readDiag({ dir });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { scope: 'team-sync', msg: 'first line', count: 1, first: '2026-11-09T01:02:03.000Z', last: '2026-11-09T01:02:03.000Z' });
  assert.equal(JSON.parse(readFileSync(diagPath(dir), 'utf8')).version, 1);
  if (process.platform !== 'win32') assert.equal(statSync(diagPath(dir)).mode & 0o777, 0o600);
});

test('the first stack frame inside sprag src/ is appended, a foreign frame is not', () => {
  const dir = tempDir();
  const own = new Error('inside');
  own.stack = `Error: inside\n    at x (/other/lib/a.js:1:1)\n    at f (${diagSrcDir}/commands/team.js:42:7)\n    at g (${diagSrcDir}/debug.js:9:1)`;
  recordDiag('a', own, { dir, env: ENV });
  const foreign = new Error('outside');
  foreign.stack = 'Error: outside\n    at x (/other/lib/a.js:1:1)';
  recordDiag('b', foreign, { dir, env: ENV });
  recordDiag('c', 'a plain string', { dir, env: ENV });
  const byScope = Object.fromEntries(readDiag({ dir }).map((e) => [e.scope, e.msg]));
  assert.equal(byScope.a, 'inside @ src/commands/team.js:42');
  assert.equal(byScope.b, 'outside');
  assert.equal(byScope.c, 'a plain string');
});

test('scope is cut to 60 characters', () => {
  const dir = tempDir();
  recordDiag('s'.repeat(100), new Error('m'), { dir, env: ENV });
  assert.equal(readDiag({ dir })[0].scope.length, 60);
});

test('the same key counts once per process, and again from a second process', () => {
  const dir = tempDir();
  for (let i = 0; i < 5; i++) recordDiag('s', new Error('same'), { dir, env: ENV });
  assert.equal(readDiag({ dir })[0].count, 1);
  _resetDiagForTest(); // a second process
  recordDiag('s', new Error('same'), { dir, now: Date.parse('2026-12-01T00:00:00Z'), env: ENV });
  const [e] = readDiag({ dir });
  assert.equal(e.count, 2);
  assert.equal(e.last, '2026-12-01T00:00:00.000Z');
  assert.notEqual(e.first, e.last);
  assert.equal(readDiag({ dir }).length, 1);
});

test('the log keeps 50 entries and drops the one with the oldest last time', () => {
  const dir = tempDir();
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  for (let i = 0; i < MAX_ENTRIES + 5; i++) recordDiag('s', new Error(`m${i}`), { dir, now: t0 + i * 1000, env: ENV });
  const entries = readDiag({ dir });
  assert.equal(entries.length, 50);
  const msgs = new Set(entries.map((e) => e.msg));
  assert.ok(!msgs.has('m0') && !msgs.has('m4'));
  assert.ok(msgs.has('m5') && msgs.has('m54'));
});

test('SPRAG_NO_DIAG=1 and SPRAG_NO_TEAM_SYNC=1 (and the CTS_ names) record nothing', () => {
  for (const env of [{ SPRAG_NO_DIAG: '1' }, { CTS_NO_DIAG: '1' }, { SPRAG_NO_TEAM_SYNC: '1' }, { CTS_NO_TEAM_SYNC: '1' }]) {
    const dir = tempDir();
    recordDiag('s', new Error('x'), { dir, env });
    assert.equal(existsSync(diagPath(dir)), false, JSON.stringify(env));
  }
});

test('recordDiag never throws, whatever it is given', () => {
  const dir = tempDir();
  const evil = { get message() { throw new Error('getter'); }, get stack() { throw new Error('getter'); } };
  assert.doesNotThrow(() => recordDiag('s', evil, { dir, env: ENV }));
  assert.doesNotThrow(() => recordDiag('s', undefined, { dir, env: ENV }));
  assert.doesNotThrow(() => recordDiag('s', null, { dir: join(root, 'no', 'such', 'dir'), env: ENV }));
  assert.doesNotThrow(() => recordDiag(undefined, new Error('x'), { dir: 12345, env: ENV }));
});

test('ackDiag subtracts the sent counts, removes emptied entries and keeps newer arrivals', () => {
  const dir = tempDir();
  recordDiag('a', new Error('one'), { dir, env: ENV });
  recordDiag('b', new Error('two'), { dir, env: ENV });
  _resetDiagForTest();
  recordDiag('a', new Error('one'), { dir, env: ENV }); // a: count 2
  const sent = readDiag({ dir }); // a:2, b:1
  _resetDiagForTest();
  recordDiag('a', new Error('one'), { dir, env: ENV }); // arrives during the upload: a:3
  recordDiag('c', new Error('three'), { dir, env: ENV });
  ackDiag(sent, { dir });
  const left = Object.fromEntries(readDiag({ dir }).map((e) => [e.scope, e.count]));
  assert.deepEqual(left, { a: 1, c: 1 });
  ackDiag(readDiag({ dir }), { dir });
  assert.deepEqual(readDiag({ dir }), []);
});

test('readDiag answers an empty list for a missing, corrupt or foreign file', () => {
  const dir = tempDir();
  assert.deepEqual(readDiag({ dir }), []);
  writeFileSync(diagPath(dir), '{nope');
  assert.deepEqual(readDiag({ dir }), []);
  writeFileSync(diagPath(dir), JSON.stringify({ version: 9, entries: [{ scope: 'a', msg: 'b', count: 1 }] }));
  assert.deepEqual(readDiag({ dir }), []);
  writeFileSync(diagPath(dir), JSON.stringify({ version: 1, entries: [{ scope: 'a' }, { scope: 'a', msg: 'b', count: 2, first: 'x', last: 'y' }] }));
  assert.equal(readDiag({ dir }).length, 1);
});

test('debug() records on a joined machine even without SPRAG_DEBUG', () => {
  const dir = userDataDir(); // XDG_CONFIG_HOME above
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'team.json'), JSON.stringify({ memberKey: 'spk_secret' }));
  debug('some-scope', new Error('swallowed'));
  const entries = readDiag({ dir });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].scope, 'some-scope');
  assert.match(entries[0].msg, /^swallowed/);
});
