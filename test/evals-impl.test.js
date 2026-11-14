// Unit tests for implementation replay: implround.mjs, the write-case parts of replay.mjs and grade.mjs, bulk --impl.
// Fixtures only: no claude, no git, no network. spawn and git are injected and every file lives in a temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { implround, implPrompt, IMPL_RUBRIC } from '../scripts/evals/implround.mjs';
import { replay, writeWorktreeFor, writeGuardEnv, SECRET_ENV_RE, claudeArgs } from '../scripts/evals/replay.mjs';
import { buildImplVerifyPrompt, parseVerify, verifyScore, planGrading } from '../scripts/evals/grade.mjs';
import { implRound, main as bulkMain } from '../scripts/evals/bulk.mjs';
import { validateRound, sha10 } from '../scripts/evals/lib.mjs';

const tmp = (n) => mkdtempSync(join(tmpdir(), `sprag-impl-${n}-`));
const rm = (...d) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));
const quiet = () => {};
const KEY1 = '/t/agent-1.jsonl', KEY2 = '/t/agent-2.jsonl';
const TS = Date.parse('2026-11-10T00:00:00Z');
const snap = (over = {}) => ({ key: KEY1, ts: TS, rule: 'T1|implement|p', toFamily: 'sonnet', usd: 2, cost: 0.4, cwd: '/r/a/sub', prompt: 'Edit /r/a/sub/x.js and run the tests in /r/a.', ...over });
const workWith = (lines) => { const w = tmp('work'); writeFileSync(join(w, 'ledger-snapshot.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); return w; };
/** A git stand-in: returns stdout, or null for a failing command. */
const fakeGit = ({ ancestor = true } = {}) => (args) => {
  const cmd = args.slice(2).join(' ');
  if (cmd === 'rev-parse --show-toplevel') return '/r/a';
  if (cmd.startsWith('rev-list -1 --before=')) return 'abc1234';
  if (cmd.startsWith('merge-base --is-ancestor abc1234 HEAD')) return ancestor ? '' : null;
  return null;
};

// ---------------------------------------------------------------- implround
test('implround writes a verify round of write cases that passes validateRound', () => {
  const work = workWith([snap(), snap({ key: KEY2, prompt: 'Fix the parser.' })]);
  try {
    const ids = [sha10(KEY1), sha10(KEY2)];
    const { round, dir } = implround({ cases: ids, id: 'r-impl', work, git: fakeGit(), log: quiet, today: '2026-11-14' });
    assert.deepEqual(validateRound(round), []);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'round.json'), 'utf8')), round);
    assert.deepEqual([round.grading, round.rule, round.tier, round.timeoutMin, round.concurrency, round.capStopPct, round.repo, round.commit], ['verify', 'impl-v1', 'numbers', 45, 2, 85, '/r/a', 'abc1234']);
    assert.deepEqual(round.allowedTools, ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write']);
    assert.deepEqual(round.conditions.map((c) => [c.key, c.id, c.agent ?? null, c.role ?? null]), [['S', 'sonnet-high', 't1-worker', null], ['B', 'opus-direct', null, 'baseline']]);
    assert.deepEqual(round.cases[0], { id: ids[0], prompt: `cases/${ids[0]}.md`, rubric: `rubric/${ids[0]}.md`, repo: '/r/a', commit: 'abc1234', write: true, conditions: ['S', 'B'], meta: { kind: 'implement', ledgerUsd: 2, ledgerCost: 0.4, ts: TS } });
    assert.equal(readFileSync(join(dir, round.cases[0].prompt), 'utf8'), 'Edit {{REPO}}/sub/x.js and run the tests in {{REPO}}.');
    assert.equal(readFileSync(join(dir, round.cases[0].rubric), 'utf8'), IMPL_RUBRIC);
    assert.throws(() => implround({ cases: ids, id: 'r-impl', work, git: fakeGit(), log: quiet }), /already exists/);
  } finally { rm(work); }
});

test('implround refuses a prompt that keeps the repo root, a commit off HEAD and an unknown id, and writes nothing', () => {
  const work = workWith([snap({ prompt: 'Compare /r/a-old with the repo, mask ghp_' + 'x'.repeat(36) }), snap({ key: KEY2 })]);
  try {
    assert.match(implPrompt('see /r/a-old', '/r/a').error, /still names the repo root/);
    assert.deepEqual(implPrompt('see /r/a/x and ghp_' + 'y'.repeat(36), '/r/a'), { text: 'see {{REPO}}/x and ghp_***REDACTED***' });
    assert.throws(() => implround({ cases: [sha10(KEY1)], id: 'x1', work, git: fakeGit(), log: quiet }), new RegExp(`${sha10(KEY1)}: prompt still names the repo root`));
    assert.throws(() => implround({ cases: [sha10(KEY2)], id: 'x2', work, git: fakeGit({ ancestor: false }), log: quiet }), /abc1234 is not an ancestor of HEAD/);
    assert.throws(() => implround({ cases: ['0000000000'], id: 'x3', work, git: fakeGit(), log: quiet }), /not in the ledger snapshot/);
    assert.ok(!existsSync(join(work, 'rounds')), 'nothing written');
  } finally { rm(work); }
});

// ---------------------------------------------------------------- replay
const CONDS = [
  { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker', prompt: 'original' },
  { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
];
const implRoundObj = (cases) => ({
  id: 'r-impl', date: '2026-11-14', kind: 'conditions', repo: '/r/a', commit: 'abc1234', repeats: 1, concurrency: 2, timeoutMin: 45,
  allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'], grading: 'verify', rule: 'impl-v1', tier: 'numbers', capStopPct: 85, conditions: CONDS, cases,
});
const W1 = { id: 'w1', prompt: 'cases/w1.md', rubric: 'rubric/w1.md', repo: '/r/a', commit: 'abc1234', write: true, conditions: ['S', 'B'] };
const R1 = { id: 'r1', prompt: 'cases/w1.md', rubric: 'rubric/w1.md' };
function roundDir(round) {
  const dir = tmp('round');
  for (const d of ['cases', 'rubric']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'round.json'), JSON.stringify(round));
  writeFileSync(join(dir, 'cases', 'w1.md'), 'Edit {{REPO}}/a.js.\n'); writeFileSync(join(dir, 'rubric', 'w1.md'), IMPL_RUBRIC);
  return dir;
}
/** A claude stand-in that records each call and answers with a result envelope. */
function runSpawn() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end(prompt) { calls.push({ args, opts, prompt }); setTimeout(() => { child.stdout.emit('data', JSON.stringify({ result: 'done' })); child.emit('close', 0); }, 2); } });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

test('replay gives each write run its own guarded worktree, deny list and saved diff; other cases run as before', async () => {
  const wtRoot = tmp('wt'); const prevWt = process.env.SPRAG_EVALS_WT; process.env.SPRAG_EVALS_WT = wtRoot;
  process.env.SPRAG_TEST_GH_TOKEN = 'x'; process.env.SPRAG_TEST_API_KEY = 'y';
  const round = implRoundObj([W1, R1]); const dir = roundDir(round);
  try {
    const gitCalls = [], outCalls = [];
    const git = (args) => { gitCalls.push(args); mkdirSync(args[5], { recursive: true }); };
    const gitOut = (args) => {
      outCalls.push(args); const cmd = args.slice(2).join(' ');
      // the diff is taken against the commit the run started on, so a run that commits still shows its change
      const base = W1.commit || round.commit;
      if (cmd === `diff --cached --binary ${base}`) return `PATCH ${args[1]}\n`;
      if (cmd === `diff --cached --numstat ${base}`) return '3\t1\ta.js\n-\t-\tlogo.png\n';
      return '';
    };
    const lines = [];
    await replay(dir, { dryRun: true, spawn: runSpawn(), log: (l) => lines.push(l), costFilesList: [] });
    const wts = ['w1-S', 'w1-B'].map((k) => writeWorktreeFor(round, W1, k).wt);
    assert.notEqual(wts[0], wts[1]);
    for (const wt of wts) {
      assert.ok(wt.startsWith(join(wtRoot, 'r-impl') + '/'));
      assert.match(basename(wt), /^w1-[0-9a-f]{6}$/, 'no condition letter in the folder name');
      assert.ok(lines.some((l) => l.includes(`worktree add --detach ${wt} abc1234`)));
    }
    const dryW = lines.find((l) => l.includes('[w1-S]'));
    assert.match(dryW, /GIT_TERMINAL_PROMPT=0 .*GH_CONFIG_DIR=.* claude -p/);
    assert.match(dryW, /'Bash\(git push:\*\)'/);

    const spawn = runSpawn();
    const res = await replay(dir, { yes: true, spawn, git, gitOut, log: quiet, costFilesList: [], caps: async () => ({ fiveHour: null, sevenDay: null, source: 'file' }), sleep: async () => {} });
    assert.equal(res.started, 4);
    const by = Object.fromEntries(spawn.calls.map((c) => [c.args[c.args.indexOf('--model') + 1] + ':' + c.opts.cwd, c]));
    for (const [i, wt] of wts.entries()) {
      const c = by[`${CONDS[i].model}:${wt}`];
      assert.ok(c, `write run ran in ${wt}`);
      assert.equal(c.prompt, `Edit ${wt}/a.js.\n`);
      assert.equal(c.opts.timeout, 45 * 60e3);
      const deny = c.args.slice(c.args.indexOf('--disallowedTools') + 1);
      for (const rule of ['NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git stash:*)', 'Bash(npm publish:*)', 'Bash(npm run deploy:*)', 'Bash(gh:*)', 'Bash(supabase:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Edit(//r/a/**)', 'Write(//r/a/**)']) assert.ok(deny.includes(rule), rule);
      assert.ok(!deny.includes('Edit') && !deny.includes('Write'));
      assert.deepEqual(c.args.slice(c.args.indexOf('--allowedTools') + 1, c.args.indexOf('--disallowedTools')), ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write']);
      const env = c.opts.env;
      assert.ok(Object.keys(env).every((k) => !SECRET_ENV_RE.test(k)), 'no secret-named variable');
      assert.deepEqual([env.GIT_TERMINAL_PROMPT, env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_2, env.GIT_CONFIG_VALUE_2, env.GH_CONFIG_DIR, env.NPM_CONFIG_USERCONFIG],
        ['0', '3', 'credential.helper', '', join(dir, '.guard', 'gh'), join(dir, '.guard', 'npmrc')]);
    }
    assert.equal(readFileSync(join(dir, 'diffs', 'w1-S.patch'), 'utf8'), `PATCH ${wts[0]}\n`);
    const cost = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
    assert.deepEqual(cost['w1-B'].diff, { files: 2, insertions: 3, deletions: 1 });
    assert.ok(statSync(join(dir, '.guard', 'gh')).isDirectory() && readFileSync(join(dir, '.guard', 'npmrc'), 'utf8') === '');
    // The case without write: shared round worktree, the old read-only arguments and env, no diff.
    const ro = spawn.calls.filter((c) => c.opts.cwd === join(dir, 'wt'));
    assert.equal(ro.length, 2);
    for (const c of ro) {
      const cond = CONDS.find((x) => x.model === c.args[c.args.indexOf('--model') + 1]);
      const sid = c.args[c.args.indexOf('--session-id') + 1];
      assert.deepEqual(c.args, claudeArgs(cond, sid, { allowedTools: round.allowedTools }));
      assert.equal(c.opts.env.SPRAG_TEST_GH_TOKEN, 'x'); assert.equal(c.opts.env.GIT_CONFIG_KEY_0, process.env.GIT_CONFIG_KEY_0);
    }
    assert.ok(!('r1-S' in cost) && !existsSync(join(dir, 'diffs', 'r1-S.patch')));
    assert.ok(outCalls.every((a) => wts.includes(a[1])), 'diffs are taken from write worktrees only');
    assert.deepEqual(gitCalls.map((a) => a[5]).sort(), [join(dir, 'wt'), ...wts].sort());
  } finally {
    if (prevWt === undefined) delete process.env.SPRAG_EVALS_WT; else process.env.SPRAG_EVALS_WT = prevWt;
    delete process.env.SPRAG_TEST_GH_TOKEN; delete process.env.SPRAG_TEST_API_KEY;
    rm(dir, wtRoot);
  }
});

test('writeGuardEnv is pure: drops secret-named variables and adds the guard', () => {
  const base = { PATH: '/bin', GITHUB_TOKEN: 'a', NPM_TOKEN: 'b', aws_secret: 'c', DB_PASSWORD: 'd', OPENAI_API_KEY: 'e', HOME: '/h' };
  const e = writeGuardEnv(base, { roundDir: '/x/r' });
  assert.deepEqual(Object.keys(base).filter((k) => k in e), ['PATH', 'HOME']);
  assert.equal(e.GIT_ASKPASS, '/usr/bin/false'); assert.equal(e.GIT_CONFIG_VALUE_0, 'https://'); assert.equal(e.GIT_CONFIG_VALUE_1, 'git@');
  assert.equal(base.GITHUB_TOKEN, 'a', 'input untouched');
});

// ---------------------------------------------------------------- grade
test('buildImplVerifyPrompt lists every copy and the tests field and names no model', () => {
  const p = buildImplVerifyPrompt({ task: 'Edit <repo>/a.js; run npm test.\nUse sonnet effort high.', reports: [{ label: 'P', text: 'Done, by opus.\nAll good.', wt: '/w/r/w1-aaaaaa' }, { label: 'Q', text: 'Done.', wt: '/w/r/w1-bbbbbb' }] });
  assert.ok(p.includes('- Report P: /w/r/w1-aaaaaa') && p.includes('- Report Q: /w/r/w1-bbbbbb'));
  assert.ok(p.includes('git -C <copy> diff --cached HEAD'));
  assert.ok(p.includes('"tests": "pass" | "fail" | "none"'));
  assert.ok(p.includes('task not reproducible at this commit'));
  assert.ok(!/haiku|sonnet|opus|t1-worker/i.test(p));
});

test('planGrading sends a write case to the impl verify prompt with each run\'s worktree', () => {
  const round = implRoundObj([W1]); const dir = roundDir(round);
  try {
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports', 'w1-S.md'), 'S did it'); writeFileSync(join(dir, 'reports', 'w1-B.md'), 'B did it');
    const [p] = planGrading(dir, round);
    assert.ok(p.verify && p.impl);
    for (const k of ['w1-S', 'w1-B']) assert.ok(p.prompt.includes(writeWorktreeFor(round, W1, k).wt));
    assert.ok(p.prompt.includes('Edit <repo>/a.js.'));
  } finally { rm(dir); }
});

test('parseVerify checks tests when given; replies and scores without tests are unchanged', () => {
  const g = (extra) => JSON.stringify({ result: JSON.stringify({ checks: [], reports: { P: { verdict: 'ok', verified: 2, wrong: 0, missed: 0, key_miss: '', ...extra } } }) });
  assert.equal(parseVerify(g({ tests: 'pass' }), ['P']).reports.P.tests, 'pass');
  assert.deepEqual(parseVerify(g({ tests: 'yes' }), ['P']).errors, ['P: tests invalid']);
  const plain = parseVerify(g({}), ['P']);
  assert.deepEqual(plain, { reports: { P: { verdict: 'ok', verified: 2, wrong: 0, missed: 0, key_miss: '' } }, checks: [] });
  assert.equal(JSON.stringify(verifyScore(plain.reports.P, 'c-P')), '{"verdict":"ok","relay":"예","verified":2,"wrong":0,"missed":0,"key_miss":"","label":"c-P","mode":"verify"}');
  assert.equal(verifyScore({ ...plain.reports.P, tests: 'fail' }, 'c-P').tests, 'fail');
});

// ---------------------------------------------------------------- bulk
test('bulk --impl adds verdicts, tests and diff totals per condition; without it the output is unchanged', () => {
  const root = tmp('bulk');
  try {
    const mk = (name, f) => { const d = join(root, name); mkdirSync(d); for (const [k, v] of Object.entries(f)) writeFileSync(join(d, `${k}.json`), JSON.stringify(v)); return d; };
    const round = implRoundObj([{ ...W1, id: 'a' }, { ...W1, id: 'b' }, { ...W1, id: 'c' }]);
    const runs = {}, cost = {}, scores = {};
    const put = (id, k, verdict, tests, diff) => {
      runs[`${id}-${k}`] = { case: id, condition: CONDS.find((c) => c.key === k).id };
      cost[`${id}-${k}`] = { usd: 1, ms: 2000, diff };
      if (verdict) scores[`${id}-${k}`] = { verdict, verified: 1, wrong: 0, missed: 0, ...(tests ? { tests } : {}), mode: 'verify' };
    };
    put('a', 'S', 'ok', 'pass', { files: 2, insertions: 10, deletions: 1 }); put('a', 'B', 'ok', 'pass', { files: 1, insertions: 4, deletions: 0 });
    put('b', 'S', 'partial', 'fail', { files: 3, insertions: 5, deletions: 5 }); put('b', 'B', 'ok', undefined, { files: 1, insertions: 1, deletions: 1 });
    put('c', 'S', 'ok', 'pass', { files: 9, insertions: 9, deletions: 9 }); put('c', 'B', null); // c not graded under B: left out
    const implDir = mk('impl', { round, runs, cost, scores_by_run: scores });
    const im = implRound({ round, runs, cost, scores });
    assert.equal(im.n, 2);
    assert.deepEqual(im.conditions.map((c) => [c.id, c.ok, c.partial, c.fail]), [['sonnet-high', 1, 1, 0], ['opus-direct', 2, 0, 0]]);
    assert.deepEqual(im.tests, { 'sonnet-high': { pass: 1, fail: 1, none: 0 }, 'opus-direct': { pass: 1, fail: 0, none: 1 } });
    assert.deepEqual(im.diff, { 'sonnet-high': { files: 5, insertions: 15, deletions: 6 }, 'opus-direct': { files: 2, insertions: 5, deletions: 1 } });
    const refConds = [{ key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', prompt: 'original' }, { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' }];
    const refDir = mk('ref', { round: { id: 'rr', tier: 'numbers', grading: 'reference', conditions: refConds, cases: [{ id: 'k', conditions: ['B'] }] }, runs: { 'k-B': { case: 'k', condition: 'opus-direct' } }, cost: { 'k-B': { usd: 1, ms: 1000 } }, scores_by_run: { 'k-B': { verdict: 'ok', reference: true } } });
    const plainOut = join(root, 'plain.json'), implOut = join(root, 'impl.json'); const logs = [];
    assert.equal(bulkMain([refDir], { out: plainOut, log: quiet }), 0);
    assert.equal(bulkMain([refDir, '--impl', implDir], { out: implOut, log: (m) => logs.push(m) }), 0);
    const j = JSON.parse(readFileSync(implOut, 'utf8'));
    assert.deepEqual(j.impl, im);
    assert.ok(logs.some((m) => /bulk: impl over 2 cases/.test(m)));
    delete j.impl;
    assert.equal(JSON.stringify(j, null, 2) + '\n', readFileSync(plainOut, 'utf8'));
    assert.equal(bulkMain([refDir, '--impl'], { out: join(root, 'x.json'), log: quiet }), 2);
  } finally { rm(root); }
});

test('implRound adds bySegment only when a graded case carries meta.segment', () => {
  const mkCase = (id, segment) => ({ ...W1, id, ...(segment ? { meta: { segment } } : {}) });
  const run = (cases, extra = {}) => {
    const round = implRoundObj(cases);
    const runs = {}, cost = {}, scores = {};
    for (const c of cases) {
      for (const [k, usd, verdict, tests] of [['S', 1.5, c.id === 'p' ? 'partial' : 'ok', 'pass'], ['B', 3, 'ok', c.id === 'q' ? 'fail' : 'pass']]) {
        const key = `${c.id}-${k}`;
        runs[key] = { case: c.id, condition: CONDS.find((x) => x.key === k).id };
        cost[key] = { usd, ms: 1000 };
        scores[key] = { verdict, verified: 1, wrong: 0, missed: 0, tests, mode: 'verify' };
      }
    }
    Object.assign(scores, extra);
    return implRound({ round, runs, cost, scores });
  };
  const without = run([mkCase('a'), mkCase('b')]);
  assert.ok(!('bySegment' in without), 'no segment, no key');
  const one = run([mkCase('a', 'fe'), mkCase('p', 'fe'), mkCase('q', 'be'), mkCase('z')]);
  assert.deepEqual(Object.keys(one.bySegment), ['fe', 'be']);
  assert.equal(one.n, 4, 'the unsegmented case still counts in the pooled summary');
  assert.deepEqual(one.bySegment.fe, { n: 2, conditions: {
    'sonnet-high': { ok: 1, partial: 1, fail: 0, usd: 3, pass: 2 },
    'opus-direct': { ok: 2, partial: 0, fail: 0, usd: 6, pass: 2 },
  } });
  assert.deepEqual(one.bySegment.be.conditions['opus-direct'], { ok: 1, partial: 0, fail: 0, usd: 3, pass: 0 });
  const feOnly = run([mkCase('a', 'fe'), mkCase('b')]);
  assert.deepEqual(Object.keys(feOnly.bySegment), ['fe'], 'a segment key is present only when it has cases');
  // a segmented case that is not graded under every condition is left out, like the rest of the summary
  const ungraded = run([mkCase('a', 'fe'), mkCase('c', 'be')], { 'c-B': undefined });
  assert.deepEqual(Object.keys(ungraded.bySegment), ['fe']);
});

test('summariseDoc2md counts countable events only and writes aggregates', async () => {
  const { summariseDoc2md } = await import('../scripts/evals/doc2md.mjs');
  const T1 = Date.parse('2026-09-06T10:00:00Z'), T2 = Date.parse('2026-10-01T10:00:00Z');
  const ev = (over) => ({ ts: T1, usd: 1, ext: '.pdf', tokens: 100, baseline: 400, ...over });
  const out = summariseDoc2md([
    ev({}), ev({ ts: T2, tokens: 300, baseline: 600 }),
    ev({ ext: '.PPTX', tokens: 10, baseline: 250 }),
    ev({ ext: '.pa/th', tokens: 1, baseline: 999 }), // bad extension
    ev({ ext: '', tokens: 1, baseline: 999 }),
    ev({ baseline: 0 }), ev({ tokens: -1 }), ev({ tokens: NaN }), ev({ ts: 0 }), ev({ baseline: Infinity }),
  ]);
  assert.equal(out.n, 3);
  assert.equal(out.baseline, 1250);
  assert.equal(out.tokens, 410);
  assert.equal(out.pct, Math.round((1 - 410 / 1250) * 100));
  assert.equal(out.since, '2026-09-06');
  assert.equal(out.until, '2026-10-01');
  assert.deepEqual(out.byExt, [
    { ext: 'pptx', n: 1, baseline: 250, tokens: 10, x: 25 },
    { ext: 'pdf', n: 2, baseline: 1000, tokens: 400, x: 2.5 },
  ]);
  assert.deepEqual(Object.keys(out), ['since', 'until', 'n', 'baseline', 'tokens', 'pct', 'byExt']);
  assert.ok(!/usd|path|\//.test(JSON.stringify(Object.keys(out.byExt[0]))));
  assert.equal(summariseDoc2md([ev({ baseline: 0 })]), null);
  assert.equal(summariseDoc2md([]), null);
  // zero tokens: the ratio divides by one
  assert.equal(summariseDoc2md([ev({ tokens: 0, baseline: 50 })]).byExt[0].x, 50);
  // a tie on the ratio sorts by extension
  const tie = summariseDoc2md([ev({ ext: 'zz', tokens: 10, baseline: 20 }), ev({ ext: 'aa', tokens: 10, baseline: 20 })]);
  assert.deepEqual(tie.byExt.map((r) => r.ext), ['aa', 'zz']);
});

test('doc2md main writes the file and refuses an empty ledger without writing', async () => {
  const { main } = await import('../scripts/evals/doc2md.mjs');
  const root = tmp('doc2md');
  try {
    const out = join(root, 'doc2md.json');
    const logs = [];
    assert.equal(main({ out, log: (m) => logs.push(m), events: [{ ts: Date.parse('2026-09-06T00:00:00Z'), ext: '.docx', tokens: 5, baseline: 50, usd: 0.1 }] }), 0);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.n, 1);
    assert.equal(j.pct, 90);
    assert.ok(logs.some((m) => /doc2md: 1 documents/.test(m)));
    const none = join(root, 'none.json');
    assert.equal(main({ out: none, log: quiet, events: [{ ext: '.pdf', tokens: 1, baseline: 0, ts: 1 }] }), 1);
    assert.ok(!existsSync(none));
  } finally { rm(root); }
});

test('bulk --impl-large adds implLarge like --impl and the flag without a value is a usage error', () => {
  const root = tmp('large');
  try {
    const mk = (name, f) => { const d = join(root, name); mkdirSync(d); for (const [k, v] of Object.entries(f)) writeFileSync(join(d, `${k}.json`), JSON.stringify(v)); return d; };
    const round = implRoundObj([{ ...W1, id: 'a' }, { ...W1, id: 'b' }]);
    const runs = {}, cost = {}, scores = {};
    for (const id of ['a', 'b']) for (const k of ['S', 'B']) {
      runs[`${id}-${k}`] = { case: id, condition: CONDS.find((c) => c.key === k).id };
      cost[`${id}-${k}`] = { usd: 1, ms: 2000, diff: { files: 1, insertions: 2, deletions: 1 } };
      scores[`${id}-${k}`] = { verdict: 'ok', verified: 1, wrong: 0, missed: 0, tests: 'pass', mode: 'verify' };
    }
    const largeDir = mk('large', { round, runs, cost, scores_by_run: scores });
    const refConds = [{ key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', prompt: 'original' }, { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' }];
    const refDir = mk('ref', { round: { id: 'rr', tier: 'numbers', grading: 'reference', conditions: refConds, cases: [{ id: 'k', conditions: ['B'] }] }, runs: { 'k-B': { case: 'k', condition: 'opus-direct' } }, cost: { 'k-B': { usd: 1, ms: 1000 } }, scores_by_run: { 'k-B': { verdict: 'ok', reference: true } } });
    const plainOut = join(root, 'plain.json'), largeOut = join(root, 'large.json'), bothOut = join(root, 'both.json');
    assert.equal(bulkMain([refDir], { out: plainOut, log: quiet }), 0);
    assert.equal(bulkMain([refDir, '--impl-large', largeDir], { out: largeOut, log: quiet }), 0);
    const j = JSON.parse(readFileSync(largeOut, 'utf8'));
    assert.deepEqual(j.implLarge, implRound({ round, runs, cost, scores }));
    assert.equal(j.implLarge.n, 2);
    assert.equal(j.impl, undefined);
    delete j.implLarge;
    assert.equal(JSON.stringify(j, null, 2) + '\n', readFileSync(plainOut, 'utf8'));
    // alongside --impl: both keys, each from its own directory
    assert.equal(bulkMain([refDir, '--impl', largeDir, '--impl-large', largeDir], { out: bothOut, log: quiet }), 0);
    const both = JSON.parse(readFileSync(bothOut, 'utf8'));
    assert.deepEqual(both.impl, both.implLarge);
    assert.equal(bulkMain([refDir, '--impl-large'], { out: join(root, 'x.json'), log: quiet }), 2);
    assert.equal(bulkMain(['--impl-large', largeDir], { out: join(root, 'y.json'), log: quiet }), 2);
    assert.equal(bulkMain([refDir, '--impl-large', join(root, 'missing')], { out: join(root, 'z.json'), log: quiet }), 1);
  } finally { rm(root); }
});

// ---------------------------------------------------------------- reviewround
test('reviewround seeds the sub-agent change, copies the baseline and replay stages the seed once', async () => {
  const { reviewround, reviewPrompt, REVIEW_CONDITION } = await import('../scripts/evals/reviewround.mjs');
  const text = reviewPrompt({ task: 'Do X in {{REPO}}.', report: 'Did X.', base: 'abc1234' });
  assert.match(text, /git -C \{\{REPO\}\} diff --cached abc1234/);
  assert.match(text, /# The task you handed off\n\nDo X in \{\{REPO\}\}\.\n\n# The sub-agent's report\n\nDid X\./);
  assert.ok(!/sonnet|opus|haiku/i.test(text), 'no model name in the prompt');

  const wtRoot = tmp('rwt'); const prevWt = process.env.SPRAG_EVALS_WT; process.env.SPRAG_EVALS_WT = wtRoot;
  const root = tmp('rounds'); const src = join(root, 'src');
  const kept = { id: 'k1', prompt: 'cases/k1.md', rubric: 'rubric/k1.md', repo: '/r/a', commit: 'abc1234', write: true, conditions: ['S', 'B'], meta: { kind: 'implement' } };
  const dropped = { ...kept, id: 'k2', prompt: 'cases/k2.md', rubric: 'rubric/k2.md', meta: { kind: 'implement', excluded: 'not-reproducible-at-commit' } };
  const srcRound = {
    id: 'src', date: '2026-11-14', kind: 'conditions', repo: '/r/a', commit: 'abc1234', repeats: 1, concurrency: 2, timeoutMin: 45,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'], grading: 'verify', rule: 'impl-v1', tier: 'numbers',
    conditions: [{ key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker', prompt: 'original' },
      { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' }],
    cases: [kept, dropped],
  };
  try {
    for (const d of ['cases', 'rubric', 'reports', 'diffs', 'transcripts']) mkdirSync(join(src, d), { recursive: true });
    writeFileSync(join(src, 'round.json'), JSON.stringify(srcRound));
    const runs = {}, cost = {};
    for (const c of [kept, dropped]) {
      writeFileSync(join(src, c.prompt), `Task ${c.id} in {{REPO}}.`); writeFileSync(join(src, c.rubric), 'rubric');
      for (const k of ['S', 'B']) {
        runs[`${c.id}-${k}`] = { case: c.id, condition: k === 'S' ? 'sonnet-high' : 'opus-direct' }; cost[`${c.id}-${k}`] = { usd: k === 'S' ? 1 : 2, ms: 1000 };
        writeFileSync(join(src, 'reports', `${c.id}-${k}.md`), `report ${k}`); writeFileSync(join(src, 'diffs', `${c.id}-${k}.patch`), `PATCH ${k}\n`);
        writeFileSync(join(src, 'transcripts', `${c.id}-${k}.jsonl`), '');
      }
    }
    writeFileSync(join(src, 'runs.json'), JSON.stringify(runs)); writeFileSync(join(src, 'cost.json'), JSON.stringify(cost));
    const gitCalls = [];
    const { round, dir } = reviewround(src, { id: 'rev', root, git: (a) => { gitCalls.push(a.join(' ')); if (a[2] === 'worktree') mkdirSync(a[5], { recursive: true }); return ''; }, log: quiet, date: '2026-11-14' });
    assert.deepEqual(validateRound(round), []);
    assert.deepEqual(round.cases.map((c) => c.id), ['k1'], 'the excluded case is left out');
    assert.deepEqual([round.rule, round.baselineFrom, round.conditions.map((c) => c.key).join('')], ['impl-review-v1', 'src', 'RB']);
    assert.deepEqual(round.cases[0].seedPatch, { [REVIEW_CONDITION.key]: 'seed/k1.patch' });
    assert.equal(readFileSync(join(dir, 'seed', 'k1.patch'), 'utf8'), 'PATCH S\n');
    assert.match(readFileSync(join(dir, 'review', 'k1.md'), 'utf8'), /Task k1 in \{\{REPO\}\}\.[\s\S]*report S/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'))), ['k1-B'], 'only the baseline run is carried over');
    const bWt = writeWorktreeFor(round, round.cases[0], 'k1-B').wt;
    assert.ok(gitCalls.some((c) => c === `-C /r/a worktree add --detach ${bWt} abc1234`) && gitCalls.some((c) => c === `-C ${bWt} apply --index ${join(dir, 'diffs', 'k1-B.patch')}`), 'the baseline copy is rebuilt from its saved diff');

    // replay: the R run starts from the seed patch, staged once when its copy is made
    const outCalls = [];
    const child = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { on() {}, end() { setImmediate(() => { c.stdout.emit('data', JSON.stringify({ result: 'reviewed' })); c.emit('close', 0); }); } }; return c; };
    await replay(dir, { yes: true, spawn: () => child(), git: (a) => mkdirSync(a[5], { recursive: true }), gitOut: (a) => { outCalls.push(a.slice(2).join(' ')); return ''; }, log: quiet, costFilesList: [], caps: async () => ({ fiveHour: null, sevenDay: null, source: 'file' }), sleep: async () => {} });
    assert.equal(outCalls.filter((c) => c === `apply --index ${join(dir, 'seed', 'k1.patch')}`).length, 1);
    assert.ok(outCalls.indexOf(`apply --index ${join(dir, 'seed', 'k1.patch')}`) < outCalls.indexOf('add -A'), 'seeded before the run, diffed after');
    assert.equal(readFileSync(join(dir, 'reports', 'k1-R.md'), 'utf8'), 'reviewed');
  } finally { if (prevWt === undefined) delete process.env.SPRAG_EVALS_WT; else process.env.SPRAG_EVALS_WT = prevWt; rm(wtRoot, root); }
});

// ---------------------------------------------------------------- specround
const OLD_CAP = 'Cap for this delegation: 20 tool calls, 6,100 output tokens.';
const APPENDIX = (extra = '') => `<!-- sprag:delegation -->\n\n## Bounds and output shape\n\nold bounds text\n\n${OLD_CAP}\n${extra}`;
const STYLE = '\n## Korean style guidance\n\nstyle  text\n   with odd   spacing\n';
const SPEC_BOUNDS = 'NEW BOUNDS BODY';

test('specPrompt keeps the text verbatim, trims both arguments and leaves {{REPO}} literal', async () => {
  const { specPrompt } = await import('../scripts/evals/specround.mjs');
  const t = specPrompt({ draft: '\n  Draft body {{REPO}}/a.js\n\n', standard: '  STANDARD TEXT\n' });
  assert.match(t, /^You are the main model of a coding session\. You settled the design in the draft below/);
  assert.ok(t.includes('The repository copy is at {{REPO}}, at the commit the work starts from.\n\n# Standard\n\nSTANDARD TEXT\n\n# What to do\n\n1. Keep the design and the scope of the draft.'));
  assert.ok(t.includes('5. Refer to the repository only by the path {{REPO}}.\n\nAnswer with ONLY the specification text.'));
  assert.ok(t.endsWith('# The draft\n\nDraft body {{REPO}}/a.js\n'));
});

test('specHandOff swaps only the bounds section, builds one when missing and picks the cap line like the guard', async () => {
  const { specHandOff } = await import('../scripts/evals/specround.mjs');
  const { IMPLEMENTATION_CAP_LINE } = await import('../src/delegation-guard.js');
  const impl = 'Files to change: {{REPO}}/src/a.js\nImplement the parser as designed.';
  const a = specHandOff({ spec: `${impl}\n`, originalPrompt: `Task text.\n\n${APPENDIX(STYLE)}`, bounds: SPEC_BOUNDS });
  assert.equal(a.capLine, 'implementation');
  assert.equal(a.text, `${impl}\n\n<!-- sprag:delegation -->\n\n## Bounds and output shape\n\n${SPEC_BOUNDS}\n\n${IMPLEMENTATION_CAP_LINE}\n${STYLE}`);
  assert.ok(!a.text.includes(OLD_CAP) && !a.text.includes('old bounds text'));
  assert.ok(a.text.endsWith('## Korean style guidance\n\nstyle  text\n   with odd   spacing\n'), 'the following section is byte-for-byte');
  // no old appendix: marker plus the one section
  const b = specHandOff({ spec: 'Look at {{REPO}}/x. Budget: about 40 tool calls.', originalPrompt: 'Plain task, no appendix.', bounds: SPEC_BOUNDS });
  assert.equal(b.capLine, 'own');
  assert.equal(b.text, `Look at {{REPO}}/x. Budget: about 40 tool calls.\n\n<!-- sprag:delegation -->\n\n## Bounds and output shape\n\n${SPEC_BOUNDS}\n\nCap for this delegation: the budget stated in your prompt above. It replaces the default cap.\n`);
  const c = specHandOff({ spec: 'Explain {{REPO}}/x.', originalPrompt: APPENDIX(), bounds: SPEC_BOUNDS });
  assert.equal(c.capLine, 'numeric');
  assert.equal(c.text, `Explain {{REPO}}/x.\n\n<!-- sprag:delegation -->\n\n## Bounds and output shape\n\n${SPEC_BOUNDS}\n\nCap for this delegation: 20 tool calls, 8,000 output tokens.\n`);
  for (const r of [a, b, c]) assert.ok(!r.text.includes(OLD_CAP));
});

/** A source implementation round on disk: k1 kept, k2 excluded, k3 kept but its specification never arrives. */
function specSource(root) {
  const src = join(root, 'src');
  const mkCase = (id, extra = {}) => ({ id, prompt: `cases/${id}.md`, rubric: `rubric/${id}.md`, repo: '/r/a', commit: 'abc1234', write: true, conditions: ['S', 'B'], seedPatch: { S: 'x.patch' }, meta: { kind: 'implement', ...extra } });
  const cases = [mkCase('aaaaaaaaaa'), mkCase('bbbbbbbbbb', { excluded: 'not-reproducible-at-commit' }), mkCase('cccccccccc')];
  const srcRound = {
    id: 'src', date: '2026-11-14', kind: 'conditions', repo: '/r/a', commit: 'abc1234', repeats: 1, concurrency: 2, timeoutMin: 45,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'], grading: 'verify', rule: 'impl-v1', tier: 'numbers', conditions: CONDS, cases,
  };
  for (const d of ['cases', 'rubric', 'reports', 'diffs', 'transcripts']) mkdirSync(join(src, d), { recursive: true });
  writeFileSync(join(src, 'round.json'), JSON.stringify(srcRound));
  const runs = {}, cost = {};
  for (const c of cases) {
    writeFileSync(join(src, c.prompt), `Task ${c.id} in {{REPO}}.\n\n${APPENDIX(STYLE)}`); writeFileSync(join(src, c.rubric), 'rubric');
    for (const k of ['S', 'B']) {
      runs[`${c.id}-${k}`] = { case: c.id, condition: k === 'S' ? 'sonnet-high' : 'opus-direct' }; cost[`${c.id}-${k}`] = { usd: k === 'S' ? 1 : 2, ms: 1000 };
      writeFileSync(join(src, 'reports', `${c.id}-${k}.md`), `report ${k}`); writeFileSync(join(src, 'diffs', `${c.id}-${k}.patch`), k === 'S' ? 'PATCH S\n' : '');
      writeFileSync(join(src, 'transcripts', `${c.id}-${k}.jsonl`), '');
    }
  }
  writeFileSync(join(src, 'runs.json'), JSON.stringify(runs)); writeFileSync(join(src, 'cost.json'), JSON.stringify(cost));
  return src;
}

test('specPrep builds a read-only round A with the standard and the draft without its appendix', async () => {
  const { specPrep } = await import('../scripts/evals/specround.mjs');
  const root = tmp('specprep'); const src = specSource(root);
  try {
    const { round, dir } = specPrep(src, { id: 'specA', root, log: quiet, date: '2026-11-15' });
    assert.deepEqual(validateRound(round), []);
    assert.deepEqual(round.conditions, [{ key: 'P', id: 'opus-spec', model: 'claude-opus-5-5', effort: 'high', prompt: 'improved', role: 'baseline' }]);
    assert.deepEqual(round.cases.map((c) => c.id), ['aaaaaaaaaa', 'cccccccccc'], 'the excluded case is left out');
    assert.deepEqual([round.rule, round.grading, round.date], ['impl-spec-prep-v1', 'verify', '2026-11-15']);
    for (const c of round.cases) {
      assert.deepEqual([c.write, c.conditions, c.improvedPrompt, c.meta.sourceRound, 'seedPatch' in c], [false, ['P'], `specprompt/${c.id}.md`, 'src', false]);
      const p = readFileSync(join(dir, c.improvedPrompt), 'utf8');
      assert.ok(p.includes(`Task ${c.id} in {{REPO}}.`) && !p.includes('sprag:delegation') && !p.includes('old bounds text'));
      assert.ok(p.includes('other callers'), 'the English standard is inlined');
      assert.ok(existsSync(join(dir, c.prompt)) && existsSync(join(dir, c.rubric)));
    }
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8')), {});
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')), {});
    assert.throws(() => specPrep(src, { id: 'specA', root, log: quiet }), /round already exists/);
    assert.throws(() => specPrep(src, { id: 'bad id', root, log: quiet }), /slug/);
  } finally { rm(root); }
});

test('specApply writes round B with N, S, B, the worker agents file, rebuilt copies and the spec hand-offs', async () => {
  const { specPrep, specApply } = await import('../scripts/evals/specround.mjs');
  const { IMPLEMENTATION_CAP_LINE } = await import('../src/delegation-guard.js');
  const wtRoot = tmp('swt'); const prevWt = process.env.SPRAG_EVALS_WT; process.env.SPRAG_EVALS_WT = wtRoot;
  const root = tmp('specapply'); const src = specSource(root);
  try {
    const { dir: dirA, round: roundA } = specPrep(src, { id: 'specA', root, log: quiet, date: '2026-11-15' });
    const wtA = (id) => join(dirA, 'wt', id);
    mkdirSync(join(dirA, 'reports'), { recursive: true });
    writeFileSync(join(dirA, 'reports', 'aaaaaaaaaa-P.md'), `  Files to change: ${wtA('aaaaaaaaaa')}/src/a.js\nImplement it as designed. Tests: node --test ${wtA('aaaaaaaaaa')}/test/a.test.js\n`);
    writeFileSync(join(dirA, 'runs.json'), JSON.stringify({ 'aaaaaaaaaa-P': { case: 'aaaaaaaaaa', condition: 'opus-spec' }, 'cccccccccc-P': { case: 'cccccccccc', condition: 'opus-spec' } }));
    writeFileSync(join(dirA, 'cost.json'), JSON.stringify({ 'aaaaaaaaaa-P': { usd: 3, ms: 5000 } }));
    const logs = []; const gitCalls = [];
    const git = (a) => { gitCalls.push(a.join(' ')); if (a[2] === 'worktree') mkdirSync(a[5], { recursive: true }); return ''; };
    const { round, dir } = specApply(dirA, src, { id: 'specB', root, git, log: (m) => logs.push(m), date: '2026-11-15' });
    assert.deepEqual(validateRound(round), []);
    assert.deepEqual(round.conditions.map((c) => c.key), ['N', 'S', 'B']);
    assert.deepEqual(round.conditions[0], { key: 'N', id: 'sonnet-spec', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker-next', agentsFile: 'agents.json', prompt: 'improved' });
    assert.deepEqual([round.rule, round.baselineFrom, round.specFrom], ['impl-spec-v1', 'src', roundA.id]);
    assert.deepEqual(round.cases.map((c) => c.id), ['aaaaaaaaaa'], 'excluded and spec-less cases are left out');
    assert.ok(logs.includes('skipped cccccccccc: no specification'));
    const c = round.cases[0];
    assert.deepEqual([c.improvedPrompt, c.conditions, c.meta.capLine, c.meta.specRound, c.meta.sourceRound, 'seedPatch' in c], ['spec/aaaaaaaaaa.md', ['N', 'S', 'B'], 'implementation', 'specA', 'src', false]);
    const text = readFileSync(join(dir, 'spec', 'aaaaaaaaaa.md'), 'utf8');
    assert.ok(text.startsWith('Files to change: {{REPO}}/src/a.js\n') && text.includes('node --test {{REPO}}/test/a.test.js'));
    assert.ok(!text.includes(dirA) && !text.includes(OLD_CAP));
    assert.ok(text.includes(IMPLEMENTATION_CAP_LINE) && text.includes('\n## Bounds and output shape\n\n'));
    assert.ok(text.endsWith('## Korean style guidance\n\nstyle  text\n   with odd   spacing\n'));
    const agents = JSON.parse(readFileSync(join(dir, 'agents.json'), 'utf8'));
    const worker = JSON.parse(readFileSync(new URL('../presets/agents.json', import.meta.url), 'utf8')).agents.find((a) => a.name === 't1-worker');
    assert.deepEqual(Object.keys(agents), ['t1-worker-next']);
    assert.deepEqual(agents['t1-worker-next'], { description: worker.description.en, prompt: worker.body.en, tools: worker.tools, model: 'sonnet' });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'))).sort(), ['aaaaaaaaaa-B', 'aaaaaaaaaa-S']);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'))['aaaaaaaaaa-S'], { usd: 1, ms: 1000 });
    assert.equal(readFileSync(join(dir, 'reports', 'aaaaaaaaaa-S.md'), 'utf8'), 'report S');
    assert.equal(readFileSync(join(dir, 'diffs', 'aaaaaaaaaa-S.patch'), 'utf8'), 'PATCH S\n');
    const wtS = writeWorktreeFor(round, c, 'aaaaaaaaaa-S').wt, wtB = writeWorktreeFor(round, c, 'aaaaaaaaaa-B').wt;
    assert.deepEqual(gitCalls.filter((g) => g.includes(' worktree add ')).sort(), [`-C /r/a worktree add --detach ${wtS} abc1234`, `-C /r/a worktree add --detach ${wtB} abc1234`].sort());
    assert.deepEqual(gitCalls.filter((g) => g.includes(' apply ')), [`-C ${wtS} apply --index ${join(dir, 'diffs', 'aaaaaaaaaa-S.patch')}`], 'the empty baseline patch is not applied');
    assert.ok(logs.some((m) => /1 case\(s\), 1 run\(s\) to replay, cap lines implementation 1 \/ own 0 \/ numeric 0/.test(m)));

    // bulk: --impl-spec needs --spec and adds the specification cost
    const { implSpecRound } = await import('../scripts/evals/bulk.mjs');
    const scores = { 'aaaaaaaaaa-N': { verdict: 'ok', verified: 1, wrong: 0, missed: 0, mode: 'verify' }, 'aaaaaaaaaa-S': { verdict: 'partial', verified: 1, wrong: 1, missed: 0, mode: 'verify' }, 'aaaaaaaaaa-B': { verdict: 'ok', verified: 1, wrong: 0, missed: 0, mode: 'verify' } };
    const runsB = { ...JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8')), 'aaaaaaaaaa-N': { case: 'aaaaaaaaaa', condition: 'sonnet-spec' } };
    const costB = { ...JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')), 'aaaaaaaaaa-N': { usd: 0.5, ms: 2000 } };
    const loadedA = { round: roundA, runs: JSON.parse(readFileSync(join(dirA, 'runs.json'), 'utf8')), cost: JSON.parse(readFileSync(join(dirA, 'cost.json'), 'utf8')), scores: {} };
    const im = implSpecRound({ round, runs: runsB, cost: costB, scores }, loadedA);
    assert.deepEqual(im.spec, { n: 1, usd: 3, sec: 5 });
    assert.deepEqual(im.capLines, { implementation: 1, own: 0, numeric: 0 });
    assert.deepEqual(im.conditions.map((x) => [x.id, x.ok, x.partial]), [['sonnet-spec', 1, 0], ['sonnet-high', 0, 1], ['opus-direct', 1, 0]]);
    const bulkRoot = tmp('bulkspec');
    try {
      const mk = (name, f) => { const d = join(bulkRoot, name); mkdirSync(d); for (const [k, v] of Object.entries(f)) writeFileSync(join(d, `${k}.json`), JSON.stringify(v)); return d; };
      const refConds = [{ key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', prompt: 'original' }, { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' }];
      const refDir = mk('ref', { round: { id: 'rr', tier: 'numbers', grading: 'reference', conditions: refConds, cases: [{ id: 'k', conditions: ['B'] }] }, runs: { 'k-B': { case: 'k', condition: 'opus-direct' } }, cost: { 'k-B': { usd: 1, ms: 1000 } }, scores_by_run: { 'k-B': { verdict: 'ok', reference: true } } });
      const bDir = mk('b', { round, runs: runsB, cost: costB, scores_by_run: scores });
      const aDir = mk('a', { round: roundA, runs: loadedA.runs, cost: loadedA.cost });
      const out = join(bulkRoot, 'o.json');
      assert.equal(bulkMain([refDir, '--impl-spec', bDir, '--spec', aDir], { out, log: quiet }), 0);
      const j = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual([j.implSpec.spec, j.implSpec.capLines], [{ n: 1, usd: 3, sec: 5 }, { implementation: 1, own: 0, numeric: 0 }]);
      assert.equal(bulkMain([refDir, '--impl-spec', bDir], { out, log: quiet }), 2);
      assert.equal(bulkMain([refDir, '--spec', aDir], { out, log: quiet }), 2);
    } finally { rm(bulkRoot); }

    // a specification that still names the repository root fails the whole apply and writes nothing
    writeFileSync(join(dirA, 'reports', 'aaaaaaaaaa-P.md'), 'Implement it in /r/a/src/a.js, files to change: /r/a/src/a.js');
    assert.throws(() => specApply(dirA, src, { id: 'specC', root, git, log: quiet }), /specification for aaaaaaaaaa still names the repository root/);
    assert.ok(!existsSync(join(root, 'specC')));
  } finally { if (prevWt === undefined) delete process.env.SPRAG_EVALS_WT; else process.env.SPRAG_EVALS_WT = prevWt; rm(wtRoot, root); }
});

test('specround main: bad arguments exit 2', async () => {
  const { main } = await import('../scripts/evals/specround.mjs');
  const err = console.error; console.error = quiet;
  try {
    assert.equal(main([]), 2); assert.equal(main(['prep', 'x']), 2); assert.equal(main(['apply', 'x', '--id', 'y']), 2); assert.equal(main(['other', 'x', '--id', 'y']), 2);
    assert.equal(main(['prep', join(tmpdir(), 'sprag-no-such-round'), '--id', 'y']), 1);
  } finally { console.error = err; }
});

test('claudeArgs puts --agents right after --agent only when a file is given; validateRound guards the path', () => {
  const cond = { key: 'N', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker-next' };
  const plain = claudeArgs(cond, 'sid', { allowedTools: ['Read'] });
  assert.ok(!plain.includes('--agents'));
  const withFile = claudeArgs(cond, 'sid', { allowedTools: ['Read'], agentsFile: '/x/agents.json' });
  const i = withFile.indexOf('--agent');
  assert.deepEqual(withFile.slice(i, i + 4), ['--agent', 't1-worker-next', '--agents', '/x/agents.json']);
  assert.deepEqual(withFile.filter((a) => a !== '--agents' && a !== '/x/agents.json'), plain);
  const r = implRoundObj([W1]);
  assert.deepEqual(validateRound({ ...r, conditions: [{ ...CONDS[0], agentsFile: 'agents.json' }, CONDS[1]] }), []);
  assert.ok(validateRound({ ...r, conditions: [{ ...CONDS[0], agentsFile: '../agents.json' }, CONDS[1]] }).some((e) => /agentsFile/.test(e)));
  assert.ok(validateRound({ ...r, conditions: [{ ...CONDS[0], agentsFile: 'a b.json' }, CONDS[1]] }).some((e) => /agentsFile/.test(e)));
});

test('replay passes the condition agents file in the dry run and refuses a round that lacks it', async () => {
  const round = { ...implRoundObj([W1]), conditions: [{ ...CONDS[0], agentsFile: 'agents.json' }, CONDS[1]] };
  const dir = roundDir(round); const lines = [];
  try {
    await assert.rejects(replay(dir, { dryRun: true, log: quiet, costFilesList: [] }), /agents file missing for condition S: agents\.json/);
    writeFileSync(join(dir, 'agents.json'), '{}');
    await replay(dir, { dryRun: true, log: (m) => lines.push(m), costFilesList: [] });
    const s = lines.find((l) => l.includes('[w1-S]')); const b = lines.find((l) => l.includes('[w1-B]'));
    assert.ok(s.includes(`--agent t1-worker --agents ${join(dir, 'agents.json')} `), s);
    assert.ok(!b.includes('--agents'));
  } finally { rm(dir); }
});

test('claudeArgs: round.noDelegation denies the delegating sub-agent types and leaves other rounds unchanged', async () => {
  const { claudeArgs, NO_DELEGATION_DENY } = await import('../scripts/evals/replay.mjs');
  const { validateRound } = await import('../scripts/evals/lib.mjs');
  const cond = { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' };
  const off = claudeArgs(cond, 'sid');
  assert.deepEqual(off.slice(off.indexOf('--disallowedTools') + 1), ['Edit', 'Write', 'NotebookEdit']);
  const ro = claudeArgs(cond, 'sid', { noDelegation: true });
  assert.deepEqual(ro.slice(ro.indexOf('--disallowedTools') + 1), ['Edit', 'Write', 'NotebookEdit', ...NO_DELEGATION_DENY]);
  const rw = claudeArgs(cond, 'sid', { write: true, deny: ['Bash(git push:*)'], noDelegation: true });
  assert.deepEqual(rw.slice(rw.indexOf('--disallowedTools') + 1), ['Bash(git push:*)', ...NO_DELEGATION_DENY]);
  assert.ok(NO_DELEGATION_DENY.includes('Agent(t1-worker)') && NO_DELEGATION_DENY.includes('Agent(t2-explore)'));
  assert.ok(!NO_DELEGATION_DENY.some((d) => /web-fetch/.test(d)), 'the web-fetch stand-in stays allowed');
  const round = { id: 'r', date: '2026-11-14', kind: 'conditions', repo: '/home/me/repo', commit: 'abcdef1', conditions: [cond], cases: [{ id: 'a', prompt: 'p', rubric: 'r' }], noDelegation: 'yes' };
  assert.ok(validateRound(round).some((e) => /noDelegation/.test(e)));
});
