/**
 * Cowork usage: transcript discovery at the fixed depth under the desktop
 * app's session folders, the separate parse cache, and how aggregateDaily
 * folds Cowork spend and per-request Codex pricing into the daily row.
 * HOME and XDG_CONFIG_HOME point at a temp dir, so nothing reads real data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCoworkSessionFiles, parseCoworkSessions } from '../src/cowork-sessions.js';
import { coworkSessionRoots } from '../src/cowork-sync.js';
import { aggregateDaily } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-cowork-'));
  const saved = {};
  for (const k of ['HOME', 'APPDATA', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) saved[k] = process.env[k];
  process.env.XDG_CONFIG_HOME = root;
  process.env.HOME = root;
  process.env.APPDATA = root;
  process.env.CODEX_HOME = join(root, '.codex');
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) delete process.env[k];
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

const DAY = 24 * 3600 * 1000;

/** A one-request Claude transcript line. */
const line = (id, ts) => JSON.stringify({
  type: 'assistant', sessionId: 's-' + id, timestamp: new Date(ts).toISOString(), requestId: 'r-' + id,
  message: { id: 'm-' + id, model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 10 } },
}) + '\n';

/** <root>/<org>/<account>/<session>/.claude/projects/session, returned with the root. */
function coworkTree(base) {
  const root = join(base, 'local-agent-mode-sessions');
  const sessionDir = join(root, 'org1', 'acct1', 'local_abc');
  const project = join(sessionDir, '.claude', 'projects', 'session');
  mkdirSync(project, { recursive: true });
  return { root, sessionDir, project };
}

test('discoverCoworkSessionFiles: exact depth only, subagents attached, mtime cutoff respected', async (t) => {
  const { root: home } = isolate(t);
  const { root, sessionDir, project } = coworkTree(home);
  const now = Date.now();
  const main = join(project, 'aaaa.jsonl');
  writeFileSync(main, line('a', now));
  mkdirSync(join(project, 'aaaa', 'subagents'), { recursive: true });
  writeFileSync(join(project, 'aaaa', 'subagents', 'agent-1.jsonl'), line('sub', now));
  writeFileSync(join(project, 'aaaa', 'subagents', 'notes.jsonl'), 'x\n'); // not an agent-* file
  const oldFile = join(project, 'old.jsonl');
  writeFileSync(oldFile, line('old', now));
  const longAgo = new Date(now - 40 * DAY);
  utimesSync(oldFile, longAgo, longAgo);
  // decoys: right extension, wrong place
  writeFileSync(join(sessionDir, 'audit.jsonl'), line('audit', now));
  mkdirSync(join(sessionDir, 'uploads'), { recursive: true });
  writeFileSync(join(sessionDir, 'uploads', 'x.jsonl'), line('up', now));
  mkdirSync(join(project, 'deeper', 'more'), { recursive: true });
  writeFileSync(join(project, 'deeper', 'more', 'y.jsonl'), line('deep', now));
  writeFileSync(join(project, 'readme.txt'), 'x');

  const files = await discoverCoworkSessionFiles({ days: 30, roots: [root], now });
  assert.deepEqual(files.map((f) => f.path), [main]);
  assert.equal(files[0].projectDir, 'cowork');
  assert.equal(typeof files[0].mtime, 'number');
  assert.ok(files[0].size > 0);
  assert.deepEqual(files[0].subagentFiles.map((f) => f.path), [join(project, 'aaaa', 'subagents', 'agent-1.jsonl')]);

  const wide = await discoverCoworkSessionFiles({ days: 60, roots: [root], now });
  assert.deepEqual(wide.map((f) => f.path).sort(), [oldFile, main].sort());
  assert.deepEqual(await discoverCoworkSessionFiles({ days: 30, roots: [join(home, 'missing')], now }), []);
});

test('parseCoworkSessions marks surface cowork and uses its own cache file', async (t) => {
  const { root: home, dir } = isolate(t);
  const { root, project } = coworkTree(home);
  const transcript = join(project, 'bbbb.jsonl');
  writeFileSync(transcript, line('b', Date.now()));
  const sessions = await parseCoworkSessions({ days: 30, roots: [root] });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].surface, 'cowork');
  assert.equal(sessions[0].requestCount, 1);
  const cacheFile = join(dir, 'cowork-session-cache.json');
  assert.ok(existsSync(cacheFile));
  // The entry is keyed by the transcript path; the main cache path is fixed at import time, so it cannot be checked here.
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')).entries), [transcript]);
});

test('cowork-sync still re-exports coworkSessionRoots', () => {
  assert.equal(typeof coworkSessionRoots, 'function');
});

// ── aggregateDaily ────────────────────────────────────────────────────────

const D1 = new Date(2026, 9, 10, 9, 0).getTime();
const NOW = new Date(2026, 9, 15, 12).getTime();
const claudeSession = (start, input) => ({
  startTime: new Date(start), endTime: new Date(start), model: 'claude-sonnet-4-5',
  totals: { input, output: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0 },
});

test('aggregateDaily: Cowork spend lands in spent_usd and claude_spent_usd without new row keys', async (t) => {
  const { dir } = isolate(t);
  const base = { now: NOW, dir, days: 30, codexSessions: [] };
  const [without] = await aggregateDaily({ ...base, sessions: [claudeSession(D1, 1_000_000)], coworkSessions: [] });
  const [withCowork] = await aggregateDaily({
    ...base, sessions: [claudeSession(D1, 1_000_000)], coworkSessions: [{ ...claudeSession(D1, 1_000_000), surface: 'cowork' }],
  });
  assert.ok(without.spent_usd > 0);
  assert.equal(withCowork.spent_usd, Math.round(without.spent_usd * 2 * 10000) / 10000);
  assert.equal(withCowork.claude_spent_usd, withCowork.spent_usd);
  assert.deepEqual(Object.keys(withCowork), Object.keys(without));
  // Cowork alone still produces the row
  const [only] = await aggregateDaily({ ...base, sessions: [], coworkSessions: [claudeSession(D1, 1_000_000)] });
  assert.equal(only.spent_usd, without.spent_usd);
});

const TIERED = {
  input: 1e-5, output: 5e-5, cacheRead: 1e-6, cacheWrite: 1.25e-5, cacheWrite1h: null,
  tiers: [{ threshold: 272000, input: 2e-5, output: 7.5e-5, cacheRead: 2e-6, cacheWrite: 2.5e-5, cacheWrite1h: null }],
};
const prices = { provider: 'gw', checkedAt: NOW, prices: { 'gpt-6-sol': TIERED } };
const codexWith = (requests, extra = {}) => ({
  startTime: new Date(D1), model: 'gpt-6-sol', provider: 'gw', isSubagent: false,
  totals: { input: 1, cacheRead: 0, cacheCreation: 0, output: 0 }, requests, ...extra,
});

test('aggregateDaily: Codex requests are priced one by one with the long-context tier', async (t) => {
  const { dir } = isolate(t);
  const req = { ts: D1, model: 'gpt-6-sol', input: 475594, cached: 475220, cacheWrite: 372, output: 342 };
  const [row] = await aggregateDaily({
    now: NOW, dir, days: 30, sessions: [], coworkSessions: [], codexSessions: [codexWith([req])], codexPrices: prices,
  });
  assert.equal(row.codex_spent_usd, 0.9854);
  assert.equal(row.unpriced_parts, 0);
  assert.equal(row.model_spend['gpt-6-sol'], 0.9854);
});

test('aggregateDaily: a model with an unpriced request adds one unpriced part and no spend', async (t) => {
  const { dir } = isolate(t);
  const ok = { ts: D1, model: 'gpt-6-sol', input: 1000, cached: 0, cacheWrite: 0, output: 0 };
  const bad = { ts: D1, model: 'gpt-6-nope', input: 1000, cached: 0, cacheWrite: 0, output: 0 };
  const bad2 = { ts: D1 + 1, model: 'gpt-6-nope', input: 2000, cached: 0, cacheWrite: 0, output: 0 };
  const [row] = await aggregateDaily({
    now: NOW, dir, days: 30, sessions: [], coworkSessions: [], codexSessions: [codexWith([ok, bad, bad2])], codexPrices: prices,
  });
  assert.equal(row.codex_spent_usd, 0.01); // only the priced model: 1000 * 1e-5
  assert.equal(row.unpriced_parts, 1);
  assert.deepEqual(Object.keys(row.model_spend), ['gpt-6-sol']);
});
