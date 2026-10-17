/**
 * Two identity chips stay off the line while there is nothing to say.
 *
 * `🅷 5/5` and `✍️ Korean style` used to ride on every line of every configured
 * install. Both are confirmations, not news: a harness at full score with no
 * warning, and a style hook that is on. A chip that never changes teaches the
 * eye to skip it, and it spent the tail of a line that a narrow terminal clips.
 *
 * The rule, pinned here:
 *   - harness: drawn when short of 5/5, red on a warning, or named in --segments
 *   - korean:  drawn only when named in --segments (and the style is on)
 *   - the no-session line follows the same rule as the full report
 *
 * The in-process half needs a sandbox HOME and a working directory inside it,
 * since both chips read machine state; the CLI half drives the real entry point,
 * which is the only place that hands the formatter `segments` at all.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-quiet-chips-')));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
const PROJ = join(SANDBOX, 'proj');
const DATA = join(CFG, 'claude-token-saver');
for (const d of [join(HOME, '.claude'), DATA, PROJ]) mkdirSync(d, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
for (const k of ['ANTHROPIC_MODEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW']) delete process.env[k];
process.chdir(PROJ);
// Leave the sandbox before deleting it: Windows refuses to remove the working
// directory of a live process (EBUSY).
after(() => {
  process.chdir(tmpdir());
  rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const { harnessClaudeMdBlock } = await import('../src/harness-templates.js');
const { formatReport, formatNoSession } = await import('../src/formatters/statusline.js');

const STATE = join(DATA, 'harness-state.json');
const CONFIG = join(DATA, 'config.json');

function arrange({ claudeMd = harnessClaudeMdBlock('project'), pevSkip = false, korean = false } = {}) {
  writeFileSync(join(PROJ, 'CLAUDE.md'), claudeMd);
  if (pevSkip) {
    writeFileSync(STATE, JSON.stringify({ timestamp: new Date().toISOString(), cwd: PROJ, pevSkip: true }));
  } else {
    rmSync(STATE, { force: true });
  }
  writeFileSync(CONFIG, JSON.stringify(korean ? { koreanStyle: { enabled: true } } : {}));
}

function reportData() {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d', version: '3.59.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: 'Opus 5',
    delegationSaved: 0,
  };
}
const opts = { color: false, timer: false, mode: 'icon' };

test('sandbox: the chips read the temp directory, not this machine', () => {
  arrange();
  assert.ok(process.cwd().startsWith(SANDBOX));
});

// --- harness -----------------------------------------------------------------

test('a full score with no warning draws nothing by default', () => {
  arrange();
  assert.doesNotMatch(formatReport(reportData(), opts), /🅷/);
  assert.doesNotMatch(formatReport(reportData(), { ...opts, mode: 'text' }), /\bH \d\/\d/);
});

test('a full score is drawn when --segments names the chip', () => {
  arrange();
  const out = formatReport(reportData(), { ...opts, segments: ['harness'] });
  assert.match(out, /🅷 5\/5/);
  assert.match(formatReport(reportData(), { ...opts, mode: 'text', segments: ['harness'] }), /H 5\/5/);
});

test('a score short of 5/5 is drawn without being asked', () => {
  // Drop one section's heading: the block is still there, so this is the
  // "customised" state, which keeps its neutral marker rather than a count.
  const block = harnessClaudeMdBlock('project').replace(/^### 5\..*$/m, '### 5. edited');
  arrange({ claudeMd: block });
  assert.match(formatReport(reportData(), opts), /🅷 custom/);
});

test('a warning is drawn without being asked, at the tail of the default order', () => {
  arrange({ pevSkip: true });
  const out = formatReport(reportData(), { ...opts, singleLine: true });
  assert.match(out, /🅷⚠ PEV-skip/);
  // Model first, then the warning: the default order puts harness near the end,
  // and hiding the healthy case must not have moved the warning case.
  assert.ok(out.indexOf('🤖') < out.indexOf('🅷'), 'the warning chip sits after the model chip');
  assert.ok(out.indexOf('🅷') < out.indexOf('v3.59.0'), 'and ahead of the version chip');
});

test('the no-session line follows the same rule', () => {
  arrange();
  assert.doesNotMatch(formatNoSession({}, { color: false, mode: 'icon' }), /🅷/);
  assert.match(formatNoSession({}, { color: false, mode: 'icon', segments: ['harness'] }), /🅷 5\/5/);
  assert.doesNotMatch(
    formatNoSession({}, { color: false, mode: 'icon', segments: ['ctx'] }),
    /🅷/,
    'naming other chips does not bring it back',
  );
  arrange({ pevSkip: true });
  assert.match(formatNoSession({}, { color: false, mode: 'icon' }), /🅷⚠ PEV-skip/);
});

test('the full report and the no-session line draw the same harness chip', () => {
  // Two call sites build this chip; the pair of assertions fails if one of them
  // stops going through the shared builder.
  for (const setup of [{}, { pevSkip: true }]) {
    arrange(setup);
    const chip = (s) => s.match(/🅷[^·]*/)?.[0]?.trim() ?? null;
    for (const segments of [undefined, ['harness']]) {
      const full = formatReport(reportData(), { ...opts, singleLine: true, segments });
      const bare = formatNoSession({}, { color: false, mode: 'icon', segments });
      assert.equal(chip(full), chip(bare), `${JSON.stringify(setup)} ${JSON.stringify(segments)}`);
    }
  }
});

// --- korean ------------------------------------------------------------------

test('Korean style is not in the default line even when the style is on', () => {
  arrange({ korean: true });
  assert.doesNotMatch(formatReport(reportData(), opts), /Korean style|✍/);
  assert.doesNotMatch(formatReport(reportData(), { ...opts, verbose: true }), /Korean style/);
});

test('Korean style is drawn when --segments names it and the style is on', () => {
  arrange({ korean: true });
  assert.match(formatReport(reportData(), { ...opts, segments: ['korean'] }), /✍️/);
  assert.match(formatReport(reportData(), { ...opts, verbose: true, segments: ['korean'] }), /✍️ Korean style/);
  assert.match(formatReport(reportData(), { ...opts, mode: 'text', segments: ['korean'] }), /Korean style/);
});

test('naming the chip does not draw it when the style is off', () => {
  arrange({ korean: false });
  assert.doesNotMatch(formatReport(reportData(), { ...opts, segments: ['korean'] }), /Korean style|✍/);
});

// --- over the real CLI -------------------------------------------------------

test('the CLI hides both healthy chips by default and shows them on request', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-quiet' });
    writeFileSync(join(home.project, 'CLAUDE.md'), harnessClaudeMdBlock('project'));
    writeFileSync(join(home.dataDir, 'config.json'), JSON.stringify({ koreanStyle: { enabled: true } }));
    const payload = { session_id: 'sess-quiet' };

    const plain = renderStatusline(home, payload);
    assert.doesNotMatch(plain, /🅷/, 'healthy harness is not on the default line');
    assert.doesNotMatch(plain, /Korean style/, 'nor is the Korean style confirmation');

    const asked = renderStatusline(home, payload, { args: ['--segments', 'harness,korean'] });
    assert.match(asked, /🅷 5\/5/);
    assert.match(asked, /Korean style/);
  } finally {
    home.cleanup();
  }
});

test('the CLI no-session line hides a healthy harness chip too', () => {
  const home = makeHome();
  try {
    writeFileSync(join(home.project, 'CLAUDE.md'), harnessClaudeMdBlock('project'));
    const out = renderStatusline(home, {});
    assert.match(out, /no session data/, 'this run really took the no-session path');
    assert.doesNotMatch(out, /🅷/);
  } finally {
    home.cleanup();
  }
});
