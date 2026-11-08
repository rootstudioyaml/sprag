/**
 * What sprag writes to disk must not keep a user's secrets.
 *
 * Covers the 2026-11-09 hardening: rule examples are masked before they are cut
 * to 80 characters (registry, route-scan candidates, the rendered
 * ratchet-model.md, Codex candidates), backup copies of settings and notes are
 * owner-only, converted documents and stray temp files are cleaned up.
 * HOME and XDG_CONFIG_HOME point into a temp directory before any module that
 * resolves a path is loaded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, readdirSync, utimesSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-hygiene-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
{
  const clean = childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG });
  for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
}
process.once('exit', () => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });

const require = createRequire(import.meta.url);
const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const mode = (p) => statSync(p).mode & 0o777;
const owner = process.platform === 'win32' ? () => {} : (p) => assert.equal(mode(p), 0o600, `${p} is ${mode(p).toString(8)}`);

const { renderModelRatchet, addModelRule, loadModelRules, modelRatchetPathFor } = await import('../src/model-rules.js');
const rs = await import('../src/route-scan.js');

// ── rule examples ────────────────────────────────────────────────────────

const base = { status: 'active', scope: 'global', category: 'check', label: '상태 확인', labelEn: 'status checks',
  count: 4, errRate: 0, lastSeen: '2026-11-09', promotedAt: '2026-11-09' };

test('ratchet-model.md masks an example before cutting it, even one stored raw by an older version', () => {
  // the token starts inside the 30-character window; a cut-first order would leave "ghp_a1B2c3D4"
  const raw = `status check ${TOKEN} please`;
  const rules = [{ ...base, tier: 'T2', agent: 't2-explore', rule: 'r', example: raw, exampleEn: raw, budget: { calls: 8, out: 1500 } }];
  for (const lang of ['ko', 'en']) {
    const md = renderModelRatchet(rules, lang, { root: null, grade: 'cost' });
    assert.ok(!md.includes('ghp_'), `${lang}: ${md}`);
    assert.ok(md.includes('[redacted]'), lang);
  }
});

test('the merged T2+T1 line masks examples too', () => {
  const raw = `status check ${TOKEN}`;
  const rules = [
    { ...base, tier: 'T2', agent: 't2-explore', rule: 'r2', example: raw, budget: { calls: 8, out: 1500 } },
    { ...base, tier: 'T1', agent: 'sonnet', rule: 'r1', example: raw, budget: { calls: null, out: 8000 } },
  ];
  assert.ok(!renderModelRatchet(rules, 'ko', { root: null, grade: 'cost' }).includes('ghp_'));
});

test('addModelRule never writes a raw example to model-rules.json', () => {
  addModelRule({ ...base, signature: 'T2|check|p', tier: 'T2', rule: 'r', example: `status ${TOKEN}`, exampleEn: `status ${TOKEN}`, targetRoot: null });
  const file = readFileSync(join(DIR, 'model-rules.json'), 'utf8');
  assert.ok(!file.includes('ghp_'), file);
  assert.ok(file.includes('[redacted]'));
  assert.ok(!JSON.stringify(loadModelRules()).includes(TOKEN));
});

test('route-scan candidates carry a masked example, also when the token sits at the 80th character', async () => {
  rmSync(join(DIR, 'model-rules.json'), { force: true }); // a registered rule would cover the category
  const proj = join(HOME, '.claude', 'projects', '-sandbox-hygiene');
  mkdirSync(proj, { recursive: true });
  const NOW = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const lines = [];
  let seq = 0;
  for (let i = 0; i < 3; i++) {
    const t = NOW - (3 - i) * 3600000;
    // about 70 filler characters, then the token: an 80-character cut would keep ten characters of it
    // (the number keeps the three prompts from merging into one episode)
    const text = `상태 확인해줘 ${i}번째 ${'x'.repeat(60)} ${TOKEN}`;
    lines.push(JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: text } }));
    seq += 1;
    lines.push(JSON.stringify({
      type: 'assistant', timestamp: iso(t + 1000), requestId: `req-${seq}`,
      message: { id: `msg-${seq}`, model: 'claude-opus-5', content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 800 } },
    }));
  }
  writeFileSync(join(proj, 'sess.jsonl'), lines.join('\n') + '\n');
  const cache = await rs.runRouteScan({ days: 14 });
  assert.ok(cache.candidates.length > 0, JSON.stringify({ n: cache.totalEpisodes, easy: cache.easyEpisodes, th: cache.thresholds }));
  for (const c of cache.candidates) {
    assert.ok(!c.example.includes('ghp_'), c.example);
    assert.ok(c.example.length <= 80);
  }
  assert.ok(!readFileSync(rs.routeScanCachePath(), 'utf8').includes('ghp_'), 'the route-scan cache file');
});

test('Codex route candidates mask the example', async () => {
  const { runCodexRouteScan } = await import('../src/codex/route-scan.js');
  const base2 = mkdtempSync(join(tmpdir(), 'sprag-hygiene-codex-'));
  try {
    const home = join(base2, 'codex');
    const dir = join(base2, 'state');
    const root = join(base2, 'project');
    for (const p of [join(home, 'sessions'), dir, join(root, '.git')]) mkdirSync(p, { recursive: true });
    writeFileSync(join(home, 'config.toml'), 'model_provider="current-gateway"\n');
    const now = Date.now();
    const prices = { checkedAt: now, provider: 'current-gateway', prices: {
      'parent-model': { input: 0.00001, output: 0.00003, cacheRead: 0.000001, cacheWrite: null },
      'child-model': { input: 0.000001, output: 0.000003, cacheRead: 0.0000001, cacheWrite: null },
    } };
    // Codex only routes short requests (longer ones read as pasted context), so the point here is that the token is masked at all
    const message = `Find the parser files ${'a'.repeat(20)} ${TOKEN}`;
    const rows = [{ timestamp: new Date(now - 20000).toISOString(), type: 'session_meta', payload: { id: 'parent-session', cwd: root, model_provider: 'current-gateway', source: 'cli' } }];
    for (let i = 0; i < 3; i++) {
      const turn_id = `t-${i}`;
      const at = now - 10000 + i * 1000;
      const push = (type, payload, delta = 0) => rows.push({ timestamp: new Date(at + delta).toISOString(), type, payload });
      push('event_msg', { type: 'task_started', turn_id });
      push('turn_context', { turn_id, model: 'parent-model', cwd: root });
      push('event_msg', { type: 'item_completed', turn_id, item: { type: 'UserMessage', id: `m-${i}`, content: [{ type: 'text', text: message }] } });
      const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500 };
      push('token_usage_record', { turn_id, usage, turn_token_usage: usage }, 100);
      push('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: { input_tokens: 1000 * (i + 1), cached_input_tokens: 200 * (i + 1), output_tokens: 500 * (i + 1) } } }, 100);
      push('event_msg', { type: 'task_complete', turn_id }, 200);
    }
    writeFileSync(join(home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const scan = await runCodexRouteScan({ base: base2, home, dir, root, now, prices, cfg: { codex: { delegateTarget: { model: 'child-model' } } }, refreshLedger: false });
    assert.equal(scan.candidates.length, 1, JSON.stringify(scan.candidates));
    assert.ok(!scan.candidates[0].example.includes('ghp_'), scan.candidates[0].example);
    assert.ok(scan.candidates[0].example.includes('[redacted]'));
  } finally { rmSync(base2, { recursive: true, force: true }); }
});

// ── backups are owner-only ───────────────────────────────────────────────

test('installer writeSettings keeps its .sprag-bak owner-only, content untouched', async () => {
  const { writeSettings } = await import('../src/installer.js');
  const file = join(HOME, '.claude', 'settings.json');
  const original = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: TOKEN } }, null, 2) + '\n';
  writeFileSync(file, original, { mode: 0o644 });
  chmodSync(file, 0o644);
  assert.equal(writeSettings(file, { env: {}, extra: 1 }), null);
  const bak = `${file}.sprag-bak`;
  assert.equal(readFileSync(bak, 'utf8'), original);
  owner(bak);
  // an older, world-readable backup is narrowed on the next write too
  chmodSync(bak, 0o644);
  assert.equal(writeSettings(file, { env: {}, extra: 2 }), null);
  owner(bak);
});

test('compact-window keeps its .bak owner-only', async () => {
  const { setAutoCompactWindow } = await import('../src/compact-window.js');
  const root = mkdtempSync(join(SANDBOX, 'cw-'));
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ model: 'claude-opus-5[1m]', env: { X_TOKEN: TOKEN } }), { mode: 0o644 });
  const r = setAutoCompactWindow({ root, scope: 'project', value: '400k' });
  assert.equal(r.ok, true);
  assert.ok(readFileSync(r.backup, 'utf8').includes(TOKEN), 'a backup is for restoring, so the content stays');
  owner(r.backup);
});

test('harness init / uninit / rm keep their backups owner-only', async () => {
  const h = await import('../src/harness.js');
  const root = mkdtempSync(join(SANDBOX, 'hn-'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'CLAUDE.md'), `# notes\nPASSWORD is ${TOKEN}\n`, { mode: 0o644 });
  const init = h.harnessInit({ root, scope: 'project' });
  assert.ok(init.backedUp.length >= 1, JSON.stringify(init));
  for (const bak of init.backedUp) owner(bak);
  h.harnessPromote('테스트 룰 하나', { root, scope: 'project' });
  h.harnessPromote('테스트 룰 둘', { root, scope: 'project' });
  const rm = h.harnessRmRule(1, { root, scope: 'project' });
  assert.equal(rm.ok, true);
  owner(rm.backup);
  const un = h.harnessUninit({ root, scope: 'project', purgeRatchet: true });
  assert.ok(un.backedUp.length >= 1);
  for (const bak of un.backedUp) owner(bak);
});

// ── doc2md copies ────────────────────────────────────────────────────────

test('doc2md pruneCache removes conversions untouched for 30 days with their meta, keeps younger ones', () => {
  const doc2md = require('../src/doc2md.cjs');
  const cache = doc2md.cacheDir();
  mkdirSync(cache, { recursive: true });
  const DAY = 86400000;
  const make = (name, ageDays, { meta = true } = {}) => {
    const md = join(cache, `${name}.md`);
    writeFileSync(md, 'body');
    if (meta) writeFileSync(join(cache, `${name}.meta.json`), '{}');
    const at = new Date(Date.now() - ageDays * DAY);
    utimesSync(md, at, at);
    if (meta) utimesSync(join(cache, `${name}.meta.json`), at, at);
  };
  make('old.aaaa', 31);
  make('fresh.bbbb', 29);
  writeFileSync(join(cache, 'orphan-meta.cccc.meta.json'), '{}');
  const stale = new Date(Date.now() - 40 * DAY);
  utimesSync(join(cache, 'orphan-meta.cccc.meta.json'), stale, stale);
  const removed = doc2md.pruneCache({ now: Date.now() });
  assert.equal(removed, 1);
  assert.deepEqual(readdirSync(cache).sort(), ['fresh.bbbb.md', 'fresh.bbbb.meta.json']);
  // the injected clock decides, so nothing here depends on the wall clock
  assert.equal(doc2md.pruneCache({ now: Date.now() + 31 * DAY }), 1);
  assert.deepEqual(readdirSync(cache), []);
});

// ── temp files ───────────────────────────────────────────────────────────

test('a failed statusline cache write leaves no temp file; stale ones are swept once a day', async () => {
  const caps = await import('../src/caps-cache.js');
  const target = join(DIR, 'last-caps.json');
  // a directory in the way makes the rename fail
  mkdirSync(target);
  caps.persistSnapshot({ model: 'x' });
  assert.deepEqual(readdirSync(DIR).filter((n) => n.endsWith('.tmp')), [], 'the failed write cleaned up after itself');
  rmSync(target, { recursive: true });

  const old = join(DIR, 'last-caps.json.99999.tmp');
  const young = join(DIR, 'last-caps.json.88888.tmp');
  writeFileSync(old, '{}');
  writeFileSync(young, '{}');
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
  utimesSync(old, twoHoursAgo, twoHoursAgo);
  rmSync(join(DIR, 'housekeeping.json'), { force: true });
  caps.persistSnapshot({ model: 'x' });
  assert.ok(!existsSync(old), 'a temp file over an hour old is removed');
  assert.ok(existsSync(young), 'a young one may belong to a writer in the middle of its rename');

  // the stamp now holds the sweep back for a day
  writeFileSync(old, '{}');
  utimesSync(old, twoHoursAgo, twoHoursAgo);
  caps.persistSnapshot({ model: 'y' });
  assert.ok(existsSync(old), 'swept at most once a day');
});
