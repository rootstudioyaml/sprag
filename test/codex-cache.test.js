import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCodexSessionFile } from '../src/codex-parser.js';
import { codexCacheTimer, codexCachePolicy, parseCodexCacheTtl } from '../src/codex-cache.js';
import { createPanelReader, formatCodexPanel, panelCellWidth } from '../src/codex-panel.js';
import { CODEX_SEGMENT_ORDER } from '../src/codex-panel.js';
import { childEnv } from './helpers/child-env.js';

const now = Date.now();
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const jsonl = (records) => records.map(JSON.stringify).join('\n') + '\n';
const usage = (at, input, cached = 0, written = 0) => ({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: {
  type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: written, output_tokens: 10 },
    last_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: written }, model_context_window: 200000 },
} });
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'sprag-cache-'));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  mkdirSync(join(home, 'sessions'));
  const file = join(home, 'sessions', 'one.jsonl');
  writeFileSync(file, jsonl([
    { type: 'session_meta', payload: { id: 'one', cwd: home, model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'xhigh' } },
    usage(now, 20000, 18000, 2000),
  ]));
  const env = childEnv({ HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, 'cfg') });
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, '--agent', 'codex'], { env, cwd: home, encoding: 'utf8', timeout: 10000 });
  return { home, file, run, env };
}

test('cache clock ticks without log changes and refreshes only on new cached usage', async (t) => {
  const f = fixture(t);
  const read = createPanelReader({ home: f.home, root: f.home, sessionId: 'one' });
  let s = (await read()).session;
  assert.equal(s.cacheActivity.at.getTime(), now);
  assert.equal(codexCacheTimer(s, { now: now + 1000 }).remaining, 1799);
  assert.equal(codexCacheTimer((await read()).session, { now: now + 61000 }).remaining, 1739);
  appendFileSync(f.file, jsonl([
    usage(now + 62000, 20000, 18000, 2000),
    { timestamp: new Date(now + 63000).toISOString(), type: 'response_item', payload: { type: 'function_call_output' } },
    { timestamp: new Date(now + 64000).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 50 } } } },
  ]));
  s = (await read()).session;
  assert.equal(s.lastActivity.getTime(), now + 64000);
  assert.equal(s.cacheActivity.at.getTime(), now, 'tools and quota snapshots never refresh a cache clock');
  appendFileSync(f.file, jsonl([usage(now + 65000, 40000, 36000, 4000)]));
  s = (await read()).session;
  assert.equal(codexCacheTimer(s, { now: now + 66000 }).remaining, 1799);
  appendFileSync(f.file, jsonl([usage(now + 67000, 60000, 36000, 4000)]));
  assert.equal((await read()).session.cacheActivity.at.getTime(), now + 65000, 'uncached input does not prove a new cache write');
});

test('cache writes and resets are observed, while model changes invalidate the old clock', async (t) => {
  const f = fixture(t);
  appendFileSync(f.file, jsonl([usage(now + 1000, 40000, 18000, 22000)]));
  let s = await parseCodexSessionFile(f.file, { cutoffMs: now + 10000 });
  assert.equal(s.cacheActivity.at.getTime(), now + 1000, 'display clock is independent of report window');
  appendFileSync(f.file, jsonl([{ type: 'turn_context', payload: { model: 'gpt-5.4' } }]));
  s = await parseCodexSessionFile(f.file);
  assert.equal(codexCacheTimer(s, { now: now + 2000 }).source, 'unavailable');
  appendFileSync(f.file, jsonl([usage(now + 3000, 10000, 5000)]));
  s = await parseCodexSessionFile(f.file);
  assert.equal(s.cacheActivity.at.getTime(), now + 3000);
  assert.equal(codexCacheTimer(s, { now: now + 4000 }).source, 'age');
});

test('policy estimates never claim an exact expiry or silently reuse Claude TTL buckets', async (t) => {
  const f = fixture(t);
  const s = await parseCodexSessionFile(f.file);
  assert.equal(codexCachePolicy('gpt-6-astra'), 1800);
  assert.equal(codexCachePolicy('gpt-5.6'), 1800);
  for (const model of ['gpt-5.4', 'gpt-5.5', 'claude-opus-5', 'provider/gpt-6-astra', 'unknown']) assert.equal(codexCachePolicy(model), null);
  assert.equal(codexCacheTimer(s, { now: now + 1000 }).text, 'Cache 29:59 (OpenAI 30m)');
  const gateway = { ...s, provider: 'litellm', cacheActivity: { ...s.cacheActivity, provider: 'litellm' } };
  assert.match(codexCacheTimer(gateway, { now }).text, /TTL unknown/);
  assert.doesNotMatch(codexCacheTimer(gateway, { now }).text, /~/);
  assert.match(codexCacheTimer(s, { now: now + 1800000 }).text, /window elapsed.*expiry unknown/);
  assert.doesNotMatch(codexCacheTimer(s, { now: now + 1800000 }).text, /EXPIRED/);
  assert.equal(codexCacheTimer(s, { now: now - 1000 }).source, 'unavailable');
  assert.equal(codexCacheTimer(s, { now, ttl: 'off' }), null);
  assert.equal(codexCacheTimer(s, { now, ttl: 300 }).remaining, 300);
  assert.match(codexCacheTimer(s, { now, ttl: 300 }).text, /configured estimate/);
  assert.equal(parseCodexCacheTtl('30m'), 1800);
  assert.equal(parseCodexCacheTtl('24h'), 86400);
  for (const value of ['0m', '25h', '30', 'NaN', '1.5h']) assert.throws(() => parseCodexCacheTtl(value), /expects/);
});

test('different sessions keep independent cache clocks', async (t) => {
  const f = fixture(t);
  const two = join(f.home, 'sessions', 'two.jsonl');
  const records = readFileSync(f.file, 'utf8').trim().split('\n').map(JSON.parse);
  records[0].payload.id = 'two';
  writeFileSync(two, jsonl([...records, usage(now + 60000, 40000, 38000)]));
  const a = await createPanelReader({ home: f.home, sessionId: 'one' })();
  const b = await createPanelReader({ home: f.home, sessionId: 'two' })();
  assert.equal(codexCacheTimer(a.session, { now: now + 61000 }).remaining, 1739);
  assert.equal(codexCacheTimer(b.session, { now: now + 61000 }).remaining, 1799);
});

test('full and compact output keep session metrics ahead of Codex lifetime documents and preferences', async (t) => {
  const f = fixture(t);
  const data = await createPanelReader({ home: f.home, sessionId: 'one' })();
  data.error = 'test error';
  data.documents = { scope: 'codex-total', docs: 4, byExt: [{ ext: 'pdf', docs: 4 }] };
  data.budget = { spend: 95, maxBudget: 100, checkedAt: now };
  data.session.rateLimits = { primary: { used_percent: 40, window_minutes: 300 } };
  data.session.rateLimitsAt = new Date(now);
  assert.ok(CODEX_SEGMENT_ORDER.indexOf('usage') < CODEX_SEGMENT_ORDER.indexOf('ctx'));
  for (const compact of [true, false]) {
    const text = formatCodexPanel(data, { compact, columns: 500, rows: 100, now: now + 1000, color: false });
    const names = ['ERROR:', 'WARNING:', '95%', '5H', 'Ctx ', 'Cache 29:59', 'gpt-6-astra', 'xhigh', 'Cache hit', 'Cache reused', 'Doc2md 4', 'Harness', 'Korean', 'Routing saved n/a', 'SPRAG v'];
    const output = formatCodexPanel(data, { compact, columns: 500, rows: 100, now: now + 1000, color: false, version: 'test' });
    const indices = names.map((name) => output.indexOf(name));
    assert.ok(indices.every((index) => index >= 0), output);
    assert.deepEqual(indices, indices.slice().sort((a, b) => a - b), output);
    assert.doesNotMatch(text, /Routing saved \$|Cache expires|EXPIRED|Cache ~/);
  }
  for (const mode of ['icon', 'narrow', 'text']) {
    for (const columns of [1, 20, 80, 180]) {
      const text = formatCodexPanel({ ...data, labelMode: mode }, { compact: true, columns, rows: 1000, color: false, now });
      assert.ok(text.split('\n').every((line) => panelCellWidth(line) <= columns));
    }
  }
  const short = formatCodexPanel(data, { compact: true, columns: 80, rows: 2, color: false, now });
  assert.match(short, /^ERROR:/);
  assert.doesNotMatch(short, /Doc2md 4|Harness/);
});

test('Codex cache CLI persists its own estimate and honors shared timer toggles', (t) => {
  const f = fixture(t);
  const ok = (args) => {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  ok(['mode', 'ttl=1h']);
  assert.match(ok(['--statusline', '--text', '--single-line']), /Cache (29:\d{2}|30:00)/);
  ok(['cache', '5m']);
  assert.match(ok(['cache', 'status']), /5m \(configured estimate\)/);
  assert.match(ok(['--statusline', '--text', '--single-line']), /Cache (4:\d{2}|5:00).*configured estimate/);
  assert.doesNotMatch(ok(['--statusline', '--text', '--single-line', '--no-timer']), /Cache \d|Cache timer/);
  ok(['mode', 'no-timer']);
  assert.doesNotMatch(ok(['--statusline', '--text', '--single-line']), /Cache \d/);
  assert.match(ok(['--statusline', '--text', '--single-line', '--timer']), /Cache \d/);
  ok(['cache', 'off']);
  assert.doesNotMatch(ok(['--statusline', '--text', '--single-line', '--timer']), /Cache \d/);
  ok(['cache', 'auto']);
  assert.match(ok(['mode']), /"ttlBucket":"1h"/);
  assert.notEqual(f.run(['cache', '999h']).status, 0);
});

test('full panel preserves individual warning colors when chips share a row', async (t) => {
  const f = fixture(t);
  const data = await createPanelReader({ home: f.home, sessionId: 'one' })();
  data.budget = { spend: 20, maxBudget: 100, checkedAt: now };
  data.session.lastContextTokens = 190000;
  const text = formatCodexPanel(data, { columns: 500, rows: 100, color: true, now: Date.now() });
  assert.match(text, /\x1b\[32mBudget/);
  assert.match(text, /\x1b\[31mCtx/);
  assert.match(text, /\x1b\[32mCache \d/);
});

test('Codex diagnostics distinguish guidance from Routing saved and ignore Claude money', (t) => {
  const f = fixture(t);
  const configDir = join(f.home, 'cfg', 'claude-token-saver');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'delegation-ledger.json'), JSON.stringify({ version: 2, events: { run: { ts: now, usd: 999, from: 'opus', to: 'haiku' } } }));
  const enabled = f.run(['delegate', 'on']);
  assert.equal(enabled.status, 0);
  assert.match(enabled.stdout, /model routing and guidance/);
  assert.match(enabled.stdout, /Routing saved: n\/a \(no attributed runs yet\)/);
  const text = f.run(['--statusline', '--text', '--single-line']).stdout;
  assert.match(text, /Delegate on \(model routing\)/);
  assert.match(text, /Routing saved n\/a \(no attributed runs\)/);
  assert.doesNotMatch(text, /999|opus|haiku/);
  assert.match(f.run(['capabilities']).stdout, /routing-saved: partial/);
  const report = JSON.parse(f.run(['doctor', '--format', 'json']).stdout);
  assert.equal(report.capabilities.find((row) => row.feature === 'routing-saved').support, 'partial');
});
