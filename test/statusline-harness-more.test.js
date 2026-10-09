/**
 * The 🅷 warning chip names the first problem in precedence order and counts
 * the rest: `🅷⚠ PEV-skip +2`.
 *
 * harnessStatusForStatusline() used to stop at the first warning it found, so
 * while a session-quality warning was up (`PEV-skip`) a failing delegation rule
 * (`rule-health`) or a missing autoCompactWindow was invisible, and it only
 * surfaced once the higher one cleared. Precedence is unchanged; every check now
 * runs and the number it outranks rides along.
 *
 * The first half drives harnessStatusForStatusline() against a sandbox with one
 * file per warning source; the second half drives the real CLI, since the chip
 * is built from that result inside the formatter and nothing but an end-to-end
 * render shows the count arriving.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

// The state file, the registry and the settings are all located from the
// environment when the modules load or on each call, so the sandbox has to be
// in place before the first dynamic import below. realpath, because the tool
// compares roots as resolved paths and macOS temp dirs are symlinks.
const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-harness-more-')));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
const PROJ = join(SANDBOX, 'proj');
const DATA = join(CFG, 'claude-token-saver');
for (const d of [join(HOME, '.claude'), DATA, PROJ]) mkdirSync(d, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
for (const k of ['ANTHROPIC_MODEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW']) delete process.env[k];
// The chip reads the root from the working directory, like the real statusline.
process.chdir(PROJ);
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const { harnessStatusForStatusline } = await import('../src/harness.js');
const { harnessClaudeMdBlock } = await import('../src/harness-templates.js');
const { formatReport, formatNoSession } = await import('../src/formatters/statusline.js');

const ALL = {
  state: { ratchetCandidate: { count: 2, id: 3 }, evidenceLow: true, pevSkip: true },
  unloaded: true,
  compact: true,
  review: true,
  route: true,
};

/**
 * Lay out the sandbox so exactly the named warnings are due. Every source is
 * rewritten on each call, so cases cannot see each other's leftovers.
 */
function arrange({ state = null, unloaded = false, compact = false, review = false, route = false } = {}) {
  const block = harnessClaudeMdBlock('project');
  // The block carries the two `@` imports; without them the harness reports
  // `ratchet-unloaded`.
  writeFileSync(join(PROJ, 'CLAUDE.md'), unloaded ? block.replace(/^@.*$/gm, '') : block);
  const statePath = join(DATA, 'harness-state.json');
  if (state) {
    writeFileSync(statePath, JSON.stringify({ timestamp: new Date().toISOString(), cwd: PROJ, ...state }));
  } else {
    rmSync(statePath, { force: true });
  }
  writeFileSync(
    join(HOME, '.claude', 'settings.json'),
    JSON.stringify({ model: compact ? 'claude-opus-5[1m]' : 'claude-opus-5' }),
  );
  writeFileSync(
    join(DATA, 'model-rules.json'),
    JSON.stringify({ rules: review ? [{ scope: 'global', status: 'review', tier: 'T2', category: 'check', signature: 's1' }] : [] }),
  );
  writeFileSync(
    join(DATA, 'route-scan.json'),
    JSON.stringify({
      scannedAt: new Date().toISOString(),
      candidates: route ? [{ id: 7, project: 'x', signature: 'sig', suggestedScope: 'global' }] : [],
      resolved: [],
    }),
  );
}

const status = () => harnessStatusForStatusline({}, { root: PROJ });

test('a clean project has no warning and nothing hidden', () => {
  arrange();
  const s = status();
  assert.equal(s.warning, null);
  assert.equal(s.moreWarnings, 0);
  assert.deepEqual(s.warnings, []);
});

test('each source alone still names itself first, with nothing hidden', () => {
  const cases = [
    [{ state: { ratchetCandidate: { count: 2, id: 3 } } }, 'ratchet? #3'],
    [{ state: { evidenceLow: true } }, 'no-evidence'],
    [{ state: { pevSkip: true } }, 'PEV-skip'],
    [{ unloaded: true }, 'ratchet-unloaded'],
    [{ compact: true }, 'compact-window?'],
    [{ review: true }, 'rule-health R1'],
    [{ route: true }, 'route? R7'],
  ];
  for (const [setup, expected] of cases) {
    arrange(setup);
    const s = status();
    assert.equal(s.warning, expected, JSON.stringify(setup));
    assert.equal(s.moreWarnings, 0, `${expected} alone hides nothing`);
  }
});

test('with everything due the precedence order is unchanged and the rest are counted', () => {
  arrange(ALL);
  const s = status();
  assert.deepEqual(s.warnings, [
    'ratchet? #3',
    'no-evidence',
    'PEV-skip',
    'ratchet-unloaded',
    'compact-window?',
    'rule-health R1',
    'route? R7',
  ]);
  assert.equal(s.warning, 'ratchet? #3', 'the shown warning is still the top of the chain');
  assert.equal(s.moreWarnings, 6);
});

test('a lower-priority warning is no longer invisible behind PEV-skip', () => {
  arrange({ state: { pevSkip: true }, review: true, route: true });
  const s = status();
  assert.equal(s.warning, 'PEV-skip');
  assert.equal(s.moreWarnings, 2, 'rule-health and route? were hidden before');
});

test('the three analyzer flags are independent, not an else-if chain', () => {
  arrange({ state: { ratchetCandidate: { count: 2, id: 3 }, pevSkip: true } });
  const s = status();
  assert.equal(s.warning, 'ratchet? #3');
  assert.equal(s.moreWarnings, 1, 'PEV-skip sits behind it rather than being dropped');
});

test('the state-file guards still hold: stale and foreign states count for nothing', () => {
  arrange({ review: true });
  const statePath = join(DATA, 'harness-state.json');
  // Older than the 30 minute freshness window: a dead session's leftovers.
  writeFileSync(statePath, JSON.stringify({
    timestamp: new Date(Date.now() - 2 * 3600e3).toISOString(), cwd: PROJ, pevSkip: true, evidenceLow: true,
  }));
  assert.equal(status().warning, 'rule-health R1');
  assert.equal(status().moreWarnings, 0);
  // Fresh, but from another project.
  writeFileSync(statePath, JSON.stringify({
    timestamp: new Date().toISOString(), cwd: SANDBOX, pevSkip: true,
  }));
  assert.equal(status().warning, 'rule-health R1');
  assert.equal(status().moreWarnings, 0);
});

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

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
    model: null,
    delegationSaved: 0,
  };
}

const opts = { color: false, timer: false };

test('the chip appends the hidden count in every label mode', () => {
  arrange({ state: { pevSkip: true }, review: true, route: true });
  assert.match(formatReport(reportData(), { ...opts, mode: 'icon' }), /🅷⚠ PEV-skip \+2/);
  assert.match(formatReport(reportData(), { ...opts, mode: 'text' }), /H⚠ PEV-skip \+2/);
  assert.match(formatReport(reportData(), { ...opts, mode: 'narrow' }), /⍟⚠ PEV-skip \+2/);
});

test('one warning alone renders without a count', () => {
  arrange({ state: { pevSkip: true } });
  const out = formatReport(reportData(), { ...opts, mode: 'icon' });
  assert.match(out, /🅷⚠ PEV-skip(?! \+)/);
});

test('the count does not turn a healthy score into a warning', () => {
  arrange();
  const out = formatReport(reportData(), { ...opts, mode: 'icon' });
  assert.match(out, /🅷 5\/5/);
  assert.doesNotMatch(out, /⚠ .*\+\d/);
});

test('the no-session line carries the count too', () => {
  arrange({ state: { pevSkip: true }, review: true });
  assert.match(formatNoSession({}, { color: false, mode: 'icon' }), /🅷⚠ PEV-skip \+1/);
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI
// ---------------------------------------------------------------------------

test('the CLI renders the hidden count on the populated line', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-harness' });
    writeFileSync(join(home.project, 'CLAUDE.md'), harnessClaudeMdBlock('project'));
    writeFileSync(
      join(home.dataDir, 'harness-state.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), cwd: home.project, pevSkip: true }),
    );
    writeFileSync(
      join(home.dataDir, 'model-rules.json'),
      JSON.stringify({ rules: [{ scope: 'global', status: 'review', tier: 'T2', category: 'check', signature: 's1' }] }),
    );
    writeFileSync(
      join(home.dataDir, 'route-scan.json'),
      JSON.stringify({
        scannedAt: new Date().toISOString(),
        candidates: [{ id: 7, project: 'x', signature: 'sig', suggestedScope: 'global' }],
        resolved: [],
      }),
    );
    const out = renderStatusline(home, { session_id: 'sess-harness' });
    assert.match(out, /🅷⚠ PEV-skip \+2/);
  } finally {
    home.cleanup();
  }
});
