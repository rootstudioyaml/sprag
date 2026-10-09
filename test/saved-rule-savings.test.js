/**
 * `sprag saved reset routing` and the per-rule `saved ~$` figure.
 *
 * The statusline and `sprag saved` sum the delegation ledger, which honours the
 * reset mark. The rule registry (model-rules.json, and ratchet-model.md rendered
 * from it) keeps its own savedUsd per rule, rebuilt by a scan, and used to ignore
 * the mark: right after a reset the headline said $0.00 while the rules still
 * listed the old money. Two things pin that closed:
 *
 *  - the scan adds a run's saving only when the run started at or after the mark
 *    (runs and the error rate keep the whole window, because rule-health reads
 *    them), and
 *  - `saved reset` / `saved undo` rebuild those figures before they return.
 *
 * HOME and XDG_CONFIG_HOME point into a temp directory before any module that
 * resolves a path is loaded (parser.js fixes its transcript directory at import),
 * so the real user data is never read or written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-rule-saved-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
/* The savings are priced in-process, and a gateway variable (ANTHROPIC_BASE_URL
   on a machine behind LiteLLM) sends the pricing to the gateway's price list,
   which the sandbox does not have: every run would come out unpriced and every
   expected figure would be null. Drop what the tool reads, the way childEnv does
   for a spawned child. */
{
  const clean = childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG });
  for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
}
/* Not a root after(): the runner fires it once the tests registered so far have
   finished, and the fixture below is built behind a top-level await, so the
   sandbox would be gone before the later tests read it. */
process.once('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));

const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const { tallyDelegatedRun, runRouteScan, runSaving } = await import('../src/route-scan.js');
const { refreshModelRules } = await import('../src/model-rules.js');
const { collectSubagentRun } = await import('../src/subagent-records.js');
const { resetSaved, undoReset, readResetMarks, resetPath } = await import('../src/saved-reset.cjs');
const savedCommand = await import('../src/commands/saved.js');

const RULES_FILE = join(DIR, 'model-rules.json');
const RATCHET_FILE = join(HOME, '.claude', 'ratchet-model.md');
const readRule = () => JSON.parse(readFileSync(RULES_FILE, 'utf8')).rules[0];
const round2 = (v) => Math.round(v * 100) / 100;
const clearMarks = () => rmSync(resetPath(DIR), { force: true });

// ── (a) the savedUsd rule, on the function the scan uses ─────────────────

test('a run that started before the reset stays in the sample but adds no money', () => {
  const MARK = 1_000_000;
  const stats = new Map();
  const failing = { startedAt: MARK - 1, out: 100, calls: 5, toolErrors: 3 };
  const clean = (startedAt) => ({ startedAt, out: 10, calls: 2, toolErrors: 0 });

  tallyDelegatedRun(stats, 'k', failing, 2, MARK);        // before: excluded from money
  tallyDelegatedRun(stats, 'k', clean(MARK), 3, MARK);    // exactly at the mark: counted
  tallyDelegatedRun(stats, 'k', clean(MARK + 5), 4, MARK); // after: counted
  tallyDelegatedRun(stats, 'k', clean(null), 8, MARK);    // no usable start: cannot be shown to postdate it

  const d = stats.get('k');
  assert.equal(d.savedUsd, 3 + 4, 'only runs at or after the mark are summed');
  assert.equal(d.runs, 4, 'every run still counts toward the sample size');
  assert.equal(d.errRuns, 1, 'and the failed one still counts toward the error rate');
  assert.equal(d.outTokens, 100 + 10 + 10 + 10);
});

test('a run still going at the reset is dated by its end, as the ledger dates it', () => {
  const MARK = 1_000_000;
  const stats = new Map();
  // Started before the mark, finished after: the ledger stamps this event at
  // its end, so the rule figure must count it too or the two totals disagree.
  tallyDelegatedRun(stats, 'k', { startedAt: MARK - 50, endedAt: MARK + 50, out: 1, calls: 1, toolErrors: 0 }, 6, MARK);
  // Finished before the mark: excluded in both.
  tallyDelegatedRun(stats, 'k', { startedAt: MARK - 90, endedAt: MARK - 10, out: 1, calls: 1, toolErrors: 0 }, 7, MARK);
  assert.equal(stats.get('k').savedUsd, 6);
  assert.equal(stats.get('k').runs, 2);
});

test('with no reset every run counts, and an unpriced run adds nothing either way', () => {
  const stats = new Map();
  tallyDelegatedRun(stats, 'k', { startedAt: 1, out: 1, calls: 1, toolErrors: 0 }, 2, null);
  tallyDelegatedRun(stats, 'k', { startedAt: null, out: 1, calls: 1, toolErrors: 0 }, 3, null);
  tallyDelegatedRun(stats, 'k', { startedAt: 5, out: 1, calls: 1, toolErrors: 0 }, null, null);
  tallyDelegatedRun(stats, 'k', { startedAt: 6, out: 1, calls: 1, toolErrors: 0 }, NaN, null);
  const d = stats.get('k');
  assert.equal(d.savedUsd, 5);
  assert.equal(d.runs, 4);
});

test('the registry keeps delegatedRuns and the error rate while savedUsd follows the mark', () => {
  const MARK = 1_000_000;
  writeFileSync(RULES_FILE, JSON.stringify({ rules: [{
    signature: 'T2|check|-p', scope: 'global', tier: 'T2', category: 'check', project: '-p',
    label: '상태 확인·검증', labelEn: 'status checks / verification', example: '상태 확인해줘',
    agent: 'haiku-explore', status: 'active', errRate: 0, savedUsd: 999,
  }] }));
  const stats = new Map();
  const ok = (startedAt) => ({ startedAt, out: 10, calls: 2, toolErrors: 0 });
  tallyDelegatedRun(stats, 'T2|check|-p', { ...ok(MARK - 10), toolErrors: 2, calls: 4 }, 5, MARK);
  tallyDelegatedRun(stats, 'T2|check|-p', ok(MARK + 10), 1.5, MARK);
  refreshModelRules(new Map(), stats, { now: new Date(MARK).toISOString() });

  const r = readRule();
  assert.equal(r.savedUsd, 1.5, 'the stale 999 is replaced by the post-reset figure only');
  assert.equal(r.delegatedRuns, 2, 'rule-health keeps the whole window');
  assert.equal(r.delegatedErrRate, 0.5);
});

// ── the real scan reads the mark ─────────────────────────────────────────

const MAIN = 'claude-opus-5';
const SUB = 'claude-haiku-4-5';
const DAY = 86400000;
const NOW = Date.now();
const T_OLD = NOW - 3 * DAY;
const T_NEW = NOW - 3600000;
const MARK = NOW - DAY; // between the two delegations
const PROJECT_DIR = '-sandbox-proj';

let seq = 0;
const iso = (ms) => new Date(ms).toISOString();
const userLine = (ms, text) => JSON.stringify({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: text } });
const toolResultLine = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
function assistantLine({ model, ms, out, cacheRead = 0, tools = [] }) {
  seq += 1;
  return JSON.stringify({
    type: 'assistant',
    timestamp: iso(ms),
    requestId: `req-${seq}`,
    message: {
      id: `msg-${seq}`,
      model,
      content: tools.map((t) => ({ type: 'tool_use', name: t.name, id: t.id })),
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: out },
    },
  });
}

/** One session, two check-type requests, each handed to a haiku subagent. */
function writeFixture() {
  const proj = join(HOME, '.claude', 'projects', PROJECT_DIR);
  const sub = join(proj, 'sess1', 'subagents');
  mkdirSync(sub, { recursive: true });
  const delegation = (id) => [{ name: 'Agent', id }];
  writeFileSync(join(proj, 'sess1.jsonl'), [
    userLine(T_OLD, '상태 확인해줘 첫번째'),
    assistantLine({ model: MAIN, ms: T_OLD + 1000, out: 50, tools: delegation('toolu_old') }),
    toolResultLine(),
    assistantLine({ model: MAIN, ms: T_OLD + 30000, out: 60 }),
    userLine(T_NEW, '상태 확인해줘 두번째'),
    assistantLine({ model: MAIN, ms: T_NEW + 1000, out: 50, tools: delegation('toolu_new') }),
    toolResultLine(),
    assistantLine({ model: MAIN, ms: T_NEW + 30000, out: 60 }),
  ].join('\n') + '\n');
  // Large token counts so each saving is whole dollars and survives rounding to cents.
  const runs = { old: { at: T_OLD, out: 200000, id: 'toolu_old' }, new: { at: T_NEW, out: 100000, id: 'toolu_new' } };
  for (const [name, r] of Object.entries(runs)) {
    writeFileSync(join(sub, `agent-${name}.jsonl`), [
      assistantLine({ model: SUB, ms: r.at + 5000, out: r.out, cacheRead: 2_000_000 }),
      assistantLine({ model: SUB, ms: r.at + 9000, out: 100, cacheRead: 2_000_000 }),
    ].join('\n') + '\n');
    writeFileSync(join(sub, `agent-${name}.meta.json`), JSON.stringify({ agentType: 'haiku-explore', toolUseId: r.id, spawnDepth: 1 }));
  }
  return sub;
}

function writeRegistry(extra = {}) {
  writeFileSync(RULES_FILE, JSON.stringify({ rules: [{
    signature: 'T2|check|*', scope: 'global', tier: 'T2', category: 'check', project: '*',
    label: '상태 확인·검증', labelEn: 'status checks / verification', example: '상태 확인해줘',
    agent: 'haiku-explore', status: 'active', errRate: 0, count: 0, baselineModel: MAIN,
    baselineSource: 'dominant', budget: { calls: 8, out: 1500 }, ...extra,
  }] }));
}

const sub = writeFixture();
const savedOld = runSaving(await collectSubagentRun(join(sub, 'agent-old.jsonl')), MAIN);
const savedNew = runSaving(await collectSubagentRun(join(sub, 'agent-new.jsonl')), MAIN);

test('fixture sanity: both runs are priced and worth more than a cent', () => {
  assert.ok(Number.isFinite(savedOld) && savedOld > 0.01, `old run saved ${savedOld}`);
  assert.ok(Number.isFinite(savedNew) && savedNew > 0.01, `new run saved ${savedNew}`);
  assert.notEqual(round2(savedOld), round2(savedNew));
});

test('runRouteScan credits a rule with every run until a reset, then only the later ones', async () => {
  clearMarks();
  writeRegistry();
  await runRouteScan({ days: 14 });
  let r = readRule();
  assert.equal(r.delegatedRuns, 2);
  assert.equal(r.savedUsd, round2(savedOld + savedNew), 'no mark: the whole window');

  // The mark falls between the two delegations: the older one drops out of the
  // money but not out of the sample.
  resetSaved(['routing'], { dir: DIR, now: MARK });
  await runRouteScan({ days: 14 });
  r = readRule();
  assert.equal(r.delegatedRuns, 2, 'rule-health still sees both runs');
  assert.equal(r.savedUsd, round2(savedNew), 'only the run that started after the mark is summed');

  // A mark later than every run leaves nothing to credit.
  resetSaved(['routing'], { dir: DIR, now: NOW });
  await runRouteScan({ days: 14 });
  r = readRule();
  assert.equal(r.delegatedRuns, 2);
  assert.equal(r.savedUsd, 0);

  undoReset({ dir: DIR });
  undoReset({ dir: DIR });
  await runRouteScan({ days: 14 });
  assert.equal(readRule().savedUsd, round2(savedOld + savedNew), 'undone marks bring the money back');
  clearMarks();
});

// ── (b) the saved command rebuilds the figures ───────────────────────────

/** Run `fn` with console.log collected, returning the lines. */
async function captured(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return lines;
}
const hasFlag = () => false;
const runSaved = (args, extra = {}) => savedCommand.run({ args: ['saved', ...args], hasFlag, dir: DIR, ...extra });

test('saved reset routing and saved undo call the rule recompute, after the mark is written', async () => {
  clearMarks();
  const seen = [];
  const rescan = async (opts) => { seen.push({ opts, mark: readResetMarks(DIR).routing }); };

  await captured(() => runSaved(['reset', 'routing'], { rescan }));
  assert.equal(seen.length, 1, 'a routing reset recomputes once');
  assert.deepEqual(seen[0].opts, { days: 14 });
  assert.ok(seen[0].mark > 0, 'the scan runs after the mark exists, or it would read the old one');

  await captured(() => runSaved(['undo'], { rescan }));
  assert.equal(seen.length, 2, 'undoing a routing reset recomputes too');
  assert.equal(seen[1].mark, null, 'and sees the restored mark');
  clearMarks();
});

test('saved reset all recomputes once; scopes with no rule figure do not', async () => {
  let calls = 0;
  const rescan = async () => { calls += 1; };

  clearMarks();
  await captured(() => runSaved(['reset'], { rescan }));
  assert.equal(calls, 1, 'all includes routing');

  clearMarks();
  calls = 0;
  await captured(() => runSaved(['reset', 'doc2md'], { rescan }));
  await captured(() => runSaved(['undo'], { rescan }));
  assert.equal(calls, 0, 'document conversion has no per-rule figure');

  clearMarks();
  await captured(() => runSaved(['reset', 'routing'], { rescan, agent: 'codex' }));
  await captured(() => runSaved(['undo'], { rescan, agent: 'codex' }));
  assert.equal(calls, 0, 'Codex routing is a separate store with no savedUsd');

  // undo pops the latest reset whichever agent asks, so the rescan keys on what
  // was restored: a Claude routing reset undone with --agent codex still counts.
  clearMarks();
  await captured(() => runSaved(['reset', 'routing'], { rescan }));
  calls = 0;
  await captured(() => runSaved(['undo'], { rescan, agent: 'codex' }));
  assert.equal(calls, 1);
  clearMarks();
});

test('a failed recompute leaves the reset in place and says the figures catch up later', async () => {
  clearMarks();
  const rescan = async () => { throw new Error('scan exploded'); };
  const lines = await captured(() => runSaved(['reset', 'routing'], { rescan }));
  assert.ok(readResetMarks(DIR).routing > 0, 'the mark is saved regardless');
  assert.ok(lines.some((l) => /route-scan/.test(l) && /(다시 계산|recalculated)/.test(l)), `note missing in: ${lines.join(' | ')}`);

  const lines2 = await captured(() => runSaved(['undo'], { rescan }));
  assert.equal(readResetMarks(DIR).routing, null, 'undo still restores the mark');
  assert.ok(lines2.some((l) => /route-scan/.test(l)));
  clearMarks();
});

test('CLI: reset routing zeroes the rule figures and the rendered file, undo brings them back', () => {
  clearMarks();
  // A stale figure that only a recompute can clear; nothing has rendered the file yet.
  writeRegistry({ savedUsd: 999, delegatedRuns: 2 });
  rmSync(RATCHET_FILE, { force: true });
  const cli = (...argv) => spawnSync(process.execPath, [CLI, ...argv], {
    env: childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG }),
    encoding: 'utf8',
  });

  let out = cli('saved', 'reset', 'routing');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readRule().savedUsd, 0, 'every fixture run is older than the new mark');
  assert.equal(readRule().delegatedRuns, 2, 'the sample is untouched');
  assert.ok(existsSync(RATCHET_FILE), 'ratchet-model.md was rendered before the command returned');
  const reset = readFileSync(RATCHET_FILE, 'utf8');
  assert.match(reset, /delegated ×2/);
  assert.doesNotMatch(reset, /saved ~/, 'no saving is listed after a reset');

  out = cli('saved', 'undo');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readRule().savedUsd, round2(savedOld + savedNew));
  assert.match(readFileSync(RATCHET_FILE, 'utf8'), /saved ~/, 'and the file lists it again');
  clearMarks();
});
