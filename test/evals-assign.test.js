// Unit tests for assign.mjs, derive.mjs, kept-on-main aggregation and reference-only grading.
// Fixtures only: synthetic one-line prompts, no claude, no network. Temp dirs for the file-based parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { buildAssignPrompt, parseAssignment, assign } from '../scripts/evals/assign.mjs';
import { derive } from '../scripts/evals/derive.mjs';
import { planRuns } from '../scripts/evals/replay.mjs';
import { aggregateBulk } from '../scripts/evals/bulk.mjs';
import { planGrading, planReferenceOnly } from '../scripts/evals/grade.mjs';
import { validateRound } from '../scripts/evals/lib.mjs';

const COND = [
  { key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', agent: 't2-explore', prompt: 'original' },
  { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
  { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
];
const srcRound = () => ({
  id: 'src', date: '2026-11-01', kind: 'conditions', repo: '/r/a', commit: 'abc1234', repeats: 1, concurrency: 4,
  allowedTools: ['Read', 'Bash'], conditions: COND, grading: 'reference', capStopPct: 85, tier: 'numbers',
  cases: [
    { id: 'c1', prompt: 'cases/c1.md', rubric: 'rubric/c1.md', repo: '/r/a', commit: 'abc1234', conditions: ['A', 'B'], agents: { A: 't2-runner' }, meta: { kind: 'run' } },
    { id: 'c2', prompt: 'cases/c2.md', rubric: 'rubric/c2.md', repo: '/r/a', commit: 'abc1234', conditions: ['S', 'B'], agents: { S: 't1-worker' }, meta: { kind: 'check' } },
    { id: 'c3', prompt: 'cases/c3.md', rubric: 'rubric/c3.md', repo: '/r/a', commit: 'abc1234', conditions: ['A', 'B'], meta: { kind: 'run' } },
  ],
});
function writeSource(dir) {
  const r = srcRound();
  for (const d of ['cases', 'rubric', 'reports', 'transcripts']) mkdirSync(join(dir, d), { recursive: true });
  for (const c of r.cases) {
    writeFileSync(join(dir, c.prompt), `synthetic task ${c.id} in {{REPO}}`); writeFileSync(join(dir, c.rubric), 'rubric');
    writeFileSync(join(dir, 'reports', `${c.id}-B.md`), `baseline ${c.id}`); writeFileSync(join(dir, 'transcripts', `${c.id}-B.jsonl`), '{}\n');
    writeFileSync(join(dir, 'reports', `${c.id}-${c.conditions[0]}.md`), `lane ${c.id}`);
  }
  const runs = {}, cost = {};
  for (const c of r.cases) {
    runs[`${c.id}-B`] = { case: c.id, condition: 'opus-direct', sessionId: `sid-${c.id}` }; cost[`${c.id}-B`] = { model: 'claude-opus-5-5', usd: 1, ms: 2000 };
    runs[`${c.id}-${c.conditions[0]}`] = { case: c.id, condition: 'x' };
  }
  writeFileSync(join(dir, 'round.json'), JSON.stringify(r)); writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs)); writeFileSync(join(dir, 'cost.json'), JSON.stringify(cost));
}

test('buildAssignPrompt holds the rule, the heading and the masked repo path', () => {
  const p = buildAssignPrompt('RULE TEXT', 'look in {{REPO}}/src');
  assert.match(p, /^RULE TEXT\n\n## 위임 프롬프트\n\nlook in <repo>\/src\n\n/);
  assert.ok(!p.includes('{{REPO}}'));
  assert.match(p, /ONLY the JSON object/);
});

test('parseAssignment accepts a valid lane and rejects an unknown lane, no JSON and API errors', () => {
  const wrap = (result, extra = {}) => JSON.stringify({ result, ...extra });
  assert.deepEqual(parseAssignment(wrap('{"lane":"sonnet-xhigh-web","reason":"needs the web"}')), { lane: 'sonnet-xhigh-web', reason: 'needs the web' });
  assert.deepEqual(parseAssignment('Sure: {"lane":"main","reason":"diagnosis"}'), { lane: 'main', reason: 'diagnosis' });
  assert.ok(parseAssignment(wrap('{"lane":"opus","reason":"x"}')).errors[0].includes('unknown lane'));
  assert.ok(parseAssignment(wrap('no json here')).errors);
  assert.ok(parseAssignment(wrap('{"lane":"main"}', { is_error: true })).errors[0].includes('claude reported an error'));
});

test('assign --yes classifies, retries once on a parse error, merges into the file and skips done cases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-assign-'));
  try {
    writeSource(dir); writeFileSync(join(dir, 'rule.md'), 'rule');
    const replies = ['garbage', '{"lane":"haiku-low","reason":"lookup"}', '{"lane":"main","reason":"audit"}'];
    let n = 0; const prompts = [];
    const spawn = (cmd, args) => {
      const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter();
      assert.deepEqual(args.slice(0, 4), ['-p', '--model', 'claude-sonnet-5-5', '--effort']);
      ch.stdin = { on() {}, end(p) { prompts.push(p); setImmediate(() => { ch.stdout.emit('data', JSON.stringify({ result: replies[n++] })); ch.emit('close', 0); }); } };
      return ch;
    };
    const opts = { spawn, log() {}, cwd: join(dir, 'cwd'), concurrency: 1 };
    const dry = await assign(dir, join(dir, 'rule.md'), { ...opts, cases: ['c1', 'c2'] });
    assert.equal(dry.assigned, 0); assert.equal(n, 0); assert.ok(!existsSync(join(dir, 'assignments')), 'no --yes: nothing written');
    const r = await assign(dir, join(dir, 'rule.md'), { ...opts, cases: ['c1', 'c2'], yes: true });
    assert.deepEqual(r.counts, { 'haiku-low': 1, main: 1 }); assert.equal(n, 3); assert.equal(prompts.length, 3);
    const file = JSON.parse(readFileSync(join(dir, 'assignments', 'rule.json'), 'utf8'));
    assert.equal(file.rule, 'rule'); assert.deepEqual(Object.keys(file.byCase), ['c1', 'c2']);
    const again = await assign(dir, join(dir, 'rule.md'), { ...opts, yes: true, cases: ['c1', 'c2'] });
    assert.equal(again.assigned, 0); assert.equal(n, 3, 'finished cases are not asked again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('derive builds the expected round.json and reuses the baseline runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-derive-'));
  try {
    const src = join(root, 'src'); mkdirSync(src); writeSource(src);
    const asg = join(root, 'a.json');
    writeFileSync(asg, JSON.stringify({ rule: 'rule-x', at: 'now', byCase: {
      c1: { lane: 'sonnet-high', reason: '' }, c2: { lane: 'main', reason: '' }, c3: { lane: 'sonnet-xhigh-web', reason: '' },
    } }));
    const out = derive(src, asg, { id: 'new1', root: join(root, 'rounds'), date: '2026-11-09', log() {} });
    const round = JSON.parse(readFileSync(join(out.outDir, 'round.json'), 'utf8'));
    assert.deepEqual(validateRound(round), []);
    assert.deepEqual([round.id, round.date, round.baselineFrom, round.repo, round.commit, round.grading, round.tier, round.capStopPct, round.concurrency],
      ['new1', '2026-11-09', 'src', '/r/a', 'abc1234', 'reference', 'numbers', 85, 4]);
    assert.deepEqual(round.conditions.map((c) => [c.key, c.id, c.model, c.effort, c.agent, c.role]), [
      ['A', 'haiku-low', 'claude-haiku-5-5', 'low', 't2-explore', undefined], ['S', 'sonnet-high', 'claude-sonnet-5-5', 'high', undefined, undefined],
      ['Y', 'sonnet-xhigh', 'claude-sonnet-5-5', 'xhigh', undefined, undefined],
      ['X', 'sonnet-xhigh-web', 'claude-sonnet-5-5', 'xhigh', undefined, undefined], ['B', 'opus-direct', 'claude-opus-5-5', 'high', undefined, 'baseline'],
    ]);
    const [c1, c2, c3] = round.cases;
    assert.deepEqual([c1.conditions, c1.agents], [['S', 'B'], { S: 't1-worker' }]);
    assert.deepEqual([c2.conditions, c2.agents], [['B'], undefined]);
    assert.deepEqual([c3.conditions, c3.agents], [['X', 'B'], undefined]);
    assert.deepEqual(c1.meta, { kind: 'run', assigned: 'sonnet-high', assignedBy: 'rule-x', sourceRound: 'src', sourceLane: 'haiku-low' });
    assert.equal(c2.meta.sourceLane, 'sonnet-high');
    const runs = JSON.parse(readFileSync(join(out.outDir, 'runs.json'), 'utf8'));
    assert.deepEqual(Object.keys(runs).sort(), ['c1-B', 'c2-B', 'c3-B']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(out.outDir, 'cost.json'), 'utf8'))).sort(), ['c1-B', 'c2-B', 'c3-B']);
    for (const f of ['reports/c1-B.md', 'transcripts/c3-B.jsonl', 'cases/c2.md', 'rubric/c3.md']) assert.ok(existsSync(join(out.outDir, f)), f);
    assert.ok(!existsSync(join(out.outDir, 'reports', 'c1-A.md')), 'lane reports are not copied');
    assert.deepEqual(planRuns(round).filter((r) => !(r.key in runs)).map((r) => r.key), ['c1-S', 'c3-X'], 'only non-baseline runs are planned');
    assert.equal(out.planned, 2);
    assert.throws(() => derive(src, asg, { id: 'new1', root: join(root, 'rounds'), log() {} }), /already exists/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('derive lane sonnet-xhigh writes condition Y with the t1-worker agent and the rule tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-derive-y-'));
  try {
    const src = join(root, 'src'); mkdirSync(src); writeSource(src);
    const asg = join(root, 'narrow-v9.json');
    writeFileSync(asg, JSON.stringify({ byCase: { c1: { lane: 'sonnet-xhigh', reason: '' }, c2: { lane: 'main', reason: '' } } }));
    const out = derive(src, asg, { id: 'ny', root: join(root, 'rounds'), log() {}, cases: ['c1', 'c2'] });
    assert.deepEqual(validateRound(out.round), []);
    assert.deepEqual(out.round.conditions.map((c) => c.key), ['A', 'S', 'Y', 'X', 'B']);
    const y = out.round.conditions.find((c) => c.key === 'Y');
    assert.deepEqual([y.id, y.model, y.effort, y.prompt], ['sonnet-xhigh', 'claude-sonnet-5-5', 'xhigh', 'original']);
    assert.deepEqual([out.round.cases[0].conditions, out.round.cases[0].agents], [['Y', 'B'], { Y: 't1-worker' }]);
    assert.equal(out.round.rule, 'narrow-v9', 'no rule field and no --rule: the file basename');
    const asg2 = join(root, 'b.json'); writeFileSync(asg2, JSON.stringify({ rule: 'from-file', byCase: { c1: { lane: 'main', reason: '' } } }));
    assert.equal(derive(src, asg2, { id: 'n2', root: join(root, 'rounds'), log() {} , cases: ['c1'] }).round.rule, 'from-file');
    assert.equal(derive(src, asg2, { id: 'n3', rule: 'v7', root: join(root, 'rounds'), log() {}, cases: ['c1'] }).round.rule, 'v7');
    assert.ok(validateRound({ ...out.round, rule: 3 }).some((e) => e.includes('rule')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('derive reuses a graded pick run under the same condition id, renames the key and counts the remainder', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-derive-reuse-'));
  try {
    const src = join(root, 'src'); mkdirSync(src); writeSource(src);
    // writeSource gives c1 a lane run c1-A (condition id "x"); make it a real graded haiku-low run, and c2 a sonnet-high one.
    const runs = JSON.parse(readFileSync(join(src, 'runs.json'), 'utf8')); const cost = JSON.parse(readFileSync(join(src, 'cost.json'), 'utf8'));
    runs['c1-A'].condition = 'haiku-low'; runs['c2-S'].condition = 'sonnet-high'; runs['c3-A'].condition = 'haiku-low';
    cost['c1-A'] = { model: 'claude-haiku-5-5', usd: 0.1, ms: 1000 }; cost['c2-S'] = { model: 'claude-sonnet-5-5', usd: 0.3, ms: 3000 };
    writeFileSync(join(src, 'runs.json'), JSON.stringify(runs)); writeFileSync(join(src, 'cost.json'), JSON.stringify(cost));
    writeFileSync(join(src, 'reports', 'c2-S.md'), 'lane c2'); writeFileSync(join(src, 'transcripts', 'c1-A.jsonl'), '{}\n');
    // c3-A is not graded, so it is replayed again. The baseline entries carry the reference score.
    writeFileSync(join(src, 'scores_by_run.json'), JSON.stringify({
      'c1-A': { verdict: 'ok', relay: '예' }, 'c2-S': { verdict: 'partial', relay: '부분' }, 'c1-B': { verdict: 'ok', reference: true },
    }));
    const asg = join(root, 'a.json');
    writeFileSync(asg, JSON.stringify({ rule: 'r', byCase: {
      c1: { lane: 'haiku-low', reason: '' }, c2: { lane: 'sonnet-xhigh', reason: '' }, c3: { lane: 'haiku-low', reason: '' },
    } }));
    const logs = [];
    const out = derive(src, asg, { id: 'reuse', root: join(root, 'rounds'), log: (m) => logs.push(m) });
    const d = out.outDir; const j = (f) => JSON.parse(readFileSync(join(d, f), 'utf8'));
    assert.deepEqual(Object.keys(j('runs.json')).sort(), ['c1-A', 'c1-B', 'c2-B', 'c3-B']);
    assert.equal(j('cost.json')['c1-A'].usd, 0.1);
    assert.deepEqual(Object.keys(j('scores_by_run.json')).sort(), ['c1-A', 'c1-B']);
    assert.ok(existsSync(join(d, 'reports', 'c1-A.md')) && existsSync(join(d, 'transcripts', 'c1-A.jsonl')));
    assert.ok(!existsSync(join(d, 'reports', 'c2-S.md')) && !existsSync(join(d, 'reports', 'c3-A.md')), 'a changed lane or an ungraded run is not copied');
    assert.deepEqual([out.reused, out.planned], [1, 2], 'c2-Y and c3-A are still to replay');
    assert.match(logs[0], /2 run\(s\) to replay, 1 pick run\(s\) reused/);
    assert.deepEqual(planRuns(out.round).filter((r) => !(r.key in j('runs.json'))).map((r) => r.key), ['c2-Y', 'c3-A']);
    // A second derive from the derived round renames a pick key when the letter differs: sonnet-high S -> Y is not the same id, so only A stays.
    const asg2 = join(root, 'a2.json'); writeFileSync(asg2, JSON.stringify({ rule: 'r2', byCase: { c1: { lane: 'haiku-low', reason: '' } } }));
    const out2 = derive(d, asg2, { id: 'reuse2', root: join(root, 'rounds'), log() {}, cases: ['c1'] });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(out2.outDir, 'runs.json'), 'utf8'))).sort(), ['c1-A', 'c1-B']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('aggregateBulk counts a main-only case as kept on main with lane opus-direct', () => {
  const r = { id: 'd', tier: 'numbers', conditions: COND, cases: [
    { id: 'm', conditions: ['B'], meta: { kind: 'audit' } }, { id: 'a', conditions: ['A', 'B'], meta: { kind: 'run' } },
  ] };
  const runs = { 'm-B': { case: 'm', condition: 'opus-direct' }, 'a-A': { case: 'a', condition: 'haiku-low' }, 'a-B': { case: 'a', condition: 'opus-direct' } };
  const cost = { 'm-B': { usd: 2, ms: 4000 }, 'a-A': { usd: 0.1, ms: 1000 }, 'a-B': { usd: 1, ms: 3000 } };
  const scores = { 'm-B': { verdict: 'ok', reference: true }, 'a-A': { relay: '부분' }, 'a-B': { verdict: 'ok', reference: true } };
  const agg = aggregateBulk([{ round: r, runs, cost, scores }]);
  assert.deepEqual(agg.cases.find((c) => c.kind === 'audit'), { kind: 'audit', lane: 'opus-direct', verdict: 'ok', pickUsd: 2, opusUsd: 2, pickSec: 4, opusSec: 4 });
  assert.deepEqual([agg.totals.n, agg.totals.keptMain, agg.byKind.audit.keptMain, agg.byKind.run.keptMain], [2, 1, 1, undefined]);
  assert.deepEqual(agg.pickModels, { haiku: 1, sonnet: 0, opus: 1 });
  assert.equal(agg.totals.opusUsd, 3);
});

test('reference grading skips a main-only case and scores its baseline report as the reference', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-refonly-'));
  try {
    writeSource(dir);
    const round = { ...srcRound(), cases: [{ ...srcRound().cases[0], conditions: ['B'] }, srcRound().cases[1]] };
    assert.deepEqual(planGrading(dir, round).map((p) => p.caseId), ['c2'], 'the main-only case has no grader call');
    assert.deepEqual(planReferenceOnly(dir, round), [{ caseId: 'c1', refKey: 'c1-B' }]);
    writeFileSync(join(dir, 'scores_by_run.json'), JSON.stringify({ 'c1-B': { reference: true } }));
    assert.deepEqual(planReferenceOnly(dir, round), [], 'already recorded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('derive refuses a case with no baseline run unless runBaseline, which leaves the baseline to replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-derive-nb-'));
  try {
    const src = join(root, 'src'); mkdirSync(src); writeSource(src);
    const runs = JSON.parse(readFileSync(join(src, 'runs.json'), 'utf8')); delete runs['c1-B'];
    writeFileSync(join(src, 'runs.json'), JSON.stringify(runs));
    const asg = join(root, 'v.json'); writeFileSync(asg, JSON.stringify({ byCase: { c1: { lane: 'sonnet-xhigh', reason: '' } } }));
    assert.throws(() => derive(src, asg, { id: 'nb1', root: join(root, 'rounds'), log() {}, cases: ['c1'] }), /run-baseline/);
    assert.ok(!existsSync(join(root, 'rounds', 'nb1')), 'a refused round leaves no directory');
    const out = derive(src, asg, { id: 'nb2', root: join(root, 'rounds'), log() {}, cases: ['c1'], runBaseline: true });
    assert.equal(out.planned, 2, 'the lane run and the missing baseline are both left to replay');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
