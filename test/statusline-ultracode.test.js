/**
 * Ultracode — the session toggle the statusline payload cannot name.
 *
 * Since Claude Code 2.1.302 ultracode is independent of the effort level, and
 * the payload carries only `effort.level`. src/ultracode.js recovers the toggle
 * from the transcript: the ultra_effort_enter / ultra_effort_exit attachments and
 * the toggle command's own output.
 *
 * What is worth pinning is everything that would fail quietly. The newest of
 * the signals has to win, or the chip reports a state the user left turns ago.
 * A transcript line that merely quotes a marker (tool output — a session that
 * greps for these strings has plenty) must not count, neither must a subagent's
 * own reminder, and a plain level change must leave the state alone. The chip
 * only ever renders what the entry point hands the formatter, so the last tests
 * drive the real CLI over a pipe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { ultracodeFromTranscript, ultracodeChipState } from '../src/ultracode.js';
import { extractTranscriptPath } from '../src/stdin-payload.js';
import { formatReport, formatNoSession } from '../src/formatters/statusline.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
/** The same gate the formatter reads at import time. */
const TRUECOLOR = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';

/** One transcript, written from the lines given, in a throwaway directory. */
function transcript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ultra-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

const enter = (reminderType = 'full') => ({
  type: 'attachment',
  attachment: { type: 'ultra_effort_enter', reminderType },
  isSidechain: false,
});
const exit = () => ({ type: 'attachment', attachment: { type: 'ultra_effort_exit' }, isSidechain: false });
const chatter = (text = 'just a turn') => ({ type: 'user', message: { role: 'user', content: text } });
/** What `/effort` writes the moment it returns, a turn before the attachment. */
const command = (text) => ({
  type: 'user',
  message: { role: 'user', content: `<local-command-stdout>${text}</local-command-stdout>` },
  isSidechain: false,
});
const ON = 'Ultracode on (this session only): dynamic workflows on every task. Effort stays high.';
const OFF = 'Ultracode off. Effort stays high.';
const setOn = () => command(ON);
const setOff = () => command(OFF);
/** Pre-2.1.302 phrasing, where ultracode was a level. */
const oldOn = () => command('Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration');
const setLevel = (level) => command(`Set effort level to ${level}: Balanced approach`);

function state(lines) {
  const { path, cleanup } = transcript(lines);
  try {
    return ultracodeFromTranscript(path);
  } finally {
    cleanup();
  }
}

test('the newest marker is the state, in either direction', () => {
  assert.equal(state([chatter(), enter()]), true, 'entering turns it on');
  assert.equal(state([chatter(), enter(), chatter(), exit()]), false, 'exiting turns it off again');
  assert.equal(state([enter(), exit(), chatter(), enter('sparse')]), true, 'and it can come back on');
  // The reminder that repeats every tenth turn carries the same state as the
  // one that announced it — this is what keeps a long session's marker near
  // the tail, where the capped scan can still see it.
  assert.equal(state([enter('sparse')]), true);
});

test('no marker is not a state', () => {
  assert.equal(state([chatter(), chatter()]), null, 'a session that never touched ultracode says nothing');
  assert.equal(ultracodeFromTranscript('/nonexistent/session.jsonl'), null, 'an unreadable transcript says nothing');
  assert.equal(ultracodeFromTranscript(''), null);
  assert.equal(ultracodeFromTranscript(null), null);
  assert.equal(ultracodeFromTranscript(undefined), null);
  const empty = transcript([]);
  try {
    // An empty file has no marker either; the point is that it must not throw.
    assert.equal(ultracodeFromTranscript(empty.path), null);
  } finally {
    empty.cleanup();
  }
});

test('a line that only quotes the marker name is not a marker', () => {
  // Real shape of the false positive: tool output. The transcript of the session
  // this feature was built in contains the attachment names as grep results,
  // which is why the scan parses the line instead of matching the bytes.
  const quoted = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', content: 'off=0.74MB ultra_effort_enter full sidechain= False' }],
    },
  };
  assert.equal(state([chatter(), quoted]), null, 'quoted text alone decides nothing');
  assert.equal(state([enter(), exit(), quoted]), false, 'and it does not override the real marker before it');
  // Truncated JSON (the oldest line of a capped window looks like this) is
  // skipped the same way, rather than throwing.
  assert.equal(state([enter(), '{"type":"attachment","attach']), true);
});

test('the toggle output counts, so the chip does not wait for the next turn', () => {
  assert.equal(state([chatter(), setOn()]), true);
  assert.equal(state([setOn(), setOff()]), false);
  assert.equal(state([setOn(), chatter(), setOff(), chatter(), setOn()]), true);
  // A cancelled picker changed nothing and must say nothing.
  assert.equal(state([setOn(), command('Cancelled')]), true, 'the cancel leaves the earlier state standing');
  assert.equal(state([command('Cancelled')]), null);
});

test('the query answers in both directions, by its suffix', () => {
  assert.equal(state([command('Current effort level: high (Deeper reasoning than medium) \u00b7 Ultracode on')]), true);
  assert.equal(state([command('Effort level: auto (currently high) \u00b7 Ultracode on')]), true);
  assert.equal(state([setOn(), command('Current effort level: high (Deeper reasoning than medium)')]), false, 'no suffix means off');
  assert.equal(state([setOn(), command('Effort level: auto (currently high)')]), false);
  assert.equal(state([command('Current effort level: high (x)')]), false, 'a query alone is a signal too');
});

test('a level change leaves ultracode alone, except for the remote off suffix', () => {
  assert.equal(state([setLevel('high')]), null, 'nothing said yet stays nothing said');
  assert.equal(state([setOn(), setLevel('medium')]), true, 'a local level change does not switch it off');
  assert.equal(state([setOff(), setLevel('max')]), false);
  assert.equal(state([setOn(), command('Set effort level to high: Balanced \u00b7 Ultracode off')]), false, 'remote suffix');
  assert.equal(state([setOn(), command('Effort level set to auto: model default \u00b7 Ultracode off')]), false);
});

test('the pre-2.1.302 phrasing still reads as on', () => {
  assert.equal(state([oldOn()]), true);
  assert.equal(state([command('Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)')]), true);
  // The old build's "Set effort level to <level>" used to mean off. It decides nothing now,
  // so the next turn's exit attachment is what clears it.
  assert.equal(state([oldOn(), setLevel('medium')]), true);
  assert.equal(state([oldOn(), setLevel('medium'), exit()]), false);
});

test('the newest of the two signals wins, in either order', () => {
  // The attachment is authoritative when it is the later one (it is written from
  // the app's own resolved state), and the command output when IT is later.
  assert.equal(state([setOn(), exit()]), false, 'a later exit attachment overrides the command');
  assert.equal(state([exit(), setOn()]), true, 'and a later command overrides the attachment');
  assert.equal(state([enter(), setOff()]), false);
  assert.equal(state([setOff(), enter()]), true);
});

test('only a real command output counts, not a line that quotes one', () => {
  // Measured hazard, not a hypothetical: in the session the first version was
  // built in, the old phrase appeared six times outside a command output — three
  // in assistant text and three in tool results that printed it.
  const quotedByTool = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', content: `<local-command-stdout>${ON}</local-command-stdout>` }],
    },
  };
  const quotedByAssistant = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: ON }] },
  };
  assert.equal(state([chatter(), quotedByTool]), null, 'a tool result is not a command output');
  assert.equal(state([chatter(), quotedByAssistant]), null, 'and neither is prose that quotes it');
  assert.equal(state([exit(), quotedByTool, quotedByAssistant]), false, 'so neither overrides the real state');
  // Without the wrapper it is just text, even on a user entry.
  assert.equal(state([chatter(ON)]), null);
  assert.equal(state([chatter(OFF)]), null);
  assert.equal(state([chatter('Current effort level: high \u00b7 Ultracode on')]), null);
});

test("a subagent's own reminder is not the session's", () => {
  const sidechainEnter = { ...enter(), isSidechain: true };
  assert.equal(state([chatter(), sidechainEnter]), null, 'a sidechain marker alone says nothing');
  assert.equal(state([exit(), sidechainEnter]), false, 'and never overrides the session-level state');
});

test('the scan is capped, and the cap can only under-report', () => {
  const far = [enter(), ...Array.from({ length: 400 }, () => chatter('x'.repeat(200)))];
  const { path, cleanup } = transcript(far);
  try {
    assert.equal(ultracodeFromTranscript(path), true, 'in range, the marker is found');
    // Past the cap the answer is "nothing said", which renders as off — never a
    // false ultracode.
    assert.equal(ultracodeFromTranscript(path, { scanBytes: 4096 }), null);
  } finally {
    cleanup();
  }
});

test('the chip state is true/false for a readable transcript, null for none', () => {
  const on = transcript([enter()]);
  const off = transcript([enter(), exit()]);
  const quiet = transcript([chatter()]);
  const empty = transcript([]);
  try {
    assert.equal(ultracodeChipState(on.path), true);
    assert.equal(ultracodeChipState(off.path), false);
    assert.equal(ultracodeChipState(quiet.path), false, 'no signal reads as off');
    assert.equal(ultracodeChipState(empty.path), false, 'an empty transcript is readable and says nothing');
  } finally {
    on.cleanup(); off.cleanup(); quiet.cleanup(); empty.cleanup();
  }
  assert.equal(ultracodeChipState('/nonexistent/session.jsonl'), null);
  assert.equal(ultracodeChipState(null), null);
  assert.equal(ultracodeChipState(''), null);
});

test('the payload path is read the way the chip needs it', () => {
  assert.equal(extractTranscriptPath({ transcript_path: '/x/y.jsonl' }), '/x/y.jsonl');
  assert.equal(extractTranscriptPath({}), null);
  assert.equal(extractTranscriptPath(null), null);
  assert.equal(extractTranscriptPath({ transcript_path: '' }), null);
  assert.equal(extractTranscriptPath({ transcript_path: 42 }), null);
});

const reportData = (extra) => ({
  summary: { hitRate: 0.9 },
  ttl: { total: 100, pct1h: 1 },
  cost: { savings: 1500 },
  options: { days: 1, windowLabel: '1d' },
  lastActivity: Date.now(),
  contextWindow: { size: '1M', maxContext: 1000000 },
  ctxLive: { usedPct: 47, size: 1_000_000 },
  spikeChip: null,
  caps: { windows: [{ key: 'five_hour', usedPct: 31 }] },
  model: 'Opus 5',
  effort: 'high',
  delegationSaved: 0,
  ...extra,
});

test('the ultra chip reads on/off in each label mode', () => {
  const line = (ultra, mode) => strip(formatReport(reportData({ ultra }), { color: false, timer: false, mode, segments: ['effort', 'ultra'] }));
  assert.equal(line(true, 'icon').trim(), '🔬 high · 🐙 ultra on');
  assert.equal(line(false, 'icon').trim(), '🔬 high · 🐙 ultra off');
  assert.equal(line(true, 'text').trim(), 'Effort high · Ultra on');
  assert.equal(line(false, 'text').trim(), 'Effort high · Ultra off');
  // ◕ is in the font-verified vocabulary of statusline-glyphs.test.js.
  assert.equal(line(true, 'narrow').trim(), '▲ high · ◕ ultra on');
  assert.equal(line(false, 'narrow').trim(), '▲ high · ◕ ultra off');
});

test('no chip without a live reading, and it sits right after effort by default', () => {
  const full = (ultra) => strip(formatReport(reportData({ ultra }), { color: false, timer: false, mode: 'icon' }));
  for (const absent of [null, undefined]) {
    const out = strip(formatReport(reportData({ ultra: absent }), { color: false, timer: false, mode: 'icon', segments: ['ultra'] }));
    assert.doesNotMatch(out, /ultra/i, `${String(absent)} must draw nothing`);
  }
  assert.match(full(true), /🔬 high · 🐙 ultra on/, 'ultra follows effort with nothing between them');
});

test('ultracode at high effort still shows the chip, and effort is not rewritten', () => {
  const out = strip(formatReport(reportData({ effort: 'high', ultra: true }), { color: false, timer: false, mode: 'icon', segments: ['effort', 'ultra'] }));
  assert.match(out, /🔬 high/);
  assert.match(out, /🐙 ultra on/);
  assert.doesNotMatch(out, /🔬 ultracode/);
});

test('on is the bold rainbow spread across the label, off is gray', () => {
  const paint = (ultra) => formatReport(reportData({ ultra }), { color: true, timer: false, mode: 'icon', segments: ['ultra'] });
  const escapes = (rendered) => rendered.match(/\x1b\[[0-9;]*m/g) || [];
  const on = paint(true);
  assert.ok(on.startsWith('\x1b[1m'), 'bold, so it stands apart from a max effort chip');
  // The label "ultra on" is eight characters, so every one of the seven stops lands.
  const [first, last] = TRUECOLOR
    ? ['\x1b[38;2;235;95;87m', '\x1b[38;2;200;130;180m']
    : ['\x1b[31m', '\x1b[35m'];
  assert.ok(escapes(on).includes(first), 'the rainbow starts at red');
  assert.ok(escapes(on).includes(last), 'and walks the whole arc to violet');
  assert.ok(new Set(escapes(on)).size >= 8, 'seven stops plus bold, not one flat tone');
  const off = paint(false);
  const gray = TRUECOLOR ? '\x1b[38;2;100;116;139m' : '\x1b[90m';
  assert.ok(off.startsWith(gray), 'off is the line\'s gray');
  assert.equal(new Set(escapes(off)).size, 2, 'gray and the reset, nothing else');
  assert.ok(!escapes(off).includes('\x1b[38;2;208;180;255m'), 'and none of the ramp');
});

test('the no-session line carries the chip after effort', () => {
  const out = strip(formatNoSession({ model: 'Opus 5', effort: 'high', ultra: true }, { color: false }));
  assert.match(out, /🔬 high · 🐙 ultra on · .*no session data/);
  assert.doesNotMatch(strip(formatNoSession({ model: 'Opus 5', effort: 'high' }, { color: false })), /ultra/i);
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI. Dropping the ultracodeChipState call from bin/cli.js
// leaves every test above green and the chip never drawn, so both branches that
// render it are driven here with a transcript on disk.
// ---------------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

/** A HOME with no Claude logs, plus a transcript whose newest marker is `marker`. */
function home({ withSession, marker = enter() }) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ultra-cli-'));
  const proj = join(dir, '.claude', 'projects', '-tmp-proj');
  mkdirSync(proj, { recursive: true });
  const lines = [marker];
  if (withSession) {
    lines.push({
      requestId: 'r1',
      timestamp: new Date().toISOString(),
      sessionId: 'sess-ultra',
      message: {
        id: 'm1',
        model: 'claude-opus-5',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 1000,
          output_tokens: 5,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
        },
      },
    });
  }
  const tpath = join(proj, 'session.jsonl');
  writeFileSync(tpath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, tpath, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

function render(dir, payload) {
  return strip(execFileSync(process.execPath, [CLI, '--statusline', '--no-color'], {
    env: childEnv({
      HOME: dir,
      XDG_CONFIG_HOME: join(dir, 'cfg'),
      APPDATA: join(dir, 'cfg'),
      NO_COLOR: '1',
    }),
    input: JSON.stringify(payload),
    encoding: 'utf8',
  }));
}

const payload = (tpath, level = 'high') => ({
  model: { display_name: 'Opus 5' },
  context_window: { context_window_size: 1000000, used_percentage: 47 },
  effort: { level },
  ...(tpath ? { transcript_path: tpath } : {}),
});

test('the CLI draws ultra on beside a high effort chip on the populated line', () => {
  const { dir, tpath, cleanup } = home({ withSession: true });
  try {
    const out = render(dir, payload(tpath));
    assert.match(out, /🔬 high · 🐙 ultra on/, 'the entry point must consult the transcript');
    assert.doesNotMatch(out, /no session data/, 'this case is meant to exercise the populated report');
  } finally {
    cleanup();
  }
});

test('and ultra off once the transcript says so', () => {
  const { dir, tpath, cleanup } = home({ withSession: true, marker: exit() });
  try {
    assert.match(render(dir, payload(tpath)), /🔬 high · 🐙 ultra off/);
  } finally {
    cleanup();
  }
});

test('and on the no-session line, which shows the same chips', () => {
  const { dir, tpath, cleanup } = home({ withSession: false });
  try {
    const out = render(dir, payload(tpath));
    assert.match(out, /no session data/, 'a HOME with no usage records should reach the fallback line');
    assert.match(out, /🔬 high · 🐙 ultra on/);
  } finally {
    cleanup();
  }
});

test('a payload with no transcript path draws the level and no ultra chip', () => {
  const { dir, cleanup } = home({ withSession: true });
  try {
    const out = render(dir, payload(null));
    assert.match(out, /🔬 high/);
    assert.doesNotMatch(out, /ultra/i);
  } finally {
    cleanup();
  }
});
