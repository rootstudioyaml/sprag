// Regression tests for the routing findings of the 2026-10-01 review (B4–B9).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// parser.js, the rule registry and the caps record resolve their directories
// from the environment, some of them when they load, so the sandbox is set
// before the imports below.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-route-fixes-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const rs = await import('../src/route-scan.js');
const rules = await import('../src/model-rules.js');
const parser = await import('../src/parser.js');
const inject = await import('../src/route-inject.js');
const caps = await import('../src/route-caps.js');
const guard = await import('../src/delegation-guard.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const stateDir = join(home, 'config', 'claude-token-saver');
const saveRegistry = (list) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'model-rules.json'), JSON.stringify({ rules: list }));
};
const base = {
  category: 'run', label: '명령 실행', labelEn: 'running commands', agent: 'haiku-runner',
  scope: 'global', targetRoot: null, example: 'npm 인증', promotedAt: '2026-08-01', count: 5, status: 'active',
};

// ── B4 ─────────────────────────────────────────────────────────────────────

test('B4: a rule whose category left the window drops its old figures and its review flag', () => {
  saveRegistry([
    { ...base, tier: 'T1', signature: 'T1|run|-p', project: '-p', rule: 'r', status: 'review', healthSource: 'delegated',
      delegatedRuns: 7, delegatedErrRate: 0.6, savedUsd: 3.21, errRate: 0.1 },
  ]);
  const [r] = rules.refreshModelRules(new Map(), new Map(), { now: '2026-10-02T00:00:00.000Z' }).rules;
  assert.equal(r.status, 'active');
  assert.equal(r.delegatedRuns, 0);
  assert.equal(r.delegatedErrRate, 0);
  assert.equal(r.savedUsd, 0);
  assert.equal(r.healthSource, 'proxy');
  assert.equal(r.count, 5, 'the last known recurrence is kept');
  // And it reached the disk, not only the returned object.
  assert.equal(rules.loadModelRules().rules[0].status, 'active');
  assert.equal(rules.ruleHealthWarningForStatusline(null), null);
});

// ── B5 ─────────────────────────────────────────────────────────────────────

test('B5: the rescan gate measures the window the way the scan recorded it', async () => {
  const proj = join(home, '.claude', 'projects', '-gate');
  const agents = join(proj, 'sess-gate', 'subagents');
  mkdirSync(agents, { recursive: true });
  const line = JSON.stringify({ sessionId: 'sess-gate', timestamp: new Date().toISOString(),
    message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 1 } } }) + '\n';
  const parent = join(proj, 'sess-gate.jsonl');
  writeFileSync(parent, line);
  writeFileSync(join(agents, 'agent-a.jsonl'), line);

  const files = await parser.discoverSessionFiles({ days: 14 });
  const mine = files.filter((f) => f.path === parent);
  assert.equal(mine.length, 1);
  assert.equal(rs.windowBytes(mine), Buffer.byteLength(line) * 2, 'the subagent transcript is part of the window');

  // The scan ran two hours ago and recorded this window. Since then only a
  // delegation wrote anything: 6MB into a subagent transcript, with the parent
  // transcript untouched.
  const scannedAt = Date.now() - 2 * 3600 * 1000;
  const cache = { scannedAt: new Date(scannedAt).toISOString(), dataBytes: rs.windowBytes(files) };
  const old = new Date(scannedAt - 3600 * 1000);
  utimesSync(parent, old, old);
  utimesSync(join(agents, 'agent-a.jsonl'), old, old);
  assert.equal(await rs.shouldRescan(cache), false, 'nothing new since the scan');
  writeFileSync(join(agents, 'agent-b.jsonl'), 'x'.repeat(6 * 1024 * 1024));
  assert.equal(await rs.shouldRescan(cache), true, 'subagent bytes count as new data');
});

// ── B6 ─────────────────────────────────────────────────────────────────────

test('B6: the global rules file reads the same from every directory', () => {
  const project = join(home, 'work', 'with-agent');
  mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(project, '.claude', 'agents', 'haiku-runner.md'), '# agent\n');
  const elsewhere = join(home, 'work', 'plain');
  mkdirSync(elsewhere, { recursive: true });
  saveRegistry([
    { ...base, tier: 'T2', signature: 'T2|run|-g', project: '-g', rule: 'r' },
    { ...base, tier: 'T2', signature: 'T2|run|-p', project: '-p', rule: 'r', scope: 'project', targetRoot: project },
  ]);
  const globalFile = join(home, '.claude', 'ratchet-model.md');
  const cwd = process.cwd();
  try {
    process.chdir(project);
    rules.syncAllFiles();
    const fromProject = readFileSync(globalFile, 'utf8');
    process.chdir(elsewhere);
    assert.deepEqual(rules.syncAllFiles(), [], 'a second run from another directory rewrites nothing');
    assert.equal(readFileSync(globalFile, 'utf8'), fromProject);
    // The project's own agent is not one every project has, so the global file
    // names the model tier alone; the project file may name the agent.
    assert.doesNotMatch(fromProject, /haiku-runner/);
    assert.match(fromProject, /model: haiku subagent \(cap/);
    assert.match(readFileSync(join(project, '.claude', 'ratchet-model.md'), 'utf8'), /the haiku-runner \(model: haiku\) subagent/);
  } finally {
    process.chdir(cwd);
  }
});

// ── B7 ─────────────────────────────────────────────────────────────────────

test('B7: the guard tells the subagent the cap of the rule this turn matched', async () => {
  const registry = [
    { ...base, tier: 'T2', signature: 'T2|run|-g', project: '-g', rule: 'r', budget: { calls: 8, out: 1918 } },
    { ...base, tier: 'T1', signature: 'T1|run|-g', project: '-g', rule: 'r', budget: { calls: null, out: 6100 } },
  ];
  const match = inject.routeMatch('npm test 돌려줘', { rules: registry });
  assert.equal(match.cat.id, 'run');
  assert.deepEqual(inject.matchCaps(match), { T2: { calls: 8, out: 1918 }, T1: { calls: null, out: 6100 } });
  assert.match(inject.routeHint('npm test 돌려줘', { rules: registry, lang: 'ko', root: null }), /sonnet 출력 6100 토큰/);

  assert.equal(caps.routeCapsFor('sess-cap'), null);
  assert.equal(caps.recordRouteCaps('sess-cap', inject.matchCaps(match)), true);
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: false } };
  const prompt = async (tool_input, session_id = 'sess-cap') =>
    (await guard.decideForDelegation({ tool_name: 'Task', session_id, tool_input }, { cfg, home })).updatedInput.prompt;
  assert.match(await prompt({ prompt: 'run the tests', model: 'sonnet' }), /Cap for this delegation: 20 tool calls, 6,100 output tokens\./);
  assert.match(await prompt({ prompt: 'run the tests', model: 'haiku' }), /Cap for this delegation: 8 tool calls, 1,918 output tokens\./);
  // Another session, and this session after a prompt that matched nothing,
  // get the defaults.
  assert.match(await prompt({ prompt: 'run the tests', model: 'sonnet' }, 'sess-other'), /20 tool calls, 8,000 output tokens\./);
  assert.equal(caps.recordRouteCaps('sess-cap', null), true);
  assert.equal(caps.recordRouteCaps('sess-cap', null), false, 'nothing left to clear, nothing written');
  assert.match(await prompt({ prompt: 'run the tests', model: 'haiku' }), /8 tool calls, 1,500 output tokens\./);
  // A record from a turn long over is not applied.
  caps.recordRouteCaps('sess-stale', inject.matchCaps(match), Date.now() - 2 * 3600 * 1000);
  assert.equal(caps.routeCapsFor('sess-stale'), null);
});

// ── B8 ─────────────────────────────────────────────────────────────────────

test('B8: a candidate keeps its number across rescans', () => {
  const cand = (signature) => ({ signature });
  const first = [cand('a'), cand('b'), cand('c')];
  assert.equal(rs.assignCandidateIds(first, null), 3);
  assert.deepEqual(first.map((c) => c.id), [1, 2, 3]);

  // Ranks changed and a new pattern came first: the old ones keep their numbers.
  const second = [cand('new'), cand('c'), cand('a')];
  const last = rs.assignCandidateIds(second, { candidates: first, lastCandidateId: 3 });
  assert.deepEqual(second.map((c) => [c.signature, c.id]), [['new', 4], ['c', 3], ['a', 1]]);
  assert.equal(last, 4);

  // 'new' (R4) dropped out. The next arrival does not inherit R4.
  const third = [cand('c'), cand('later')];
  assert.equal(rs.assignCandidateIds(third, { candidates: [cand('c')].map((c) => ({ ...c, id: 3 })), lastCandidateId: 4 }), 5);
  assert.deepEqual(third.map((c) => c.id), [3, 5]);

  // Once the list has been empty, numbering starts over.
  const fresh = [cand('z')];
  assert.equal(rs.assignCandidateIds(fresh, { candidates: [], lastCandidateId: 9 }), 1);
  assert.equal(fresh[0].id, 1);
});

// ── B9 ─────────────────────────────────────────────────────────────────────

test('B9: a second rule of the same tier adds no line, and no line is in the wrong language', () => {
  const english = 'Delegate moderate "running commands" requests to a model: sonnet subagent';
  const md = rules.renderModelRatchet([
    { ...base, tier: 'T2', rule: 'r2', count: 11 },
    { ...base, tier: 'T1', rule: 'r1', count: 6 },
    { ...base, tier: 'T1', rule: english, count: 32, status: 'review', healthSource: 'delegated', delegatedRuns: 9, delegatedErrRate: 0.5 },
  ], 'ko', { root: null });
  const lines = md.split('\n').filter((l) => l.startsWith('- ') && l.includes('<!--'));
  assert.equal(lines.length, 1, 'one line for the category');
  assert.doesNotMatch(md, /Delegate moderate/);
  assert.match(lines[0], /^- "명령 실행": 기본 /);
  assert.match(lines[0], /rule-health: 실제 위임 9건 중 에러율 50%/, 'the folded rule keeps its review flag');
  assert.match(lines[0], /<!-- T2 ×11, .* \/ T1 ×6, .* \/ \+T1 ×32, .* -->/);

  // A lone rule is worded from the template too, whatever its stored text says.
  const lone = rules.renderModelRatchet([{ ...base, tier: 'T1', rule: english, count: 32 }], 'ko', { root: null });
  assert.match(lone, /- "명령 실행" 중간 난도 요청\(예: "npm 인증"\)은 model: sonnet에 위임 \(상한 출력 8000 토큰\)/);
  assert.doesNotMatch(lone, /Delegate moderate/);
  const en = rules.renderModelRatchet([{ ...base, tier: 'T1', rule: '한국어로 저장된 문장', count: 32 }], 'en', { root: null });
  assert.match(en, /- Moderate "running commands" requests \(e\.g\. "npm 인증"\) go to a model: sonnet subagent \(cap 8000 output tokens\)/);
});
