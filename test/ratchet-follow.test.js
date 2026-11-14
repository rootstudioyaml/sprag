/**
 * The ratchet follower on the PostToolUse hook: an error that repeats in one
 * session, or shows up in a second session, becomes a candidate and gets one
 * notice for the model; the ledger keeps hashes only.
 *
 * Every call passes `dir`, a temp directory standing in for the user data dir,
 * and `harnessReady`, so nothing here touches the developer's real state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ratchetFollowToolUse } from '../src/ratchet-follow.js';

const require = createRequire(import.meta.url);
const { lintKoreanText } = require('../src/korean-lint.cjs');
const analyzer = require('../src/harness-analyzer.cjs');

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const CWD = '/home/me/proj';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-ratchet-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}
const errText = (n) => `fetch from corp-registry.example failed with status ${n} while resolving the package metadata`;
const line = (o) => JSON.stringify(o) + '\n';
function transcript(dir, name, errors) {
  const file = join(dir, `${name}.jsonl`);
  let out = '';
  let i = 0;
  for (const text of errors) {
    out += line({ type: 'assistant', timestamp: new Date(T0 + i++).toISOString(), message: { role: 'assistant', id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: {} }] } });
    out += line({ type: 'user', timestamp: new Date(T0 + i++).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: true, content: text }] } });
  }
  writeFileSync(file, out);
  return file;
}
const call = (dir, sid, file, extra = {}, opts = {}) =>
  ratchetFollowToolUse(
    { session_id: sid, transcript_path: file, cwd: CWD, hook_event_name: 'PostToolUse', ...extra },
    { dir, cfg: {}, now: T0, lang: 'ko', harnessReady: true, ...opts },
  );
const ledgerPath = (dir) => join(dir, 'ratchet-seen.json');

test('the same error twice in one session gives one notice, then silence', async (t) => {
  const dir = tmp(t);
  const tr = transcript(dir, 's1', [errText(404), errText(500)]);
  const out = await call(dir, 'sess-1', tr);
  assert.match(out, /^✇ \[sprag\] 같은 오류가 이 세션에서 2번 발생했습니다: "fetch from corp-registry\.example failed/);
  assert.ok(out.includes('harness promote "<룰>" --global'));
  assert.equal(await call(dir, 'sess-1', tr), null);
  const c = analyzer.readCandidates(dir);
  assert.equal(c.sessionId, 'sess-1');
  assert.equal(c.cwd, CWD);
  assert.equal(c.candidates[0].count, 2);
  assert.equal(c.candidates[0].id, 1);
  const ev = readFileSync(join(dir, 'route-follow-events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(ev.map((e) => [e.event, e.count, e.sessions]), [['ratchet-nudged', 2, 1]]);
  assert.ok(!JSON.stringify(ev).includes('corp-registry'));
});

test('a second session with the same error shape speaks, and the ledger holds no error text', async (t) => {
  const dir = tmp(t);
  assert.equal(await call(dir, 'sess-a', transcript(dir, 'a', [errText(404)])), null);
  assert.equal(analyzer.readCandidates(dir), null, 'one sighting is not a candidate');
  const out = await call(dir, 'sess-b', transcript(dir, 'b', [errText(503)]));
  assert.match(out, /최근 30일 동안 세션 2개에서 발생했습니다/);
  const raw = readFileSync(ledgerPath(dir), 'utf8');
  assert.ok(!raw.includes('corp-registry') && !raw.includes('fetch'));
  const ledger = JSON.parse(raw);
  assert.equal(ledger.v, 1);
  const [entry] = Object.values(ledger.sigs);
  assert.equal(entry.s.length, 2);
  assert.equal(entry.nudged, T0);
});

test('after the notice a third session with the same error stays silent', async (t) => {
  const dir = tmp(t);
  await call(dir, 'sess-a', transcript(dir, 'a', [errText(1)]));
  assert.ok(await call(dir, 'sess-b', transcript(dir, 'b', [errText(2)])));
  assert.equal(await call(dir, 'sess-c', transcript(dir, 'c', [errText(3)])), null);
  assert.equal(analyzer.readCandidates(dir).candidates[0].sessions, 3);
});

test('silent cases: harness off, subagent, PreToolUse, harness not ready, bad ids', async (t) => {
  const twice = (dir, name) => transcript(dir, name, [errText(1), errText(2)]);
  let dir = tmp(t);
  assert.equal(await call(dir, 's', twice(dir, 'a'), {}, { cfg: { harness: { enabled: false } } }), null);
  assert.equal(existsSync(ledgerPath(dir)), false);
  dir = tmp(t);
  assert.equal(await call(dir, 's', twice(dir, 'a'), { agent_id: 'sub-1' }), null);
  dir = tmp(t);
  assert.equal(await call(dir, 's', twice(dir, 'a'), { hook_event_name: 'PreToolUse' }), null);
  dir = tmp(t);
  assert.equal(await call(dir, 's', twice(dir, 'a'), {}, { harnessReady: false }), null);
  dir = tmp(t);
  assert.equal(await call(dir, 'bad id/../x', twice(dir, 'a')), null);
  assert.equal(await call(dir, 's', null), null);
  assert.equal(existsSync(ledgerPath(dir)), false);
});

test('ratchetFollowUp false drops the notice but still writes the candidate file', async (t) => {
  const dir = tmp(t);
  assert.equal(await call(dir, 's', transcript(dir, 'a', [errText(1), errText(2)]), {}, { cfg: { ratchetFollowUp: false } }), null);
  assert.equal(analyzer.readCandidates(dir).candidates[0].count, 2);
});

test('ledger entries older than 30 days are dropped on the next write', async (t) => {
  const dir = tmp(t);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath(dir), JSON.stringify({ v: 1, sigs: {
    old000000001: { s: ['aaaaaaaa'], first: T0 - 40 * DAY, last: T0 - 31 * DAY },
    new000000002: { s: ['bbbbbbbb'], first: T0 - 2 * DAY, last: T0 - 1 * DAY },
  } }));
  await call(dir, 's', transcript(dir, 'a', [errText(1)]));
  const sigs = JSON.parse(readFileSync(ledgerPath(dir), 'utf8')).sigs;
  assert.equal(sigs.old000000001, undefined);
  assert.ok(sigs.new000000002);
  assert.equal(Object.keys(sigs).length, 2);
});

test('a call without errors reads and writes nothing', async (t) => {
  const dir = tmp(t);
  const file = join(dir, 'clean.jsonl');
  writeFileSync(file, line({ type: 'user', timestamp: new Date(T0).toISOString(), message: { role: 'user', content: 'hello' } }));
  assert.equal(await call(dir, 's', file), null);
  assert.equal(existsSync(ledgerPath(dir)), false);
  assert.equal(existsSync(join(dir, 'ratchet-candidates.json')), false);
  assert.equal(existsSync(join(dir, 'route-follow')), false);
});

test('Korean notice passes the lint and English notice is in English', async (t) => {
  const dir = tmp(t);
  const out = await call(dir, 's1', transcript(dir, 'a', [errText(1), errText(2)]));
  assert.deepEqual(lintKoreanText(out, { maxFindings: 50 }), []);
  const dir2 = tmp(t);
  const en = await call(dir2, 's1', transcript(dir2, 'a', [errText(1), errText(2)]), {}, { lang: 'en' });
  assert.match(en, /^✇ \[sprag\] The same error has now come up 2 times in this session: "fetch from corp-registry\.example/);
  assert.ok(en.endsWith('This notice does not repeat for this error.'));
  const dir3 = tmp(t);
  await call(dir3, 'sa', transcript(dir3, 'a', [errText(1)]), {}, { lang: 'en' });
  const en2 = await call(dir3, 'sb', transcript(dir3, 'b', [errText(2)]), {}, { lang: 'en' });
  assert.match(en2, /come up in 2 sessions over the last 30 days:/);
});
