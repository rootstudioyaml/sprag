// Unit tests for the bulk round: select.mjs, the per-case parts of replay.mjs, reference grading and bulk.mjs.
// Fixtures only: no ledger, no claude, no network. One test writes a temp round directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { filterSnapshot, bashWriteCount, pickBalanced, templatePrompt, caseFor, roundFor, REFERENCE_RUBRIC, VERIFY_RUBRIC, kindOf } from '../scripts/evals/select.mjs';
import { planRuns, capDecision, worktreeFor, readCaps } from '../scripts/evals/replay.mjs';
import { buildReferencePrompt, buildVerifyPrompt, parseVerify, verifyArgs, planGrading, referenceScore, grade } from '../scripts/evals/grade.mjs';
import { aggregateBulk, compareRounds, noiseRound, upRound, main as bulkMain } from '../scripts/evals/bulk.mjs';
import { upround, upCase, upRoundJson } from '../scripts/evals/upround.mjs';
import { validateRound, sha10, blindOrder } from '../scripts/evals/lib.mjs';

const line = (i, over = {}) => ({
  key: `/t/agent-${i}.jsonl`, ts: 1000 + i, rule: 'T2|run|proj', to: 'claude-haiku-5-5', toFamily: 'haiku',
  usd: 0.5, cost: 0.1, cwd: '/repo/a', prompt: `task number ${i}`, ...over,
});
const deps = (tools = {}) => ({ transcriptToolNames: (k) => (k in tools ? tools[k] : ['Read']), exists: (p) => p !== '/gone' });

test('filterSnapshot drops eval cwds, missing cwds, opus, missing or writing transcripts, then duplicates', () => {
  const lines = [
    line(1), line(2, { prompt: '  task   number 1 ' }), // same prompt after whitespace normalisation: dup
    line(3, { cwd: '/x/handoff/evals-work/rounds/r/wt' }), line(4, { cwd: '/tmp/scratchpad/q' }),
    line(5, { cwd: '/gone' }), line(6, { toFamily: 'opus', to: 'claude-opus-5-5' }),
    line(7, { key: '/t/missing.jsonl' }), line(8, { key: '/t/w.jsonl' }), line(9, { key: '/t/nb.jsonl' }), line(10),
  ];
  const { kept, dropped } = filterSnapshot(lines, deps({ '/t/missing.jsonl': null, '/t/w.jsonl': ['Read', 'Edit'], '/t/nb.jsonl': ['NotebookEdit'] }));
  assert.deepEqual(kept.map((e) => e.ts), [1001, 1010]);
  assert.deepEqual(dropped, { excluded: 0, evalCwd: 2, missingCwd: 1, model: 1, noTranscript: 1, writeTools: 2, bashWrites: 0, dup: 1 });
});

test('filterSnapshot keeps the earliest of duplicate prompts', () => {
  const { kept } = filterSnapshot([line(5, { prompt: 'same' }), line(2, { prompt: 'same' })], deps());
  assert.deepEqual(kept.map((e) => e.ts), [1002]);
});

test('pickBalanced is deterministic and proportional by kind', () => {
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(line(i, { rule: 'T2|run|p' }));
  for (let i = 60; i < 90; i++) pool.push(line(i, { rule: 'T1|check|p' }));
  for (let i = 90; i < 100; i++) pool.push(line(i, { rule: 'T2|explore|p' }));
  const a = pickBalanced(pool, 20, 7), b = pickBalanced([...pool].reverse(), 20, 7);
  assert.deepEqual(a.map((e) => e.key), b.map((e) => e.key), 'input order does not matter');
  const count = (xs) => xs.reduce((m, e) => { m[kindOf(e)] = (m[kindOf(e)] || 0) + 1; return m; }, {});
  assert.deepEqual(count(a), { run: 12, check: 6, explore: 2 });
  assert.notDeepEqual(pickBalanced(pool, 20, 8).map((e) => e.key), a.map((e) => e.key), 'another seed picks others');
  assert.equal(pickBalanced(pool, 7, 1).length, 7, 'largest remainder fills the rounding gap');
  assert.equal(pickBalanced(pool, 500, 1).length, 100, 'n above the pool takes everything');
});

test('templatePrompt replaces the deeper cwd first, then the repo root, and not a longer sibling path', () => {
  const t = templatePrompt('cd /r/app/web && cat /r/app/README.md; ls /r/app-team', '/r/app', '/r/app/web');
  assert.equal(t, 'cd {{REPO}}/web && cat {{REPO}}/README.md; ls /r/app-team');
});

test('templatePrompt replaces a root that ends a sentence, and not a root followed by a dotted name', () => {
  assert.equal(templatePrompt('Read-only lookup in /r/app. Then /r/app.git and /r/app.bak stay.', '/r/app'), 'Read-only lookup in {{REPO}}. Then /r/app.git and /r/app.bak stay.');
});

test('caseFor and roundFor build a round that validates, with lanes and agents by family and kind', () => {
  const h = caseFor(line(1, { rule: 'T2|run|p' }), { repo: '/r/a', commit: 'abc1234' });
  const e = caseFor(line(2, { rule: 'T2|explore|p' }), { repo: '/r/a', commit: 'abc1235' });
  const s = caseFor(line(3, { rule: 'T1|check|p', toFamily: 'sonnet', to: 'claude-sonnet-5-5' }), { repo: '/r/b', commit: 'def5678' });
  assert.deepEqual([h.conditions, h.agents], [['A', 'B'], { A: 't2-runner' }]);
  assert.deepEqual(e.agents, { A: 't2-explore' });
  assert.deepEqual([s.conditions, s.agents], [['S', 'B'], { S: 't1-worker' }]);
  assert.deepEqual(Object.keys(s.meta), ['kind', 'tier', 'to', 'ledgerUsd', 'ledgerCost', 'ts', 'bashWrites']);
  assert.ok(!JSON.stringify([h, e, s]).includes('task number'), 'no prompt text in round.json');
  const r = roundFor('r3-bulk-x', [h, e, s], '2026-11-08');
  assert.deepEqual([r.repo, r.commit, r.grading, r.capStopPct, r.tier], ['/r/a', 'abc1235', 'reference', 85, 'numbers']);
  assert.deepEqual(validateRound(r), []);
  assert.match(REFERENCE_RUBRIC, /max는 2/);
});

test('validateRound checks the new case and round fields', () => {
  const r = roundFor('r', [caseFor(line(1), { repo: '/r/a', commit: 'abc1234' })], '2026-11-08');
  const bad = (mut) => { const x = structuredClone(r); mut(x); return validateRound(x).join('\n'); };
  assert.match(bad((x) => { x.cases[0].repo = 'rel/path'; }), /repo must be an absolute path/);
  assert.match(bad((x) => { x.cases[0].commit = 'HEAD'; }), /commit must be a hex sha/);
  assert.match(bad((x) => { delete x.cases[0].commit; }), /repo and commit go together/);
  assert.match(bad((x) => { x.cases[0].conditions = ['A', 'Z']; }), /conditions must be a non-empty array of condition keys/);
  assert.match(bad((x) => { x.cases[0].conditions = []; }), /conditions must be/);
  assert.match(bad((x) => { x.cases[0].meta = []; }), /meta must be an object/);
  assert.match(bad((x) => { x.grading = 'vibes'; }), /grading must be/);
  assert.match(bad((x) => { x.capStopPct = 40; }), /capStopPct/);
  assert.match(bad((x) => { x.capStopPct = 85.5; }), /capStopPct/);
  assert.match(bad((x) => { x.tier = 'all'; }), /tier must be/);
  assert.equal(bad((x) => { delete x.grading; delete x.capStopPct; delete x.tier; }), '', 'all optional');
});

test('planRuns honours case.conditions; worktreeFor picks the case worktree when it has repo and commit', () => {
  const r = roundFor('r', [caseFor(line(1), { repo: '/r/a', commit: 'abc1234' }), caseFor(line(2, { toFamily: 'sonnet' }), { repo: '/r/b', commit: 'abc1235' })], '2026-11-08');
  r.cases.push({ id: 'plain', prompt: 'cases/p.md', rubric: 'rubric/p.md' });
  const keys = planRuns(r).map((x) => x.key);
  const [h, s] = r.cases;
  assert.deepEqual(keys, [`${h.id}-A`, `${h.id}-B`, `${s.id}-S`, `${s.id}-B`, 'plain-A', 'plain-S', 'plain-B']);
  assert.deepEqual(worktreeFor('/rd', r, h), { wt: join('/rd', 'wt', h.id), repo: '/r/a', commit: 'abc1234' });
  assert.deepEqual(worktreeFor('/rd', r, r.cases[2]), { wt: join('/rd', 'wt'), repo: r.repo, commit: r.commit });
});

test('capDecision stops on the seven-day window and waits out a full five-hour window', () => {
  const now = 1_000_000_000_000;
  const caps = (f, s, reset = now / 1000 + 600) => ({ fiveHour: f == null ? null : { usedPct: f, resetsAt: reset }, sevenDay: s == null ? null : { usedPct: s, resetsAt: null } });
  assert.deepEqual(capDecision(caps(10, 85), 85, now), { action: 'stop' });
  assert.deepEqual(capDecision(caps(96, 50), 85, now), { action: 'wait', untilMs: now + 660e3 });
  assert.deepEqual(capDecision(caps(96, 50, now / 1000 - 120), 85, now), { action: 'go' }, 'a reset already passed');
  assert.deepEqual(capDecision(caps(null, null), 85, now), { action: 'go' }, 'no snapshot');
  assert.deepEqual(capDecision(caps(10, 99), null, now), { action: 'go' }, 'no capStopPct');
});

test('reference grading: the baseline report is the answer key and only the other reports get labels', () => {
  const p = buildReferencePrompt({ task: 'Find X', rubric: REFERENCE_RUBRIC, reference: 'X is in a.js', reports: [{ label: 'P', text: 'X is in b.js' }] });
  assert.ok(p.indexOf('# 기준 보고서') < p.indexOf('# Reports'));
  assert.match(p, /# 기준 보고서\n\nX is in a\.js/);
  assert.match(p, /keys are the report labels \(P\)/);

  const dir = mkdtempSync(join(tmpdir(), 'sprag-bulk-'));
  try {
    for (const d of ['cases', 'rubric', 'reports']) mkdirSync(join(dir, d));
    const r = roundFor('r', [caseFor(line(1), { repo: '/r/a', commit: 'abc1234' })], '2026-11-08');
    const id = r.cases[0].id;
    writeFileSync(join(dir, r.cases[0].prompt), 'Find X in {{REPO}}');
    writeFileSync(join(dir, r.cases[0].rubric), REFERENCE_RUBRIC);
    writeFileSync(join(dir, 'reports', `${id}-B.md`), 'REFERENCE TEXT');
    assert.deepEqual(planGrading(dir, r), [], 'a baseline alone is not graded');
    writeFileSync(join(dir, 'reports', `${id}-A.md`), 'LANE TEXT');
    const [plan] = planGrading(dir, r);
    assert.equal(plan.refKey, `${id}-B`);
    assert.deepEqual(Object.values(plan.labels), [`${id}-A`]);
    assert.match(plan.prompt, /# 기준 보고서\n\nREFERENCE TEXT/);
    assert.equal(plan.prompt.match(/^## Report /gm).length, 1);
    assert.deepEqual(referenceScore(id, 2), { verdict: 'ok', score: 2, max: 2, total: 2, relay: '예', reference: true, label: `${id}-ref` });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregateBulk counts cases with a graded lane and baseline, by kind, with rounded money and seconds', () => {
  const r = roundFor('r3', [
    caseFor(line(1, { rule: 'T2|run|p' }), { repo: '/r/a', commit: 'abc1234' }),
    caseFor(line(2, { rule: 'T1|check|p', toFamily: 'sonnet' }), { repo: '/r/a', commit: 'abc1234' }),
    caseFor(line(3, { rule: 'T2|run|p' }), { repo: '/r/a', commit: 'abc1234' }),
  ], '2026-11-08');
  const [a, b, c] = r.cases.map((x) => x.id);
  const runs = {
    [`${a}-A`]: { case: a, condition: 'haiku-low' }, [`${a}-B`]: { case: a, condition: 'opus-direct' },
    [`${b}-S`]: { case: b, condition: 'sonnet-high' }, [`${b}-B`]: { case: b, condition: 'opus-direct' },
    [`${c}-A`]: { case: c, condition: 'haiku-low' }, // no baseline: left out
  };
  const cost = {
    [`${a}-A`]: { usd: 0.11111, ms: 1500 }, [`${a}-B`]: { usd: 1.23456, ms: 60400 },
    [`${b}-S`]: { usd: 0.5, ms: 2000 }, [`${b}-B`]: { usd: 2, ms: 3000 }, [`${c}-A`]: { usd: 9, ms: 1 },
  };
  const scores = {
    [`${a}-A`]: { relay: '부분', total: 1, max: 2 }, [`${a}-B`]: referenceScore(a, 2),
    [`${b}-S`]: { relay: '예', total: 2, max: 2 }, [`${b}-B`]: referenceScore(b, 2), [`${c}-A`]: { relay: '아니오' },
  };
  const other = { round: { ...r, id: 'old', tier: 'detail' }, runs, cost, scores };
  const agg = aggregateBulk([{ round: r, runs, cost, scores }, other]);
  assert.equal(agg.cases.length, 2); delete agg.cases;
  assert.deepEqual(agg, {
    rounds: ['r3'], n: 2,
    byKind: {
      check: { n: 1, ok: 1, partial: 0, fail: 0, pickUsd: 0.5, opusUsd: 2, pickSec: 2, opusSec: 3 },
      run: { n: 1, ok: 0, partial: 1, fail: 0, pickUsd: 0.1111, opusUsd: 1.2346, pickSec: 2, opusSec: 60 },
    },
    totals: { n: 2, ok: 1, partial: 1, fail: 0, pickUsd: 0.6111, opusUsd: 3.2346, pickSec: 4, opusSec: 63 },
    pickModels: { haiku: 1, sonnet: 1 },
  });
  assert.ok(!/\/r\/a|proj|task number/.test(JSON.stringify(agg)), 'no paths, rule names or prompts');
});

test('a hand-set meta.recheck replaces the blind verdict in every count and keeps the first grade on the row', () => {
  const r = roundFor('r3', [
    caseFor(line(1, { rule: 'T2|run|p' }), { repo: '/r/a', commit: 'abc1234' }),
    caseFor(line(2, { rule: 'T2|run|p' }), { repo: '/r/a', commit: 'abc1234' }),
  ], '2026-11-08');
  const [a, b] = r.cases.map((x) => x.id);
  const runs = {
    [`${a}-A`]: { case: a, condition: 'haiku-low' }, [`${a}-B`]: { case: a, condition: 'opus-direct' },
    [`${b}-A`]: { case: b, condition: 'haiku-low' }, [`${b}-B`]: { case: b, condition: 'opus-direct' },
  };
  const cost = { [`${a}-A`]: { usd: 1, ms: 1000 }, [`${a}-B`]: { usd: 2, ms: 1000 }, [`${b}-A`]: { usd: 1, ms: 1000 }, [`${b}-B`]: { usd: 2, ms: 1000 } };
  const scores = {
    [`${a}-A`]: { relay: '아니오', total: 0, max: 2 }, [`${a}-B`]: referenceScore(a, 2),
    [`${b}-A`]: { relay: '아니오', total: 0, max: 2 }, [`${b}-B`]: referenceScore(b, 2),
  };
  const before = aggregateBulk([{ round: r, runs, cost, scores }]);
  assert.deepEqual([before.totals.ok, before.totals.fail, before.totals.rechecked], [0, 2, undefined]);
  assert.ok(before.cases.every((x) => !('graded' in x) && !('opusVerdict' in x)), 'rows gain no keys without a recheck');

  r.cases[0].meta.recheck = { verdict: 'ok', baseline: 'fail', cause: 'ref' };
  r.cases[1].meta.recheck = { verdict: 'maybe' }; // not a verdict: ignored
  const loaded = { round: r, runs, cost, scores };
  const agg = aggregateBulk([loaded]);
  assert.deepEqual([agg.totals.ok, agg.totals.partial, agg.totals.fail, agg.totals.rechecked], [1, 0, 1, 1]);
  assert.equal(agg.byKind.run.rechecked, 1);
  assert.deepEqual(agg.cases.map((x) => [x.verdict, x.graded, x.opusVerdict, x.recheck]), [['ok', 'fail', 'fail', 'ref'], ['fail', undefined, undefined, undefined]]);
  // the same correction reaches the rule comparison and the noise floor, which read cases through caseOutcome
  assert.deepEqual([noiseRound(loaded).ok, noiseRound(loaded).fail], [1, 1]);
  const cmp = compareRounds([loaded, loaded]);
  assert.deepEqual(cmp.steps.map((s) => [s.ok, s.fail]), [[1, 1], [1, 1]]);
});

test('replay --yes: per-case worktree, one retry after a rate limit, --max-runs, cap stop and caps.jsonl', async () => {
  const { EventEmitter } = await import('node:events');
  const { readFileSync, existsSync } = await import('node:fs');
  const { replay } = await import('../scripts/evals/replay.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'sprag-bulk-replay-'));
  try {
    for (const d of ['cases', 'rubric']) mkdirSync(join(dir, d));
    const r = roundFor('r', [caseFor(line(1), { repo: '/r/a', commit: 'abc1234' }), caseFor(line(2), { repo: '/r/a', commit: 'abc1234' })], '2026-11-08');
    for (const c of r.cases) { writeFileSync(join(dir, c.prompt), 'look in {{REPO}}/src'); writeFileSync(join(dir, c.rubric), REFERENCE_RUBRIC); }
    writeFileSync(join(dir, 'round.json'), JSON.stringify(r));
    const gitCalls = []; const git = (args) => { gitCalls.push(args); mkdirSync(args[5], { recursive: true }); };
    const prompts = []; let n = 0;
    const spawn = (cmd, args, opts) => {
      const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter();
      const call = ++n;
      ch.stdin = { on() {}, end(p) {
        prompts.push([opts.cwd, p]);
        setImmediate(() => {
          if (call === 1) { ch.stderr.emit('data', 'API Error: 429 rate_limit_error'); ch.emit('close', 1); return; }
          ch.stdout.emit('data', JSON.stringify({ result: `report ${call}` })); ch.emit('close', 0);
        });
      } };
      return ch;
    };
    const sleeps = []; let pct = 10;
    const caps = () => ({ fiveHour: { usedPct: 5, resetsAt: null }, sevenDay: { usedPct: pct, resetsAt: null } });
    const res = await replay(dir, { yes: true, spawn, git, caps, sleep: async (ms) => { sleeps.push(ms); }, log() {}, costFilesList: [], maxRuns: 2, retryWaitMs: 5 });
    assert.equal(res.started, 2);
    assert.deepEqual(gitCalls, [['-C', '/r/a', 'worktree', 'add', '--detach', join(dir, 'wt', r.cases[0].id), 'abc1234']]);
    assert.deepEqual(sleeps, [5], 'one wait before the retry');
    assert.equal(prompts.length, 3, 'the rate-limited run ran twice');
    assert.equal(prompts[0][1], `look in ${join(dir, 'wt', r.cases[0].id)}/src`);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'))).sort(), [`${r.cases[0].id}-A`, `${r.cases[0].id}-B`].sort());

    pct = 90; // seven-day window over capStopPct 85: nothing more is dispatched
    const again = await replay(dir, { yes: true, spawn, git, caps, sleep: async () => {}, log() {}, costFilesList: [] });
    assert.deepEqual([again.started, again.stopped], [0, true]);
    const events = readFileSync(join(dir, 'caps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
    assert.deepEqual(events, ['start', 'rate-limit-wait', 'end', 'start', 'stop', 'end']);
    assert.ok(existsSync(join(dir, 'reports', `${r.cases[0].id}-A.md`)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const bashEntry = (command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });

test('bashWriteCount counts only assistant Bash commands that write', () => {
  const entries = [
    bashEntry('ls -la && grep -rn foo src'), bashEntry('git status; git diff'), bashEntry('cat a.txt | head'),
    bashEntry('node x.mjs > /dev/null 2>&1'), bashEntry('curl -s url >/dev/null'),
    bashEntry('sed -i "" s/a/b/ f.txt'), bashEntry('echo hi > out.txt'), bashEntry('git log && git commit -m x'),
    bashEntry('mkdir -p /tmp/x'), bashEntry('npm install left-pad'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { command: 'rm -rf x' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'rm x' } }] } },
  ];
  assert.equal(bashWriteCount(entries), 5);
  assert.equal(bashWriteCount([]), 0);
  assert.equal(bashWriteCount(null), 0);
});

test('filterSnapshot drops Bash-writing transcripts and excluded case ids, and counts both', () => {
  const lines = [line(1), line(2), line(3), line(4)];
  const entries = { '/t/agent-2.jsonl': [bashEntry('tee out.log')], '/t/agent-1.jsonl': [bashEntry('git diff --stat')] };
  const { kept, dropped } = filterSnapshot(lines, {
    transcriptEntries: (k) => entries[k] ?? [bashEntry('ls')], exists: () => true, excludedIds: new Set([sha10('/t/agent-3.jsonl')]),
  });
  assert.deepEqual(kept.map((e) => e.ts), [1001, 1004]);
  assert.equal(dropped.bashWrites, 1);
  assert.equal(dropped.excluded, 1);
});

test('filterSnapshot counts a transcript that is gone as noTranscript when only transcriptEntries is given', () => {
  const { kept, dropped } = filterSnapshot([line(1), line(2)], {
    transcriptEntries: (k) => (k === '/t/agent-1.jsonl' ? null : [bashEntry('ls')]), exists: () => true,
  });
  assert.deepEqual(kept.map((e) => e.ts), [1002]);
  assert.equal(dropped.noTranscript, 1);
});

const caps200 = (body) => async () => ({ status: 200, json: async () => body });
const usageBody = { five_hour: { utilization: 42.5, resets_at: '2026-11-08T12:00:00Z' }, seven_day: { utilization: 61, resets_at: '2026-11-12T00:00:00Z' } };
const capsFile = (windows) => { const d = mkdtempSync(join(tmpdir(), 'caps-')); const f = join(d, 'last-caps.json'); writeFileSync(f, JSON.stringify({ capturedAt: 'x', caps: { windows } })); return f; };

test('readCaps reads the usage API and maps it to the pacing shape', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { status: 200, json: async () => usageBody }; };
  const c = await readCaps({ fetchImpl, token: 'tok', file: '/nonexistent', cache: { at: 0, value: null }, now: () => 1e12 });
  assert.equal(c.source, 'api');
  assert.deepEqual(c.fiveHour, { usedPct: 42.5, resetsAt: Date.parse('2026-11-08T12:00:00Z') / 1000 });
  assert.equal(c.sevenDay.usedPct, 61);
  assert.equal(seen.url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(seen.init.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(seen.init.headers.authorization, 'Bearer tok');
  const nul = await readCaps({ fetchImpl: caps200({ five_hour: null, seven_day: { utilization: 3, resets_at: null } }), token: 't', cache: { at: 0, value: null } });
  assert.equal(nul.fiveHour, null);
  assert.deepEqual(nul.sevenDay, { usedPct: 3, resetsAt: null });
});

test('readCaps falls back to the snapshot file on no token, non-200, network error or a malformed body', async () => {
  const file = capsFile([{ key: 'five_hour', usedPct: 12, resetsAt: 1700000000 }, { key: 'seven_day', usedPct: 34 }]);
  const cases = {
    'no token': { token: null, fetchImpl: caps200(usageBody) },
    'http 429': { token: 't', fetchImpl: async () => ({ status: 429, json: async () => ({}) }) },
    'network error': { token: 't', fetchImpl: async () => { throw new Error('boom'); } },
    'malformed body': { token: 't', fetchImpl: caps200({ five_hour: { utilization: 'abc' }, seven_day: null }) },
    'unrelated body': { token: 't', fetchImpl: caps200({ hello: 1 }) },
    'bad json': { token: 't', fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('bad'); } }) },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const c = await readCaps({ ...opts, file, cache: { at: 0, value: null } });
    assert.equal(c.source, 'file', name);
    assert.deepEqual([c.fiveHour, c.sevenDay], [{ usedPct: 12, resetsAt: 1700000000 }, { usedPct: 34, resetsAt: null }], name);
  }
});

test('readCaps caches for 60 seconds, then asks again', async () => {
  let calls = 0; let t = 1e12; const cache = { at: 0, value: null };
  const fetchImpl = async () => { calls++; return { status: 200, json: async () => usageBody }; };
  const read = () => readCaps({ fetchImpl, token: 't', cache, now: () => t });
  await read(); t += 59e3; await read();
  assert.equal(calls, 1, 'second read inside the window is cached');
  t += 2e3; await read();
  assert.equal(calls, 2, 'after 60 s it fetches again');
});

test('compareRounds takes the cases graded in every round and sums per round', () => {
  const conds = [
    { key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', prompt: 'original' },
    { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
    { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
  ];
  const base = { 'k-B': { case: 'k', condition: 'opus-direct' }, 'a-B': { case: 'a', condition: 'opus-direct' }, 'b-B': { case: 'b', condition: 'opus-direct' } };
  const ref = { verdict: 'ok', reference: true };
  const r1 = { round: { id: 'r1', tier: 'numbers', conditions: conds, cases: [
    { id: 'k', conditions: ['B'] }, { id: 'a', conditions: ['A', 'B'] }, { id: 'b', conditions: ['A', 'B'] }, { id: 'only1', conditions: ['A', 'B'] },
  ] },
  runs: { ...base, 'a-A': { case: 'a', condition: 'haiku-low' }, 'b-A': { case: 'b', condition: 'haiku-low' }, 'only1-A': { case: 'only1', condition: 'haiku-low' }, 'only1-B': { case: 'only1', condition: 'opus-direct' } },
  cost: { 'k-B': { usd: 2, ms: 4000 }, 'a-B': { usd: 1, ms: 1000 }, 'b-B': { usd: 1.5, ms: 1000 }, 'a-A': { usd: 0.1, ms: 2000 }, 'b-A': { usd: 0.2, ms: 3000 }, 'only1-A': { usd: 9, ms: 1000 }, 'only1-B': { usd: 9, ms: 1000 } },
  scores: { 'k-B': ref, 'a-B': ref, 'b-B': ref, 'only1-B': ref, 'a-A': { relay: '예' }, 'b-A': { relay: '아니오' }, 'only1-A': { relay: '예' } } };
  const r2 = { round: { id: 'r2', rule: 'v2', tier: 'numbers', conditions: conds, cases: [
    { id: 'k', conditions: ['B'] }, { id: 'a', conditions: ['S', 'B'] }, { id: 'b', conditions: ['S', 'B'] }, { id: 'only2', conditions: ['S', 'B'] },
  ] },
  runs: { ...base, 'a-S': { case: 'a', condition: 'sonnet-high' }, 'b-S': { case: 'b', condition: 'sonnet-high' }, 'only2-S': { case: 'only2', condition: 'sonnet-high' } },
  cost: { 'k-B': { usd: 2, ms: 4000 }, 'a-B': { usd: 1, ms: 1000 }, 'b-B': { usd: 1.5, ms: 1000 }, 'a-S': { usd: 0.3, ms: 5000 }, 'b-S': { usd: 0.4, ms: 6000 }, 'only2-S': { usd: 9, ms: 1000 } },
  scores: { 'k-B': ref, 'a-B': ref, 'b-B': ref, 'a-S': { relay: '예' }, 'b-S': { relay: '부분' }, 'only2-S': { relay: '예' } } };
  r1.round.rule = undefined;
  const cmp = compareRounds([r1, r2]);
  assert.deepEqual(cmp, {
    n: 3, opusUsd: 4.5,
    steps: [
      { round: 'r1', rule: 'v0', ok: 2, partial: 0, fail: 1, pickUsd: 2.3, pickSec: 9 },
      { round: 'r2', rule: 'v2', ok: 2, partial: 1, fail: 0, pickUsd: 2.7, pickSec: 15 },
    ],
  });
  assert.deepEqual(compareRounds([r2, r1]).steps.map((t) => t.round), ['r2', 'r1']);
});

test('noiseRound counts the second Opus run against the first, skipping excluded and ungraded cases', () => {
  const conds = [
    { key: 'O', id: 'opus-again', model: 'claude-opus-5-5', effort: 'high', prompt: 'original' },
    { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
  ];
  const ids = ['a', 'b', 'c', 'x', 'u'];
  const runs = Object.fromEntries(ids.flatMap((id) => [[`${id}-O`, { case: id, condition: 'opus-again' }], [`${id}-B`, { case: id, condition: 'opus-direct' }]]));
  const cost = Object.fromEntries(Object.keys(runs).map((k) => [k, { usd: k.endsWith('-O') ? 1.25 : 1, ms: 1000 }]));
  const ref = { verdict: 'ok', reference: true };
  const scores = { 'a-B': ref, 'b-B': ref, 'c-B': ref, 'x-B': ref, 'u-B': ref, 'a-O': { relay: '예' }, 'b-O': { relay: '부분' }, 'c-O': { relay: '아니오' }, 'x-O': { relay: '예' } };
  const round = { id: 'r7', tier: 'numbers', conditions: conds, cases: [
    { id: 'a', conditions: ['O', 'B'] }, { id: 'b', conditions: ['O', 'B'] }, { id: 'c', conditions: ['O', 'B'] },
    { id: 'x', conditions: ['O', 'B'], meta: { excluded: 'prompt leaks a home path' } }, { id: 'u', conditions: ['O', 'B'] },
  ] };
  assert.deepEqual(noiseRound({ round, runs, cost, scores }), { round: 'r7', n: 3, ok: 1, partial: 1, fail: 1, pickUsd: 3.75, opusUsd: 3 });
});

// ---- verify grading and the up round ----

const verifyReply = (labels, over = {}) => JSON.stringify({ result: JSON.stringify({
  checks: [{ claim: 'X is in a.js', result: 'true', evidence: 'grep hit' }],
  reports: Object.fromEntries(labels.map((l, i) => [l, { verdict: ['ok', 'partial', 'fail'][i % 3], verified: 3 - i, wrong: i, missed: i, key_miss: i ? 'missed a.js' : '', ...over }])),
}) });

test('buildVerifyPrompt strips model lines, lists every label and has no reference section', () => {
  const p = buildVerifyPrompt({ task: 'Find X\nRun with effort high\nin <repo>', reports: [
    { label: 'P', text: 'X is in a.js\nWritten by claude-opus-5-5' }, { label: 'Q', text: 'X is in b.js (sonnet said so)' }, { label: 'R', text: 'no idea' },
  ] });
  assert.doesNotMatch(p, /opus|sonnet|effort high/i);
  assert.match(p, /## Report P\n\nX is in a\.js/);
  assert.equal(p.match(/^## Report /gm).length, 3);
  assert.match(p, /labels \(P, Q, R\)/);
  assert.doesNotMatch(p, /기준 보고서/);
  assert.match(p, /unverified/);
  assert.match(p, /"verdict": "ok" \| "partial" \| "fail"/);
  assert.ok(p.indexOf('# Task') < p.indexOf('# Reports') && p.indexOf('# Reports') < p.indexOf('# Output'));
  // One argument per tool, as replay.mjs passes them.
  assert.deepEqual(verifyArgs().slice(-4), ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit']);
  const a = verifyArgs(); const i = a.indexOf('--allowedTools');
  assert.deepEqual(a.slice(i + 1, i + 7), ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch']);
});

test('parseVerify reads the envelope, and reports a missing label, a bad verdict, bad counts and API errors', () => {
  const ok = parseVerify(verifyReply(['P', 'Q', 'R']), ['P', 'Q', 'R']);
  assert.equal(ok.errors, undefined);
  assert.deepEqual(ok.reports.Q, { verdict: 'partial', verified: 2, wrong: 1, missed: 1, key_miss: 'missed a.js' });
  assert.equal(ok.checks.length, 1);
  assert.deepEqual(parseVerify('prefix ' + JSON.stringify({ reports: { P: { verdict: 'ok', verified: 1, wrong: 0, missed: 0 } } }), ['P']).reports.P.key_miss, '', 'raw text, key_miss defaults');
  assert.deepEqual(parseVerify(verifyReply(['P', 'Q']), ['P', 'Q', 'R']).errors, ['missing label R']);
  assert.deepEqual(parseVerify(verifyReply(['P'], { verdict: 'great' }), ['P']).errors, ['P: verdict invalid']);
  assert.deepEqual(parseVerify(verifyReply(['P'], { wrong: -1 }), ['P']).errors, ['P: wrong invalid']);
  assert.match(parseVerify(JSON.stringify({ result: 'no json here' }), ['P']).errors[0], /no JSON object/);
  assert.match(parseVerify(JSON.stringify({ is_error: true, result: 'rate limit' }), ['P']).errors[0], /rate limit/);
});

const srcRoundFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-up-'));
  const src = roundFor('src', [caseFor(line(1), { repo: '/r/a', commit: 'abc1234' }), caseFor(line(2), { repo: '/r/a', commit: 'abc1234' })], '2026-11-08');
  const [a, b] = src.cases.map((c) => c.id);
  for (const d of ['cases', 'rubric', 'reports', 'transcripts']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'round.json'), JSON.stringify(src));
  for (const c of src.cases) { writeFileSync(join(dir, c.prompt), 'Find X in {{REPO}} and /r/a/lib.js'); writeFileSync(join(dir, c.rubric), REFERENCE_RUBRIC); }
  // Only case a has a baseline run.
  writeFileSync(join(dir, 'reports', `${a}-B.md`), 'BASE A'); writeFileSync(join(dir, 'transcripts', `${a}-B.jsonl`), '{}\n');
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({ [`${a}-B`]: { case: a, condition: 'opus-direct' } }));
  writeFileSync(join(dir, 'cost.json'), JSON.stringify({ [`${a}-B`]: { usd: 2, ms: 4000 } }));
  writeFileSync(join(dir, 'scores_by_run.json'), JSON.stringify({ [`${a}-B`]: { verdict: 'ok', reference: true } }));
  return { dir, src, a, b };
};

test('upround writes a verify round that validates and copies the baseline run, not its reference score', () => {
  const { dir, a, b } = srcRoundFixture(); const root = mkdtempSync(join(tmpdir(), 'sprag-up-out-'));
  try {
    const logs = [];
    const r = upround(dir, { id: 'r8-up', cases: [a, b], root, date: '2026-11-09', log: (m) => logs.push(m) });
    const out = join(root, 'r8-up');
    const round = JSON.parse(readFileSync(join(out, 'round.json'), 'utf8'));
    assert.deepEqual(validateRound(round), []);
    assert.equal(round.grading, 'verify'); assert.equal(round.rule, 'up-v1'); assert.equal(round.tier, 'numbers'); assert.equal(round.baselineFrom, 'src');
    assert.deepEqual(round.conditions.map((c) => [c.key, c.id, c.model, c.effort, c.role ?? null, c.agent ?? null]), [
      ['S', 'sonnet-high', 'claude-sonnet-5-5', 'high', null, null], ['B', 'opus-direct', 'claude-opus-5-5', 'high', 'baseline', null], ['H', 'opus-xhigh', 'claude-opus-5-5', 'xhigh', null, null]]);
    assert.deepEqual(round.cases[0].conditions, ['S', 'B', 'H']);
    assert.equal(round.cases[0].repo, '/r/a'); assert.equal(round.cases[0].meta.sourceRound, 'src'); assert.equal(round.cases[0].meta.kind, 'run');
    assert.equal(readFileSync(join(out, `cases/${a}.md`), 'utf8'), 'Find X in {{REPO}} and {{REPO}}/lib.js');
    assert.equal(readFileSync(join(out, `rubric/${a}.md`), 'utf8'), VERIFY_RUBRIC);
    // 2 cases x 3 conditions, minus the one copied baseline run.
    assert.equal(r.planned, 5); assert.equal(r.reused, 1);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(out, 'runs.json'), 'utf8'))), [`${a}-B`]);
    assert.equal(JSON.parse(readFileSync(join(out, 'cost.json'), 'utf8'))[`${a}-B`].usd, 2);
    assert.equal(readFileSync(join(out, `reports/${a}-B.md`), 'utf8'), 'BASE A');
    assert.ok(existsSync(join(out, `transcripts/${a}-B.jsonl`)));
    assert.ok(!existsSync(join(out, 'scores_by_run.json')), 'the reference score is not copied');
    assert.ok(!existsSync(join(out, `reports/${b}-B.md`)));
    assert.throws(() => upround(dir, { id: 'r8-up', cases: [a], root }), /already exists/);
    assert.throws(() => upround(dir, { id: 'x', cases: ['nope'], root }), /not in the source round/);
    const fresh = upround(dir, { id: 'r8-fresh', cases: [a, b], root, freshBaseline: true, log: () => {} });
    assert.equal(fresh.planned, 6); assert.equal(fresh.reused, 0);
    assert.ok(!existsSync(join(root, 'r8-fresh', `reports/${a}-B.md`)));
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'r8-fresh', 'runs.json'), 'utf8')), {});
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

const upRoundDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-verify-'));
  const round = upRoundJson({ id: 'src', repo: '/r/a', commit: 'abc1234' }, ['c1', 'c2'].map((id) => upCase({ id, repo: '/r/a', commit: 'abc1234', meta: { kind: 'read' } }, 'src')), { id: 'r8-up', date: '2026-11-09' });
  for (const d of ['cases', 'rubric', 'reports']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'round.json'), JSON.stringify(round));
  for (const c of round.cases) {
    writeFileSync(join(dir, c.prompt), 'Find X in {{REPO}}'); writeFileSync(join(dir, c.rubric), VERIFY_RUBRIC);
    for (const k of ['S', 'B', 'H']) writeFileSync(join(dir, 'reports', `${c.id}-${k}.md`), `report ${c.id} ${k}`);
  }
  return { dir, round };
};

test('planGrading in a verify round grades every report of a case, baseline included, under reproducible blind labels', () => {
  const { dir, round } = upRoundDir();
  try {
    const plan = planGrading(dir, round);
    assert.equal(plan.length, 2);
    const p = plan[0];
    assert.deepEqual(Object.values(p.labels).sort(), ['c1-B', 'c1-H', 'c1-S']);
    assert.deepEqual(p.labels, blindOrder('r8-up', 'c1', ['c1-S', 'c1-B', 'c1-H']));
    assert.equal(p.reports.length, 3); assert.equal(p.verify, true);
    assert.equal(p.prompt.match(/^## Report /gm).length, 3);
    assert.match(p.prompt, /report c1 B/); assert.doesNotMatch(p.prompt, /기준 보고서|sonnet|opus/i);
    assert.match(p.prompt, /Find X in <repo>/);
    assert.deepEqual(planGrading(dir, round)[0].labels, p.labels);
    assert.equal(planGrading(dir, round, { only: 'c2' }).length, 1);
    writeFileSync(join(dir, 'scores_by_run.json'), JSON.stringify(Object.fromEntries(['S', 'B', 'H'].map((k) => [`c1-${k}`, { verdict: 'ok' }]))));
    assert.deepEqual(planGrading(dir, round).map((x) => x.caseId), ['c2'], 'a case with every run scored is skipped');
    assert.equal(planGrading(dir, round, { regrade: true }).length, 2);
    rmSync(join(dir, 'reports', 'c2-S.md')); rmSync(join(dir, 'reports', 'c2-H.md'));
    assert.deepEqual(planGrading(dir, round).map((x) => x.caseId), [], 'one report alone has nothing to compare');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('grade --yes in a verify round runs the tool-using grader in the case worktree and writes verify scores', async () => {
  const { dir, round } = upRoundDir();
  try {
    const calls = [];
    const spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const labels = Object.keys(blindOrder('r8-up', 'c1', ['c1-S', 'c1-B', 'c1-H']));
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end: () => setImmediate(() => { child.stdout.emit('data', verifyReply(labels)); child.emit('close', 0); }) });
      return child;
    };
    const logs = [];
    await assert.rejects(grade(dir, { only: 'c1', log: (m) => logs.push(m) }), /worktree missing for case c1/);
    mkdirSync(join(dir, 'wt', 'c1'), { recursive: true });
    const dry = await grade(dir, { only: 'c1', log: (m) => logs.push(m), spawn });
    assert.equal(dry.graded, 0); assert.equal(calls.length, 0, 'without --yes nothing runs');
    const res = await grade(dir, { only: 'c1', yes: true, log: (m) => logs.push(m), spawn });
    assert.deepEqual(res, { graded: 1, failed: [] });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, verifyArgs()); assert.equal(calls[0].opts.cwd, join(dir, 'wt', 'c1'));
    assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined);
    const scores = JSON.parse(readFileSync(join(dir, 'scores_by_run.json'), 'utf8'));
    assert.deepEqual(Object.keys(scores).sort(), ['c1-B', 'c1-H', 'c1-S']);
    const key = JSON.parse(readFileSync(join(dir, 'blind_key.json'), 'utf8'));
    const label = Object.keys(key).find((k) => key[k] === 'c1-S');
    const s = scores['c1-S'];
    assert.equal(s.mode, 'verify'); assert.equal(s.label, label);
    assert.deepEqual(['예', '부분', '아니오'].includes(s.relay), true);
    assert.equal(s.relay, { ok: '예', partial: '부분', fail: '아니오' }[s.verdict]);
    assert.ok(Number.isInteger(s.verified) && Number.isInteger(s.wrong) && Number.isInteger(s.missed) && typeof s.key_miss === 'string');
    assert.ok(existsSync(join(dir, 'grading', 'c1.out.json'))); assert.ok(existsSync(join(dir, 'blind', 'c1.md')));
    assert.ok(logs.some((m) => /verify with tools/.test(m)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const upRunFixture = () => {
  const conds = upRoundJson({ id: 'src', repo: '/r/a', commit: 'abc1234' }, [], { id: 'x', date: '2026-11-09' }).conditions;
  const ids = ['a', 'b', 'c', 'x'];
  const round = { id: 'r8-up', grading: 'verify', tier: 'numbers', conditions: conds, cases: ids.map((id) => ({ id, conditions: ['S', 'B', 'H'], ...(id === 'x' ? { meta: { excluded: 'leaks a path' } } : {}) })) };
  const keyCond = { S: 'sonnet-high', B: 'opus-direct', H: 'opus-xhigh' };
  const runs = {}, cost = {}, scores = {};
  const put = (id, k, verdict, usd, [verified, wrong, missed] = [1, 0, 0]) => {
    runs[`${id}-${k}`] = { case: id, condition: keyCond[k] }; cost[`${id}-${k}`] = { usd, ms: 2000 };
    if (verdict) scores[`${id}-${k}`] = { verdict, verified, wrong, missed, mode: 'verify' };
  };
  put('a', 'S', 'partial', 0.5, [2, 1, 1]); put('a', 'B', 'ok', 1, [3, 0, 0]); put('a', 'H', 'ok', 2, [3, 0, 0]);
  put('b', 'S', 'fail', 0.25, [0, 2, 3]); put('b', 'B', 'partial', 1.5, [2, 0, 1]); put('b', 'H', 'ok', 3, [3, 0, 0]);
  put('c', 'S', 'ok', 0.5, [3, 0, 0]); put('c', 'B', 'ok', 1, [3, 0, 0]); put('c', 'H', null, 2); // H not graded: case c does not count
  put('x', 'S', 'ok', 9); scores['x-S'] = { verdict: 'ok', verified: 9, wrong: 0, missed: 0 }; put('x', 'B', 'ok', 9); scores['x-B'] = { verdict: 'ok', verified: 9, wrong: 0, missed: 0 }; put('x', 'H', 'ok', 9); scores['x-H'] = { verdict: 'ok', verified: 9, wrong: 0, missed: 0 };
  return { round, runs, cost, scores };
};

test('upRound counts only the cases graded under all three conditions, and aggregateBulk leaves verify rounds out', () => {
  const l = upRunFixture();
  assert.deepEqual(upRound(l), {
    round: 'r8-up', n: 2,
    conditions: [
      { id: 'sonnet-high', model: 'sonnet', effort: 'high', n: 2, ok: 0, partial: 1, fail: 1, verified: 2, wrong: 3, missed: 4, usd: 0.75, sec: 4 },
      { id: 'opus-direct', model: 'opus', effort: 'high', n: 2, ok: 1, partial: 1, fail: 0, verified: 5, wrong: 0, missed: 1, usd: 2.5, sec: 4 },
      { id: 'opus-xhigh', model: 'opus', effort: 'xhigh', n: 2, ok: 2, partial: 0, fail: 0, verified: 6, wrong: 0, missed: 0, usd: 5, sec: 4 },
    ],
  });
  assert.throws(() => upRound({ ...l, round: { ...l.round, grading: 'reference' } }), /not a verify round/);
  assert.equal(aggregateBulk([l]).n, 0);
  assert.deepEqual(aggregateBulk([l]).rounds, []);
});

test('bulk --up adds the up field next to the usual aggregate and rejects a round that is not a verify round', () => {
  const l = upRunFixture(); const root = mkdtempSync(join(tmpdir(), 'sprag-bulk-up-'));
  try {
    const mk = (name, data) => { const d = join(root, name); mkdirSync(d); for (const f of ['round', 'runs', 'cost']) writeFileSync(join(d, `${f}.json`), JSON.stringify(data[f] ?? data[f + 's'])); writeFileSync(join(d, 'scores_by_run.json'), JSON.stringify(data.scores)); return d; };
    const upDir = mk('up', { round: l.round, runs: l.runs, cost: l.cost, scores: l.scores });
    const refConds = [{ key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', prompt: 'original' }, { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' }];
    const refDir = mk('ref', { round: { id: 'rr', tier: 'numbers', grading: 'reference', conditions: refConds, cases: [{ id: 'k', conditions: ['B'] }] }, runs: { 'k-B': { case: 'k', condition: 'opus-direct' } }, cost: { 'k-B': { usd: 1, ms: 1000 } }, scores: { 'k-B': { verdict: 'ok', reference: true } } });
    const out = join(root, 'bulk.json'); const logs = [];
    assert.equal(bulkMain([refDir, '--up', upDir], { out, log: (m) => logs.push(m) }), 0);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.up.n, 2); assert.equal(j.up.conditions.length, 3); assert.equal(j.n, 1); assert.deepEqual(j.rounds, ['rr']);
    assert.ok(logs.some((m) => /bulk: up over 2 cases/.test(m)));
    assert.equal(bulkMain([refDir, '--up', refDir], { out: join(root, 'no.json'), log: () => {} }), 1);
    assert.ok(!existsSync(join(root, 'no.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runEnv adds the string env a condition sets and nothing else', async () => {
  const { runEnv } = await import('../scripts/evals/replay.mjs');
  const round = { conditions: [{ id: 'c', env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '60000', bad: 'x', N: 5 } }, { id: 'd' }] };
  assert.deepEqual(runEnv(round, { condition: 'c' }, { A: '1' }), { A: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '60000' });
  assert.deepEqual(runEnv(round, { condition: 'd' }, { A: '1' }), { A: '1' });
});
