import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPanelReader, formatCodexPanel, runCodexPanel, terminalText, panelCellWidth } from '../src/codex-panel.js';
import { parseCodexSessionFile } from '../src/codex-parser.js';
import { childEnv } from './helpers/child-env.js';

const now = Date.parse('2026-09-26T05:00:00Z');
function sample() {
  return {
    root: '/project', days: 7, matches: 2, updatedAt: new Date(now),
    harness: { global: { configured: 5, total: 5 } }, rules: { global: 2, project: 1 },
    korean: true, lint: 'block', doc2md: true,
    session: { sessionId: 'session-1', projectDir: '/project', model: 'test-model', effort: 'high',
      lastActivity: new Date(now - 1000), rateLimitsAt: new Date(now - 1000),
      contextWindow: 200000, lastContextTokens: 100000, maxContextPerRequest: 150000,
      totals: { input: 10000, cacheRead: 90000, output: 1000 }, reasoningOutputTokens: 200,
      requestCount: 20, rateLimits: { primary: { used_percent: 95, window_minutes: 300, resets_at: now / 1000 + 600 } } },
  };
}
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'sprag-panel-'));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  mkdirSync(join(home, 'sessions'));
  return home;
}
const usage = (input, ts = new Date().toISOString()) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 10 },
  last_token_usage: { input_tokens: input }, model_context_window: 200000,
} } });
const jsonl = (objects) => objects.map(JSON.stringify).join('\n') + '\n';

test('panel shows current context, cache, limits, harness, and unavailable fields', () => {
  const output = formatCodexPanel(sample(), { color: false, now });
  assert.match(output, /Ctx \[######\.\.\.\.\.\.\] 50.0%/);
  assert.match(output, /Cache hit 90.0%/);
  assert.match(output, /5H .*95.0% used/);
  assert.match(output, /Harness 5\/5/);
  assert.match(output, /Cost n\/a \(session\) \| Cache expiry not reported/);
  assert.doesNotMatch(output, /\x1b/);
});

test('compact footer wraps chips within cell bounds and exposes hidden rows', () => {
  for (const columns of [20, 80, 180]) {
    const text = formatCodexPanel(sample(), { compact: true, columns, rows: 5, color: false, now });
    assert.ok(text.split('\n').length <= 5);
    assert.ok(text.split('\n').every((line) => panelCellWidth(line) <= columns));
  }
  const text = formatCodexPanel(sample(), { compact: true, columns: 180, rows: 5, color: false, now });
  assert.match(text, /Cache hit 90.0%/);
  assert.match(text, /5H .*95.0% used/);
  assert.match(text, /Harness 5\/5/);
  assert.match(text, /🤖 test-model/);
  assert.match(text, /▰/);
  assert.match(text, /Cache reused 90.0k tokens/);
  assert.match(text, /Routing saved n\/a \(prices unavailable\)/);
  assert.doesNotMatch(text, /Cost n\/a|EXPIRED|Limits: not reported/);
  assert.match(formatCodexPanel(sample(), { compact: true, columns: 40, rows: 5, color: false, now }), /more rows/);
});

test('compact panel shares glyph modes and reports documents without Claude dollar estimates', () => {
  const data = sample();
  data.documents = { scope: 'codex-total', docs: 13, total: 21.9, byExt: [{ ext: 'xlsx', docs: 7, usd: 16.5 }, { ext: 'pptx', docs: 6, usd: 5.4 }] };
  for (const labelMode of ['icon', 'narrow', 'text']) {
    const text = formatCodexPanel({ ...data, labelMode }, { compact: true, columns: 180, rows: 20, color: false, now });
    assert.match(text, /Doc2md 13 docs \(Codex total\).*xlsx 7x.*pptx 6x/);
    assert.doesNotMatch(text, /\$|\x1b/);
    assert.equal(text.includes('🤖'), labelMode === 'icon');
    assert.equal(text.includes('◈'), labelMode === 'narrow');
  }
  assert.doesNotMatch(formatCodexPanel({ ...data, documents: { docs: 13, total: 21.9 } }, { color: false }), /13 docs|21.9/);
});

test('compact output sanitizes injected controls and marks expired limits', () => {
  assert.equal(panelCellWidth('✍️'), 2);
  assert.equal(panelCellWidth('🤖'), 2);
  assert.equal(panelCellWidth('◈'), 1);
  const data = sample();
  data.session.model = '\x1b[2Jbad\nmodel';
  data.session.rateLimits.primary.resets_at = now / 1000 - 1;
  for (const columns of [1, 20, 80, 180]) {
    const text = formatCodexPanel(data, { compact: true, columns, rows: 100, color: false, now });
    assert.ok(text.split('\n').every((line) => panelCellWidth(line) <= columns));
    assert.doesNotMatch(text, /[\x00-\x09\x0b-\x1f\x7f]/);
  }
  assert.match(formatCodexPanel(data, { compact: true, columns: 180, rows: 20, color: false, now }), /awaiting new usage/);
});

test('panel frames fit narrow and short terminals without control injection', () => {
  const data = sample();
  data.session.model = '\x1b[2Jbad\x1b]0;title\x07\n\r모델';
  for (const columns of [1, 20, 40, 80, 120]) {
    for (const rows of [1, 8, 24, 40]) {
      const text = formatCodexPanel(data, { columns, rows, color: false, now });
      assert.ok(text.split('\n').length <= rows);
      assert.ok(text.split('\n').every((l) => l.length <= columns));
      assert.doesNotMatch(text, /[\x00-\x09\x0b-\x1f\x7f]/);
    }
  }
  assert.equal(terminalText('\x1b[2Jok'), 'ok');
});

test('stale and expired limit snapshots are not presented as live remaining quota', () => {
  const data = sample();
  data.session.lastActivity = new Date(now - 600000);
  data.session.rateLimits.primary.resets_at = now / 1000 - 1;
  const text = formatCodexPanel(data, { color: false, now });
  assert.match(text, /LOG STALE/);
  assert.match(text, /awaiting new usage/);
  assert.match(formatCodexPanel({ root: '/empty', days: 7 }, { color: false, now }), /WAITING/);
});

test('duplicate usage events still refresh current context and rate-limit snapshots', async (t) => {
  const home = fixture(t);
  const path = join(home, 'sessions', 'a.jsonl');
  const first = usage(100);
  const second = usage(100);
  second.payload.info.last_token_usage.input_tokens = 20;
  second.payload.rate_limits = { primary: { used_percent: 70, window_minutes: 300 } };
  writeFileSync(path, jsonl([first, second]));
  const parsed = await parseCodexSessionFile(path);
  assert.equal(parsed.requestCount, 1);
  assert.equal(parsed.lastContextTokens, 20);
  assert.equal(parsed.maxContextPerRequest, 100);
  assert.equal(parsed.rateLimits.primary.used_percent, 70);
});

test('reader isolates projects, pins sessions, and invalidates changed log cache', async (t) => {
  const home = fixture(t);
  const path = join(home, 'sessions', 'one.jsonl');
  const meta = { type: 'session_meta', payload: { id: 'one', cwd: '/project' } };
  writeFileSync(path, jsonl([meta, usage(100)]));
  writeFileSync(join(home, 'sessions', 'two.jsonl'), jsonl([
    { type: 'session_meta', payload: { id: 'two', cwd: '/project-other' } }, usage(500),
  ]));
  const read = createPanelReader({ home, root: '/project' });
  assert.equal((await read()).session.sessionId, 'one');
  assert.equal((await read()).matches, 1);
  appendFileSync(path, jsonl([usage(200)]));
  assert.equal((await read()).session.totals.input, 200);
  assert.equal((await createPanelReader({ home, root: '/project', sessionId: 'two' })()).session.sessionId, 'two');
  assert.equal((await createPanelReader({ home, root: '/absent' })()).session, null);
});

function streams() {
  const input = new EventEmitter();
  input.isTTY = true; input.isRaw = false;
  input.isPaused = () => true;
  input.setRawMode = (value) => { input.isRaw = value; };
  input.resume = () => {}; input.pause = () => {};
  const output = new EventEmitter();
  output.isTTY = true; output.columns = 80; output.rows = 24;
  output.text = '';
  output.write = (s) => { output.text += s; };
  return { input, output };
}

test('live panel restores raw mode, cursor, screen, and listeners on quit', async () => {
  const io = streams();
  io.input.isPaused = () => false;
  let didPause = false;
  io.input.pause = () => { didPause = true; };
  const before = process.listenerCount('SIGINT');
  let reads = 0;
  await runCodexPanel({ ...io, color: false, read: async () => {
    reads++;
    setImmediate(() => io.input.emit('data', Buffer.from('q')));
    return sample();
  } });
  assert.equal(reads, 1);
  assert.equal(didPause, true);
  assert.equal(io.input.isRaw, false);
  assert.match(io.output.text, /\x1b\[\?1049h/);
  assert.ok(io.output.text.endsWith('\x1b[0m\x1b[?25h\x1b[?1049l'));
  assert.equal(io.input.listenerCount('data'), 0);
  assert.equal(io.output.listenerCount('resize'), 0);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('reader failures remain visible and recover on next refresh', async () => {
  const io = streams();
  let reads = 0;
  await runCodexPanel({ ...io, interval: 500, read: async () => {
    reads++;
    if (reads === 1) throw new Error('temporary read error');
    setImmediate(() => io.input.emit('data', Buffer.from('q')));
    return sample();
  } });
  assert.equal(reads, 2);
  assert.match(io.output.text, /temporary read error/);
  assert.match(io.output.text, /test-model/);
});

test('unchanged compact frames produce no terminal output while health callbacks continue', async () => {
  const io = streams(), writes = [];
  io.output.write = (text) => { writes.push(text); };
  let frames = 0;
  await runCodexPanel({ ...io, interval: 500, compact: true, color: false, read: async () => ({ root: '/probe' }),
    onFrame: () => {
      if (++frames === 2) setImmediate(() => io.input.emit('data', Buffer.from('q')));
    } });
  assert.equal(frames, 2);
  assert.equal(writes.length, 3, 'enter screen, initial frame, leave screen');
  assert.ok(writes[1].includes('SPRAG'));
  assert.doesNotMatch(writes[1], /[\r\n]/, 'live rows use cursor addressing, not scrolling newlines');
});

test('panel updates changed rows without clearing the screen and removes obsolete rows', async () => {
  const io = streams(), frames = [];
  io.output.columns = 60;
  io.output.rows = 30;
  let current = '';
  io.output.write = (text) => { current += text; };
  let reads = 0;
  await runCodexPanel({ ...io, interval: 500, compact: true, color: false,
    read: async () => ({ root: '/probe', ...(++reads === 1 ? { error: 'first problem '.repeat(10) } : {}) }),
    onFrame: () => {
      frames.push(current); current = '';
      if (frames.length === 2) setImmediate(() => io.input.emit('data', Buffer.from('q')));
    } });
  assert.match(frames[0], /first problem/);
  assert.doesNotMatch(frames[1], /\x1b\[(?:2)?J|[\r\n]/);
  assert.match(frames[1], /\x1b\[\d+;1H\x1b\[K/, 'removed rows are explicitly cleared');
});

test('terminal resize repaints the bounded panel even when its data is unchanged', async () => {
  const io = streams(), frames = [];
  let current = '';
  io.output.write = (text) => { current += text; };
  await runCodexPanel({ ...io, interval: 500, compact: true, color: false, read: async () => ({ root: '/probe' }),
    onFrame: () => {
      frames.push(current); current = '';
      if (frames.length === 1) setImmediate(() => {
        io.output.columns = 40;
        io.output.rows = 8;
        io.output.emit('resize');
      });
      else setImmediate(() => io.input.emit('data', Buffer.from('q')));
    } });
  assert.equal(frames.length, 2);
  assert.match(frames[1], /\x1b\[2J/);
  const rowTargets = [...frames[1].matchAll(/\x1b\[(\d+);1H/g)].map((match) => Number(match[1]));
  assert.ok(rowTargets.every((row) => row <= 7));
});

test('installed CLI surface supports one-shot output and rejects unattended live loops', (t) => {
  const home = fixture(t);
  const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  const run = (args) => spawnSync(process.execPath, [CLI, 'panel', '--agent', 'codex', ...args], {
    env: childEnv({ HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, 'cfg') }),
    encoding: 'utf8', timeout: 5000,
  });
  const once = run(['--once', '--no-color']);
  assert.equal(once.status, 0, once.stderr);
  assert.match(once.stdout, /SPRAG \/ CODEX/);
  assert.doesNotMatch(once.stdout, /\x1b/);
  assert.notEqual(run([]).status, 0);
  for (const interval of ['bad', '2junk', '-1', '0', '100']) assert.notEqual(run(['--once', '--interval', interval]).status, 0);
});
