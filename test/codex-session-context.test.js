import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexHookOutput, fitCodexContext, estimateCodexTokens, isCodexExecSession, CODEX_CONTEXT_TOKEN_BUDGET } from '../src/codex-hooks.js';
import { recordCodexHistoryEvent, readCodexHistory } from '../src/codex-brief.js';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-codex-context-'));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CODEX_HOME: process.env.CODEX_HOME, CTS_NO_ROUTE_SCAN: process.env.CTS_NO_ROUTE_SCAN };
  process.env.XDG_CONFIG_HOME = join(dir, 'config');
  process.env.CODEX_HOME = join(dir, 'codex');
  process.env.CTS_NO_ROUTE_SCAN = '1';
  mkdirSync(join(dir, 'codex'), { recursive: true });
  mkdirSync(join(dir, 'project', '.git'), { recursive: true });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rollout(dir, meta) {
  const file = join(dir, 'rollout.jsonl');
  writeFileSync(file, JSON.stringify({ timestamp: '2026-10-01T00:00:00.000Z', type: 'session_meta', payload: meta }) + '\n');
  return file;
}

test('the token estimate stays at or above the measured Codex count', () => {
  // Measured on Codex 0.159.2: 4,110 ASCII + 4,632 other characters counted as 4,500 tokens.
  const sample = 'a'.repeat(4110) + '가'.repeat(4632);
  assert.ok(estimateCodexTokens(sample) >= 4500);
  assert.ok(estimateCodexTokens(sample) < 5200);
});

test('parts fit whole by priority; the overflow moves to a file named first', (t) => {
  const dir = sandbox(t);
  const file = join(dir, 'overflow.md');
  const big = '가'.repeat(2000);
  const text = fitCodexContext([
    { priority: 1, spill: true, text: 'RULES' },
    { priority: 2, spill: true, text: `STYLE ${big}` },
    { priority: 5, text: 'NOTICE' },
    { priority: 6, text: `OFFER ${big}` },
  ], { budget: 200, overflowFile: file });
  const lines = text.split('\n\n');
  assert.match(lines[0], /exceed Codex's hook context limit/);
  assert.ok(lines[0].includes(JSON.stringify(file)), lines[0]);
  assert.deepEqual(lines.slice(1), ['RULES', 'NOTICE']);
  assert.equal(readFileSync(file, 'utf8'), `STYLE ${big}\n`);
  assert.ok(estimateCodexTokens(text) <= 200);
});

test('the pointer quotes the overflow path as JSON, so a Windows path round-trips', () => {
  // The same quoting as the doc2md deny reason. Backslashes are escaped, so a
  // reader must parse the quoted string rather than compare it to the raw path.
  const file = 'D:\\a\\sprag\\data\\codex-context\\overflow.md';
  let written;
  const text = fitCodexContext([{ priority: 1, spill: true, text: `STYLE ${'가'.repeat(2000)}` }],
    { budget: 200, overflowFile: file, write: (target) => { written = target; } });
  assert.equal(written, file);
  assert.equal(text.includes(file), false);
  const quoted = /Read ("(?:[^"\\]|\\.)+") before starting work/.exec(text);
  assert.equal(JSON.parse(quoted[1]), file);
});

test('everything under budget is kept in order without a pointer', () => {
  const text = fitCodexContext([{ priority: 3, text: 'B' }, { priority: 1, text: 'A' }, { priority: 2, text: null }],
    { overflowFile: '/unused', write: () => { throw new Error('no spill expected'); } });
  assert.equal(text, 'B\n\nA');
});

test('exec sessions are recognized from the rollout, not the hook source', (t) => {
  const dir = sandbox(t);
  assert.equal(isCodexExecSession(rollout(dir, { id: 'x', originator: 'codex_exec', source: 'exec' })), true);
  assert.equal(isCodexExecSession(rollout(dir, { id: 'x', originator: 'codex_cli_rs', source: 'cli' })), false);
  assert.equal(isCodexExecSession(join(dir, 'missing.jsonl')), false);
  assert.equal(isCodexExecSession(undefined), false);
});

test('session start with the Korean guide stays within budget and skips offers under exec', async (t) => {
  const dir = sandbox(t);
  const cwd = join(dir, 'project');
  const cfg = { koreanStyle: { enabled: true } };
  const interactive = await codexHookOutput('session-start',
    { cwd, source: 'startup', transcript_path: rollout(dir, { id: 's1', originator: 'codex_cli_rs', source: 'cli' }) }, { cfg });
  const context = interactive.hookSpecificOutput.additionalContext;
  assert.ok(estimateCodexTokens(context) <= CODEX_CONTEXT_TOKEN_BUDGET);
  const pointer = /Read ("(?:[^"\\]|\\.)+") before starting work/.exec(context);
  assert.ok(pointer, 'the Korean guide exceeds the budget, so it must be pointed to');
  assert.match(readFileSync(JSON.parse(pointer[1]), 'utf8'), /\[sprag korean-style\]/);
  assert.match(context, /\[Sprag seed\]/);

  const exec = await codexHookOutput('session-start',
    { cwd, source: 'startup', transcript_path: rollout(dir, { id: 's2', originator: 'codex_exec', source: 'exec' }) }, { cfg });
  assert.doesNotMatch(exec?.hookSpecificOutput?.additionalContext ?? '', /\[Sprag seed\]|\[Sprag route-scan\]/);
});

test('a Codex handoff shows up in Codex history', (t) => {
  const dir = sandbox(t);
  const dataDir = join(dir, 'data');
  const now = Date.parse('2026-10-01T01:00:00Z');
  assert.equal(recordCodexHistoryEvent({ sessionId: 's1', project: '/p', key: 'handoff', message: 'Handoff written: /p/HANDOFF.md', now, dir: dataDir }), true);
  const events = readCodexHistory({ dir: dataDir, now: now + 1000 });
  assert.equal(events.length, 1);
  assert.equal(events[0].key, 'handoff');
  assert.equal(events[0].sessionId, 's1');
});
