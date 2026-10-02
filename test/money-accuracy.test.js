import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

// parser.js and session-cache.js resolve their directories when they load, so
// the sandbox has to be in the environment before the imports below.
const home = mkdtempSync(join(tmpdir(), 'cts-money-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const parser = await import('../src/parser.js');
const cache = await import('../src/session-cache.js');
const ledger = await import('../src/savings-ledger.js');
const rules = await import('../src/model-rules.js');
const { monthSpend } = await import('../src/month-spend.js');
const { estimateCost } = await import('../src/cost.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const HOUR = 3600 * 1000;
const projects = join(home, '.claude', 'projects');

function usageLine(sessionId, n, ts, { input = 1000, out = 100 } = {}) {
  return JSON.stringify({
    requestId: `${sessionId}-r${n}`,
    timestamp: new Date(ts).toISOString(),
    sessionId,
    message: { id: `${sessionId}-m${n}`, model: 'claude-opus-5', usage: { input_tokens: input, output_tokens: out } },
  });
}

function transcript(projectDir, sessionId, lines) {
  mkdirSync(join(projects, projectDir), { recursive: true });
  const file = join(projects, projectDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

test('a transcript copied under two project folders is one file, the larger copy', () => {
  const files = [
    { path: '/p/-old/s1.jsonl', projectDir: '-old', mtime: 10, size: 100 },
    { path: '/p/-new/s1.jsonl', projectDir: '-new', mtime: 5, size: 300 },
    { path: '/p/-old/s2.jsonl', projectDir: '-old', mtime: 10, size: 100 },
    { path: '/p/-new/s2.jsonl', projectDir: '-new', mtime: 20, size: 100 },
    { path: '/p/-old/s3.jsonl', projectDir: '-old', mtime: 10, size: 100 },
  ];
  const kept = parser.dedupeSessionFiles(files).map((f) => f.path).sort();
  assert.deepEqual(kept, ['/p/-new/s1.jsonl', '/p/-new/s2.jsonl', '/p/-old/s3.jsonl']);
});

test('parseAllSessions counts a session that exists under two project folders once', async () => {
  const now = Date.now();
  const lines = [usageLine('dup', 1, now - 2 * HOUR), usageLine('dup', 2, now - HOUR)];
  transcript('-renamed-from', 'dup', lines);
  transcript('-renamed-to', 'dup', lines);

  const sessions = (await parser.parseAllSessions({ days: 1, noCache: true })).filter((s) => s.sessionId === 'dup');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].totals.input, 2000);
});

test('month spend leaves out what a boundary session spent before the month began', async () => {
  const now = Date.now();
  const since = now - 3 * HOUR;
  const boundary = transcript('-month', 'boundary', [
    usageLine('boundary', 1, since - 2 * HOUR, { input: 900000, out: 50000 }),
    usageLine('boundary', 2, since + HOUR, { input: 2000, out: 300 }),
  ]);
  transcript('-month', 'inside', [usageLine('inside', 1, since + 2 * HOUR, { input: 4000, out: 500 })]);
  transcript('-month', 'before', [usageLine('before', 1, since - 5 * HOUR, { input: 7000, out: 700 })]);
  const mine = (list) => list.filter((s) => ['boundary', 'inside', 'before'].includes(s.sessionId));
  const expected = estimateCost({ input: 6000, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 800 }, 'claude-opus-5').actual;
  const spend = (list) => monthSpend(list, new Date(since)).usd;

  // Fresh parse: the pass that reads the file also trims it to the month start.
  const fresh = mine(await parser.parseAllSessions({ days: 1, sinceMs: since }));
  assert.equal(fresh.length, 3);
  const trimmed = await parser.sessionsSince(fresh, since);
  assert.deepEqual(trimmed.map((s) => s.sessionId).sort(), ['boundary', 'inside']);
  assert.equal(trimmed.find((s) => s.sessionId === 'boundary').totals.input, 2000);
  assert.ok(Math.abs(spend(trimmed) - expected) < 1e-9);
  assert.ok(spend(fresh) > expected * 10, 'untrimmed, the pre-month requests dominate the total');

  // Cache hit: the summary has no per-request data, and the trimmed copy is
  // served from the slot stored beside it instead of re-reading the file.
  const stored = cache.loadCache().entries[boundary];
  assert.equal(stored.t.since, since);
  const hit = mine(await parser.parseAllSessions({ days: 1, sinceMs: since }));
  assert.equal(hit.find((s) => s.sessionId === 'boundary').sinceTrim.session.totals.input, 2000);

  // A caller that did not name the month start still gets the right answer.
  const plain = mine(await parser.parseAllSessions({ days: 1 }));
  assert.equal(plain.find((s) => s.sessionId === 'boundary').sinceTrim, undefined);
  assert.ok(Math.abs(spend(await parser.sessionsSince(plain, since)) - expected) < 1e-9);
  assert.ok(Math.abs(spend(await parser.sessionsSince(plain, since, { noCache: true })) - expected) < 1e-9);
});

const rule = (over) => ({
  status: 'active', scope: 'global', tier: 'T1', category: 'run', project: '-p1',
  label: '명령 실행', labelEn: 'running commands', example: 'ex', agent: 'sonnet',
  rule: 'r', signature: `T1|run|${over.project ?? '-p1'}|${over.scope ?? 'global'}`, count: 5, errRate: 0, ...over,
});

test('a delegated run is credited to one rule: project rule, then the global rule promoted there, then the first global', () => {
  const projectRule = rule({ scope: 'project', project: '-p3' });
  const globalA = rule({ project: '-p1' });
  const globalB = rule({ project: '-p2' });
  const list = [globalA, globalB, projectRule, rule({ project: '-p3', status: 'off' })];
  assert.equal(rules.ruleForProject(list, 'T1', 'run', '-p3'), projectRule);
  assert.equal(rules.ruleForProject(list, 'T1', 'run', '-p2'), globalB);
  assert.equal(rules.ruleForProject(list, 'T1', 'run', '-p1'), globalA);
  assert.equal(rules.ruleForProject(list, 'T1', 'run', '-elsewhere'), globalA);
  assert.equal(rules.ruleForProject(list, 'T2', 'run', '-p1'), null);
  assert.equal(rules.ruleForProject([rule({ status: 'off' })], 'T1', 'run', '-p1'), null);
});

test('two global rules of one tier and category do not both claim the same delegated runs', () => {
  rules.saveModelRules({ rules: [rule({ project: '-p1' }), rule({ project: '-home' })] });
  const stat = (runs, savedUsd) => ({ runs, errRuns: 0, outTokens: 0, savedUsd });
  const delegated = new Map([
    ['T1|run|-p1', stat(11, 30.83)],
    ['T1|run|-p9', stat(25, 81.26)],
    ['T1|run|*', stat(36, 112.09)],
  ]);
  const { rules: after } = rules.refreshModelRules(new Map(), delegated, { now: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(after.map((r) => r.delegatedRuns), [36, 0]);
  assert.equal(after.reduce((sum, r) => sum + r.savedUsd, 0), 112.09);
});

test('the ledger holds one event per run, whichever copy of its transcript was scanned', () => {
  const a = '/h/.claude/projects/-renamed-from/sid-1/subagents/agent-a.jsonl';
  const b = '/h/.claude/projects/-renamed-to/sid-1/subagents/agent-a.jsonl';
  assert.equal(ledger.runIdentity(a), ledger.runIdentity(b));
  assert.equal(ledger.runIdentity('C:\\Users\\u\\.claude\\projects\\-p\\sid-1\\subagents\\agent-a.jsonl'), 'sid-1/subagents/agent-a.jsonl');
  assert.equal(ledger.runIdentity('not-a-transcript'), 'not-a-transcript');

  // A ledger written before the fix: the same run under both paths.
  mkdirSync(join(home, 'config', 'claude-token-saver'), { recursive: true });
  const event = { ts: 1000, usd: 1.5, rule: 'T1|run|-p1', from: 'claude-opus-5', to: 'claude-sonnet-5' };
  writeFileSync(ledger.ledgerPath(), JSON.stringify({ version: ledger.LEDGER_VERSION, events: { [a]: event, [b]: event } }));
  assert.equal(ledger.delegationSavedTotals(2000).total, 1.5);

  // A rescan that now sees the other copy replaces the entry, it does not add one.
  ledger.recordDelegationEvents([{ key: b, ts: 1000, usd: 2.25, rule: 'T1|run|-p1' }]);
  const events = JSON.parse(readFileSync(ledger.ledgerPath(), 'utf8')).events;
  assert.deepEqual(Object.keys(events), [b]);
  assert.equal(ledger.delegationSavedTotals(2000).total, 2.25);
});

test('the single-line statusline shows the ledger total, not the registry sum', () => {
  const now = Date.now();
  transcript('-statusline', 'live', [usageLine('live', 1, now - HOUR)]);
  rules.saveModelRules({ rules: [rule({ delegatedRuns: 9, savedUsd: 987.65 })] });
  writeFileSync(ledger.ledgerPath(), JSON.stringify({
    version: ledger.LEDGER_VERSION,
    events: { '/x/sid-9/subagents/agent-z.jsonl': { ts: now - HOUR, usd: 12.34, from: 'claude-opus-5', to: 'claude-sonnet-5' } },
  }));
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  for (const layout of [['--single-line'], []]) {
    // CTS_NO_UPDATE_CHECK: the statusline otherwise leaves a detached child
    // asking the registry for the latest version, and that child wrote its
    // answer into the sandbox while the suite was removing it (ENOTEMPTY on a
    // macOS CI job).
    const env = childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), CTS_NO_UPDATE_CHECK: '1' });
    const run = spawnSync(process.execPath, [cli, '--statusline', '--no-color', ...layout], { input: '{}', encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Routing saved \$12\.3/, run.stdout);
    assert.doesNotMatch(run.stdout, /987|988/, run.stdout);
  }
});

test('subagent runs are priced at their own model and added to cost, without becoming sessions', async () => {
  const { sessionCostAcross } = await import('../src/claude-price.js');
  const now = Date.now();
  const since = now - 3 * HOUR;
  const agentLine = (n, ts, model) => JSON.stringify({
    requestId: `agent-r${n}`, timestamp: new Date(ts).toISOString(), sessionId: 'parent',
    message: { id: `agent-m${n}`, model, usage: { input_tokens: 50000, output_tokens: 4000 } },
  });
  // The same session under two project folders, subagents and all.
  for (const projectDir of ['-agents', '-agents-copy']) {
    transcript(projectDir, 'parent', [usageLine('parent', 1, since - HOUR), usageLine('parent', 2, since + HOUR)]);
    const dir = join(projects, projectDir, 'parent', 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-old.jsonl'), agentLine(1, since - HOUR, 'claude-haiku-4-5') + '\n');
    writeFileSync(join(dir, 'agent-new.jsonl'), agentLine(2, since + HOUR, 'claude-sonnet-5') + '\n');
    writeFileSync(join(dir, 'agent-new.meta.json'), '{}');
  }
  const cost = (totals, model) => estimateCost({ cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, ...totals }, model).actual;
  const agentTotals = { input: 50000, output: 4000 };
  const main = cost({ input: 2000, output: 200 }, 'claude-opus-5');
  const haiku = cost(agentTotals, 'claude-haiku-4-5');
  const sonnet = cost(agentTotals, 'claude-sonnet-5');
  assert.ok(haiku > 0 && sonnet > haiku);

  for (const noCache of [true, false, false]) {
    const all = (await parser.parseAllSessions({ days: 1, sinceMs: since, noCache })).filter((s) => s.sessionId === 'parent');
    assert.equal(all.length, 1, 'the subagent transcripts are not sessions of their own');
    assert.equal(all[0].requestCount, 2, 'and their requests stay out of the session totals');
    assert.deepEqual(all[0].subagentRuns.map((r) => r.model).sort(), ['claude-haiku-4-5', 'claude-sonnet-5']);
    assert.ok(Math.abs(sessionCostAcross(all).actual - (main + haiku + sonnet)) < 0.011);

    // This month: the request and the run that happened after the month began.
    const month = monthSpend(await parser.sessionsSince(all, since, { noCache }), new Date(since));
    assert.ok(Math.abs(month.usd - (cost({ input: 1000, output: 100 }, 'claude-opus-5') + sonnet)) < 1e-9);
    assert.equal(month.sessions, 1);
  }
});

test('a session that switched model is priced model by model, through the cache too', async () => {
  const { sessionCostAcross } = await import('../src/claude-price.js');
  const now = Date.now();
  const line = (n, ts, model, usage) => JSON.stringify({
    requestId: `mixed-r${n}`, timestamp: new Date(ts).toISOString(), sessionId: 'mixed',
    message: { id: `mixed-m${n}`, model, usage },
  });
  const big = { input_tokens: 400000, output_tokens: 20000 };
  const small = { input_tokens: 100000, output_tokens: 5000 };
  // Three Haiku requests and one Fable request: Haiku is the representative
  // model by count, and Fable is where the money went.
  transcript('-mixed', 'mixed', [
    line(1, now - 4 * HOUR, 'claude-haiku-4-5', small),
    line(2, now - 3 * HOUR, 'claude-haiku-4-5', small),
    line(3, now - 2 * HOUR, 'claude-haiku-4-5', small),
    line(4, now - HOUR, 'claude-fable-5', big),
  ]);
  const cost = (totals, model) => estimateCost({ cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, ...totals }, model).actual;
  const haiku = cost({ input: 300000, output: 15000 }, 'claude-haiku-4-5');
  const fable = cost({ input: 400000, output: 20000 }, 'claude-fable-5');
  const atOneRate = cost({ input: 700000, output: 35000 }, 'claude-haiku-4-5');
  assert.ok(fable > haiku * 5, 'the fixture has to make the two readings differ');

  for (const noCache of [true, false, false]) {
    const all = (await parser.parseAllSessions({ days: 1, noCache })).filter((s) => s.sessionId === 'mixed');
    assert.equal(all.length, 1);
    assert.equal(all[0].model, 'claude-haiku-4-5');
    assert.deepEqual(Object.keys(all[0].modelTotals).sort(), ['claude-fable-5', 'claude-haiku-4-5']);
    const total = sessionCostAcross(all).actual;
    assert.ok(Math.abs(total - (haiku + fable)) < 0.011, `priced ${total}, expected ${haiku + fable}`);
    assert.ok(Math.abs(total - atOneRate) > 1, 'not the whole session at the representative rate');
    const month = monthSpend(all, new Date(now));
    assert.ok(Math.abs(month.usd - (haiku + fable)) < 1e-9);
    assert.equal(month.sessions, 1, 'two priced parts are still one session');
  }

  // Cut to the last two hours: only the Fable request is left, and the split
  // goes with it.
  const recent = await parser.sessionsSince(
    await parser.parseAllSessions({ days: 1, noCache: true }).then((ss) => ss.filter((s) => s.sessionId === 'mixed')),
    now - 90 * 60 * 1000, { noCache: true });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].modelTotals, undefined);
  assert.equal(recent[0].totals.input, 400000);
});

test('a single-model session carries no per-model split', async () => {
  const now = Date.now();
  transcript('-single', 'single', [usageLine('single', 1, now - 2 * HOUR), usageLine('single', 2, now - HOUR)]);
  const [s] = (await parser.parseAllSessions({ days: 1, noCache: true })).filter((x) => x.sessionId === 'single');
  assert.equal(s.modelTotals, undefined);
});

test('zero-token <synthetic> stubs are neither API calls nor sessions', async () => {
  const now = Date.now();
  const stub = (sessionId, n, ts) => JSON.stringify({
    requestId: `${sessionId}-stub${n}`, timestamp: new Date(ts).toISOString(), sessionId,
    message: { id: `${sessionId}-stub-m${n}`, model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  transcript('-stubs', 'with-stubs', [
    usageLine('with-stubs', 1, now - 3 * HOUR), stub('with-stubs', 1, now - 2 * HOUR),
    usageLine('with-stubs', 2, now - HOUR), stub('with-stubs', 2, now - HOUR / 2),
  ]);
  transcript('-stubs', 'only-stubs', [stub('only-stubs', 1, now - 2 * HOUR), stub('only-stubs', 2, now - HOUR)]);
  for (const noCache of [true, false, false]) {
    const all = await parser.parseAllSessions({ days: 1, noCache });
    const real = all.find((s) => s.sessionId === 'with-stubs');
    assert.equal(real.requestCount, 2, 'the two stubs are not requests');
    assert.equal(real.model, 'claude-opus-5');
    assert.equal(real.modelTotals, undefined, 'a stub is not a second model');
    assert.equal(all.some((s) => s.sessionId === 'only-stubs'), false, 'a transcript of stubs alone is not a session');
  }
});
