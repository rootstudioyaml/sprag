/**
 * The effort chip — which effort level `/effort` left the session on.
 *
 * Claude Code puts the resolved level in the statusline payload itself
 * (`effort.level`, added by 2.1.276), so nothing here reads the transcript.
 *
 * Three properties are worth pinning because getting any of them wrong is
 * silent. An absent key must render no chip rather than a default one (models
 * without an effort setting, and older Claude Code builds, both omit it, and
 * showing "high" there would be an invention). The tone must separate a level
 * the user raised from the one they were given, without borrowing the tone this
 * line reserves for things to act on. And the level is a string off a JSON
 * payload, so it must not be able to reach through Object.prototype into the
 * tone table.
 *
 * The chip only renders when the entry point passes a level through, and both
 * formatters skip it silently when nobody does — so the last tests here drive
 * the real CLI over a pipe instead of calling the formatter, which is the only
 * way a missing wire fails loudly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { extractEffort } from '../src/stdin-payload.js';
import { formatReport, formatNoSession } from '../src/formatters/statusline.js';

function data(effort) {
  return {
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
  };
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const line = (effort, opts = {}) => formatReport(data(effort), { color: false, timer: false, mode: 'icon', ...opts });
const BOLD = '\x1b[1m';
/** Every color escape the effort chip opens with, whatever palette is in play. */
function effortTone(effort) {
  const rendered = formatReport(data(effort), { color: true, timer: false, mode: 'icon', segments: ['effort'] });
  const m = rendered.match(/^(?:\x1b\[[0-9;]*m)+/);
  return m ? m[0] : null;
}

test('the payload level is read as-is, and a missing one stays missing', () => {
  assert.equal(extractEffort({ effort: { level: 'high' } }), 'high');
  // Case and padding are normalized so the tone lookup can key on the level.
  assert.equal(extractEffort({ effort: { level: ' XHigh ' } }), 'xhigh');
  // Every shape that means "this payload says nothing about effort".
  assert.equal(extractEffort({}), null, 'no effort key');
  assert.equal(extractEffort(null), null, 'no payload at all');
  assert.equal(extractEffort({ effort: {} }), null, 'effort object without a level');
  assert.equal(extractEffort({ effort: { level: '' } }), null, 'empty level');
  assert.equal(extractEffort({ effort: { level: '   ' } }), null, 'whitespace level');
  assert.equal(extractEffort({ effort: { level: 3 } }), null, 'non-string level');
});

test('the chip names the level, and says so in words where there is no glyph', () => {
  assert.match(strip(line('high')), /🔬 high/, 'icon mode pairs the glyph with the level');
  assert.match(strip(line('high', { mode: 'narrow' })), /▲ high/, 'narrow mode swaps only the glyph');
  // A bare "high" beside a model name would be anyone's guess, so text mode
  // names the field instead.
  assert.match(strip(line('high', { mode: 'text' })), /Effort high/);
});

test('no level means no chip, not a guessed one', () => {
  for (const absent of [null, undefined, '']) {
    const out = strip(line(absent));
    assert.doesNotMatch(out, /🔬/, `${String(absent)} must render no effort glyph`);
    // Scoped to the chip rather than the bare word: another chip is free to say
    // "high" about something else, and this test must not own that word.
    assert.doesNotMatch(out, /🔬 \S+|Effort \S+/, `${String(absent)} must not invent a level`);
    // And the line must not carry the separator the dropped chip would have had.
    assert.doesNotMatch(out, / · · /, 'a dropped chip leaves no empty slot');
  }
});

test('the chip sits with the model it qualifies', () => {
  // Asserted as a shape rather than a character distance: extractModel can
  // return any display_name the payload carries ("Claude Opus 4.5 (1M)"), and a
  // distance bound would fail on a long name while the render stayed correct.
  assert.match(strip(line('max')), /🤖 [^·]+ · 🔬 max/, 'effort follows the model chip with nothing between them');
});

test('a raised level is bolder, not louder', () => {
  // `high` is what Claude Code resolves an unset effort to, so it reads as
  // identity beside the model chip. Above it the level is bold in the SAME tone,
  // never the yellow this line saves for "act on this eventually" — a setting
  // the user pinned is not a state to fix (see the EFFORT_TONES comment).
  const dflt = effortTone('high');
  assert.equal(effortTone('xhigh'), effortTone('max'), 'both raised levels share one tone');
  assert.ok(effortTone('max').includes(BOLD), 'a raised level is bold');
  assert.equal(effortTone('max').replace(BOLD, ''), dflt, 'and bold is the only difference from the default');
  assert.ok(!dflt.includes(BOLD), 'the default level is not bold');
  // Below default recedes rather than warns: it spends less, not more.
  assert.equal(effortTone('low'), effortTone('medium'), 'the cheaper levels share one tone');
  assert.notEqual(effortTone('low'), dflt);
  assert.notEqual(effortTone('low'), effortTone('max'), 'cheaper must not look like a raised level');
  // A level this build has never heard of still renders, in the identity tone.
  assert.equal(effortTone('ultra'), dflt, 'an unknown level falls back to identity');
  assert.match(strip(line('ultra')), /🔬 ultra/);
});

test('a level that names an Object.prototype member cannot reach the tone table', () => {
  // The level is a string off a JSON payload. A bare index would resolve
  // 'constructor' to a function and interpolate it into the line as
  // `function Object() { [native code] }`, and the `|| MAGENTA` fallback cannot
  // catch it because a function is truthy.
  for (const level of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const colored = formatReport(data(level), { color: true, timer: false, mode: 'icon', segments: ['effort'] });
    assert.doesNotMatch(colored, /native code|\[object Object\]|function/, `${level} must not leak a prototype member`);
    assert.match(strip(colored), new RegExp(`🔬 ${level.replace('_', '_')}`), `${level} still renders as a level`);
  }
});

test('an empty analysis window still shows what effort the session is on', () => {
  // Same reason the model chip survives there: the payload is live even when the
  // log window is empty, and this is identity, not a statistic.
  const out = strip(formatNoSession({ model: 'Opus 5', effort: 'max' }, { color: false }));
  assert.match(out, /🔬 max/);
  const bare = strip(formatNoSession({ model: 'Opus 5' }, { color: false }));
  assert.doesNotMatch(bare, /🔬/, 'and renders nothing when the payload omitted it');
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI.
//
// buildEffortSeg returns null when no level reaches it, so a formatter test
// passes whether or not the entry point extracts one: dropping the
// extractEffort call from bin/cli.js would leave every test above green and the
// chip gone. These drive `bin/cli.js --statusline` with a payload on stdin, in
// a throwaway HOME, and cover both branches it renders through.
// ---------------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

/** A HOME with no Claude logs at all, so the CLI takes its no-session line. */
function emptyHome() {
  const dir = mkdtempSync(join(tmpdir(), 'cts-effort-'));
  mkdirSync(join(dir, '.claude', 'projects'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The same, plus one in-window usage record so the populated report renders. */
function homeWithSession() {
  const { dir, cleanup } = emptyHome();
  const proj = join(dir, '.claude', 'projects', '-tmp-proj');
  mkdirSync(proj, { recursive: true });
  const entry = {
    requestId: 'r1',
    timestamp: new Date().toISOString(),
    sessionId: 'sess-effort',
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
  };
  writeFileSync(join(proj, 'session.jsonl'), JSON.stringify(entry) + '\n');
  return { dir, cleanup };
}

function renderStatusline(home, payload) {
  return execFileSync(process.execPath, [CLI, '--statusline', '--no-color'], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, 'cfg'),
      APPDATA: join(home, 'cfg'),
      NO_COLOR: '1',
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

const PAYLOAD = (effort) => ({
  model: { display_name: 'Opus 5' },
  context_window: { context_window_size: 1000000, used_percentage: 47 },
  ...(effort ? { effort: { level: effort } } : {}),
});

test('the CLI carries the payload level into the populated line', () => {
  const { dir, cleanup } = homeWithSession();
  try {
    const out = strip(renderStatusline(dir, PAYLOAD('xhigh')));
    assert.match(out, /🔬 xhigh/, 'the entry point must pass effort into the report data');
    assert.doesNotMatch(out, /no session data/, 'this case is meant to exercise the populated report');
  } finally {
    cleanup();
  }
});

test('the CLI carries it into the no-session line too', () => {
  const { dir, cleanup } = emptyHome();
  try {
    const out = strip(renderStatusline(dir, PAYLOAD('max')));
    assert.match(out, /no session data/, 'an empty HOME should reach the fallback line');
    assert.match(out, /🔬 max/, 'the fallback line takes its own effort argument');
  } finally {
    cleanup();
  }
});

test('and renders no chip when the payload carries no level', () => {
  const { dir, cleanup } = homeWithSession();
  try {
    assert.doesNotMatch(strip(renderStatusline(dir, PAYLOAD(null))), /🔬/);
  } finally {
    cleanup();
  }
});
