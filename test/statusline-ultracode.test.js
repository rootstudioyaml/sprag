/**
 * Ultracode — the effort level the statusline payload cannot name.
 *
 * `/effort ultracode` sets xhigh plus dynamic workflow orchestration, and
 * Claude Code reports only the xhigh half on stdin, so the chip read "xhigh"
 * for both. src/ultracode.js recovers the difference from the transcript's
 * ultra_effort_enter / ultra_effort_exit attachments.
 *
 * What is worth pinning is everything that would fail quietly. The newest of
 * the two markers has to win, or the chip reports a state the user left turns
 * ago. A transcript line that merely quotes the marker's name (tool output — a
 * session that greps for these strings has plenty) must not count as one, and
 * neither must a subagent's own reminder. A payload that says anything other
 * than xhigh must be believed over a marker, because the exit marker is written
 * a turn late. And the chip only ever renders what the entry point hands the
 * formatter, so the last tests drive the real CLI over a pipe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { ultracodeFromTranscript, effortChipLevel } from '../src/ultracode.js';
import { extractTranscriptPath } from '../src/stdin-payload.js';
import { formatReport } from '../src/formatters/statusline.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
/** The same gate the formatter reads at import time. */
const TRUECOLOR = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';

/** One transcript, written from the lines given, in a throwaway directory. */
function transcript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ultra-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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
const setUltracode = () => command('Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration');
const setLevel = (level) => command(`Set effort level to ${level} (this session only): Balanced approach`);

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

test('the command output counts, so the chip does not wait for the next turn', () => {
  // The gap this closes: `/effort ultracode` returns, the attachment is not
  // written until the next turn is assembled, and until this the chip said xhigh.
  assert.equal(state([chatter(), setUltracode()]), true);
  assert.equal(state([setUltracode(), setLevel('medium')]), false, 'setting any other level clears the flag');
  // The bare query answers in its own words, in both directions.
  assert.equal(state([command('Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)')]), true);
  assert.equal(state([setUltracode(), command('Current effort level: xhigh (Deeper reasoning than high)')]), false);
  // A cancelled picker changed nothing and must say nothing.
  assert.equal(state([setUltracode(), command('Cancelled')]), true, 'the cancel leaves the earlier state standing');
  assert.equal(state([command('Cancelled')]), null);
});

test('the newest of the two signals wins, in either order', () => {
  // The attachment is authoritative when it is the later one (it is written from
  // the app's own resolved state), and the command output when IT is later.
  assert.equal(state([setUltracode(), exit()]), false, 'a later exit attachment overrides the command');
  assert.equal(state([exit(), setUltracode()]), true, 'and a later command overrides the attachment');
  assert.equal(state([enter(), setLevel('low')]), false);
  assert.equal(state([setLevel('low'), enter()]), true);
});

test('only a real command output counts, not a line that quotes one', () => {
  // Measured hazard, not a hypothetical: in the session this was built in the
  // phrase appeared six times outside a command output — three in assistant text
  // and three in tool results that printed it.
  const quotedByTool = {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        content: '<local-command-stdout>Set effort level to ultracode (this session only)</local-command-stdout>',
      }],
    },
  };
  const quotedByAssistant = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Set effort level to ultracode (this session only)' }] },
  };
  assert.equal(state([chatter(), quotedByTool]), null, 'a tool result is not a command output');
  assert.equal(state([chatter(), quotedByAssistant]), null, 'and neither is prose that quotes it');
  assert.equal(state([exit(), quotedByTool, quotedByAssistant]), false, 'so neither overrides the real state');
  // Without the wrapper it is just text, even on a user entry.
  assert.equal(state([chatter('Set effort level to ultracode')]), null);
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
    // Past the cap the answer is "nothing said", which renders as plain xhigh —
    // the behaviour from before this existed, never a false ultracode.
    assert.equal(ultracodeFromTranscript(path, { scanBytes: 4096 }), null);
  } finally {
    cleanup();
  }
});

test('only an xhigh payload can become ultracode', () => {
  const { path, cleanup } = transcript([enter()]);
  try {
    assert.equal(effortChipLevel('xhigh', path), 'ultracode');
    // Dropping effort turns ultracode off, but the exit marker is only written
    // when the next turn is assembled. Until then the payload is the truth.
    for (const level of ['high', 'medium', 'low', 'max', 'none']) {
      assert.equal(effortChipLevel(level, path), level, `${level} must not be rewritten`);
    }
    assert.equal(effortChipLevel(null, path), null, 'no level stays no level');
  } finally {
    cleanup();
  }
});

test('xhigh without a marker stays xhigh', () => {
  const { path, cleanup } = transcript([chatter()]);
  try {
    assert.equal(effortChipLevel('xhigh', path), 'xhigh');
  } finally {
    cleanup();
  }
  assert.equal(effortChipLevel('xhigh', '/nonexistent/session.jsonl'), 'xhigh');
  assert.equal(effortChipLevel('xhigh', null), 'xhigh', 'a payload without a transcript path is not an error');
});

test('the payload path is read the way the chip needs it', () => {
  assert.equal(extractTranscriptPath({ transcript_path: '/x/y.jsonl' }), '/x/y.jsonl');
  assert.equal(extractTranscriptPath({}), null);
  assert.equal(extractTranscriptPath(null), null);
  assert.equal(extractTranscriptPath({ transcript_path: '' }), null);
  assert.equal(extractTranscriptPath({ transcript_path: 42 }), null);
});

test('the chip names ultracode, in the raised-level tone', () => {
  const data = (effort) => ({
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
    effort,
    delegationSaved: 0,
  });
  const tone = (effort) => {
    const rendered = formatReport(data(effort), { color: true, timer: false, mode: 'icon', segments: ['effort'] });
    const m = rendered.match(/^(?:\x1b\[[0-9;]*m)+/);
    return m ? m[0] : null;
  };
  const line = (effort, mode) => strip(formatReport(data(effort), { color: false, timer: false, mode }));
  assert.match(line('ultracode', 'icon'), /🔬 ultracode/);
  assert.match(line('ultracode', 'text'), /Effort ultracode/);
  // Claude Code gives ultracode the same purple as xhigh and separates them by
  // shimmering one, so with the animation dropped the chip spends that shimmer
  // as a glow across the word: it opens on xhigh's purple and brightens through
  // it. Both properties matter — the hue is the app's, the glow is what makes
  // the level readable at a glance.
  assert.equal(tone('ultracode'), tone('xhigh'), "the ramp opens on the app's own purple");
  const escapes = formatReport(data('ultracode'), { color: true, timer: false, mode: 'icon', segments: ['effort'] })
    .match(/\x1b\[[0-9;]*m/g) || [];
  if (TRUECOLOR) {
    assert.ok(new Set(escapes).size > 2, 'ultracode is painted as a ramp, not one flat tone');
    assert.ok(escapes.includes('\x1b[38;2;208;180;255m'), 'and it reaches the shimmer peak');
  } else {
    // 8 colors have no ramp to spend, so the level word is the whole
    // distinction there (see effort-palette.js).
    assert.ok(escapes.includes('\x1b[95m'), 'the ANSI fallback is the flat bright magenta');
  }
  assert.match(strip(line('xhigh', 'icon')), /🔬 xhigh/, 'while xhigh stays a flat tone');
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI. Dropping the effortChipLevel call from bin/cli.js
// leaves every test above green and the chip back on "xhigh", so both branches
// that render it are driven here with a transcript on disk.
// ---------------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

/** A HOME with no Claude logs, plus a transcript that has ultracode on. */
function home({ withSession }) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ultra-cli-'));
  const proj = join(dir, '.claude', 'projects', '-tmp-proj');
  mkdirSync(proj, { recursive: true });
  const lines = [enter()];
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
  return { dir, tpath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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

const payload = (tpath, level = 'xhigh') => ({
  model: { display_name: 'Opus 5' },
  context_window: { context_window_size: 1000000, used_percentage: 47 },
  effort: { level },
  ...(tpath ? { transcript_path: tpath } : {}),
});

test('the CLI resolves ultracode on the populated line', () => {
  const { dir, tpath, cleanup } = home({ withSession: true });
  try {
    const out = render(dir, payload(tpath));
    assert.match(out, /🔬 ultracode/, 'the entry point must consult the transcript');
    assert.doesNotMatch(out, /no session data/, 'this case is meant to exercise the populated report');
  } finally {
    cleanup();
  }
});

test('and on the no-session line, which shows the same chip', () => {
  const { dir, tpath, cleanup } = home({ withSession: false });
  try {
    const out = render(dir, payload(tpath));
    assert.match(out, /no session data/, 'a HOME with no usage records should reach the fallback line');
    assert.match(out, /🔬 ultracode/);
  } finally {
    cleanup();
  }
});

test('a payload with no transcript path still renders the level it does carry', () => {
  const { dir, cleanup } = home({ withSession: true });
  try {
    assert.match(render(dir, payload(null)), /🔬 xhigh/);
  } finally {
    cleanup();
  }
});
