// Unit tests for scripts/evals/{lib,harvest,replay,grade,publish}.mjs.
// No real `claude`, no network: spawn is injected, every file lives in a temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ratesAt } from '../src/cost.js';
import {
  maskSecrets, scrub, scrubDeep, findPrivacyHit, excerptOf, capped, costOfTranscript, buildTrace, labelFor, countWebSearches,
  validateRound, blindOrder, stripModelLines, extractJsonObject, validateGrades, normalizeGrades, pyRound, shortModel,
  cleanEnv, sha10, readReport,
} from '../scripts/evals/lib.mjs';
import { parseCandidates, genuineUserText, harvest } from '../scripts/evals/harvest.mjs';
import { claudeArgs, planRuns, replay } from '../scripts/evals/replay.mjs';
import { grade, gradeArgs, buildGradePrompt, parseGraderReply } from '../scripts/evals/grade.mjs';
import { buildCase, mergeCorpus, publish, publicCondition } from '../scripts/evals/publish.mjs';
import { loadCorpus, validateCorpus, writeAll, staleFiles } from '../scripts/evals/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS = join(ROOT, 'evals');
const quiet = () => {};
const tmp = (name) => mkdtempSync(join(tmpdir(), `sprag-${name}-`));
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
// Private names reach the privacy check from the machine (SPRAG_EVALS_PRIVATE_NAMES
// or a git-ignored file), so the tests configure neutral ones and never hold a
// real name. OWNER uses a different separator than the configured name on purpose.
process.env.SPRAG_EVALS_PRIVATE_NAMES = 'jane.doe,jdoe';
const OWNER = 'jane-doe';
const NAME = 'jdoe';

// ---------------------------------------------------------------- fixtures
const T0 = Date.parse('2026-11-07T10:00:00.000Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();

/** Two assistant messages: m1 (thinking + Read, usage repeated on both entries) and m2 (text + Bash). */
function transcript(model, { readPath = '/Users/someone/projects/sprag/src/cost.js' } = {}) {
  const usage = (input, out, read, create) => ({
    input_tokens: input, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: create,
    cache_creation: { ephemeral_5m_input_tokens: create, ephemeral_1h_input_tokens: 0 },
  });
  const a = (sec, id, u, content) => ({ type: 'assistant', timestamp: iso(sec), message: { id, model, usage: u, content } });
  const read = { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: readPath } };
  return [
    { type: 'user', timestamp: iso(0), message: { role: 'user', content: 'go' } },
    a(2, 'm1', usage(100000, 3000, 1000000, 200000), [{ type: 'thinking', thinking: 'hmm' }]),
    a(3.2, 'm1', usage(100000, 6000, 1000000, 200000), [read]),
    a(3.3, 'm1', usage(100000, 6000, 1000000, 200000), [read]), // same tool_use block again: counted once
    { type: 'user', timestamp: iso(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } },
    a(6, 'm2', usage(10000, 1500, 1300000, 0), [{ type: 'text', text: 'done' }]),
    a(6.5, 'm2', usage(10000, 4000, 1300000, 0), [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'cd /Users/someone/projects/sprag && npm test 2>&1 | tail -5' } }]),
  ];
}
const writeJsonl = (file, entries) => writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 1));

const CONDS = [
  { key: 'B', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
  { key: 'D', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
];
const baseRound = (over = {}) => ({
  id: 'rt', date: '2026-11-07', kind: 'conditions', repo: '/tmp/some-repo', commit: 'abc1234', repeats: 1,
  conditions: CONDS, cases: [{ id: 't1', prompt: 'cases/t1.md', rubric: 'rubric/t1.md' }], ...over,
});
const biText = (t) => ({ ko: `${t} 한국어`, en: `${t} english` });
const publicEntry = (over = {}) => ({
  id: 't1', kind: 'lookup', story: 'cost-down', publish: true, recommended: 'sonnet-high',
  storyNote: biText('note'), title: biText('title'), userPrompt: biText('prompt'), task: biText('task'),
  truth: biText('truth'), lesson: biText('lesson'), ...over,
});

/** A finished, graded round on disk: runs t1-B (sonnet) and t1-D (opus). */
function makeRoundDir({ round = baseRound() } = {}) {
  const dir = tmp('round');
  for (const d of ['reports', 'transcripts', 'cases', 'rubric']) mkdirSync(join(dir, d));
  writeJson(join(dir, 'round.json'), round);
  writeFileSync(join(dir, 'cases', 't1.md'), 'Repo: {{REPO}}. Find the price table.\nRecommended model: sonnet\n');
  writeFileSync(join(dir, 'rubric', 't1.md'), '1. Names the file\n2. Cites a line\n');
  const cost = {};
  const blocked = {};
  for (const [key, model] of [['t1-B', 'claude-sonnet-5-5'], ['t1-D', 'claude-opus-5-5']]) {
    const entries = transcript(model);
    writeJsonl(join(dir, 'transcripts', `${key}.jsonl`), entries);
    const c = costOfTranscript(entries, model);
    cost[key] = { model: c.model, totals: c.totals, usd: c.usd, ms: c.ms, calls: c.calls };
    blocked[key] = { ws_ok: key === 't1-B' ? 3 : 0, ws_blocked: 0 };
  }
  writeFileSync(join(dir, 'reports', 't1-B.md'), 'The table is in /Users/someone/projects/sprag/src/cost.js:12 and the next step is clear.');
  writeFileSync(join(dir, 'reports', 't1-D.md'), 'x'.repeat(9000));
  writeJson(join(dir, 'cost.json'), cost);
  writeJson(join(dir, 'blocked.json'), blocked);
  writeJson(join(dir, 'scores_by_run.json'), {
    't1-B': { items: [2, 2], total: 4, max: 4, relay: '예', key_miss: '' },
    't1-D': { items: [2, 1], total: 3, max: 4, relay: '부분', key_miss: 'Missed the second table.' },
  });
  return dir;
}

// ---------------------------------------------------------------- harvest
test('harvest: candidates skip harness-injected turns and tool results, and mask secrets', () => {
  const secret = 'npm_' + 'a1B2c3D4e5'.repeat(4);
  const entries = [
    { type: 'user', message: { content: `Fix the build, token ${secret}` } },
    { type: 'user', message: { content: '<task-notification>background job done</task-notification>' } },
    { type: 'user', isMeta: true, message: { content: 'meta caveat' } },
    { type: 'assistant', timestamp: '2026-11-07T10:00:00.000Z', message: { content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 't2-explore', model: 'haiku', effort: 'low', description: 'find it', prompt: `Look up X with ${secret}` } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'X is in src/x.js' }] }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'thanks, now the tests' }] } },
    { type: 'assistant', timestamp: '2026-11-07T10:05:00.000Z', message: { content: [
      { type: 'tool_use', id: 'toolu_2', name: 'Task', input: { prompt: 'second' } },
    ] } },
  ];
  assert.equal(genuineUserText(entries[1]), null);
  assert.equal(genuineUserText(entries[2]), null);
  assert.equal(genuineUserText(entries[4]), null);
  const out = parseCandidates(entries, { sessionId: 'sess1', project: 'proj' });
  assert.equal(out.length, 2);
  const [first, second] = out;
  assert.equal(first.id, sha10('sess1toolu_1'));
  assert.equal(first.userPrompt, 'Fix the build, token npm_***REDACTED***');
  assert.equal(first.prompt, 'Look up X with npm_***REDACTED***');
  assert.equal(first.subagentType, 't2-explore');
  assert.equal(first.model, 'haiku');
  assert.equal(first.effort, 'low');
  assert.equal(first.report, 'X is in src/x.js');
  assert.equal(first.nextUserPrompt, 'thanks, now the tests');
  assert.equal(second.userPrompt, 'thanks, now the tests', 'the injected turn never became the user prompt');
  assert.equal(second.nextUserPrompt, null);
  assert.ok(!('_open' in first));
});

test('harvest: scans main transcripts only, honors --days and drops prompts already used', () => {
  const root = tmp('proj'); const work = tmp('work');
  try {
    const proj = join(root, '-some-project');
    mkdirSync(join(proj, 'sess2', 'subagents'), { recursive: true });
    const stamp = new Date().toISOString();
    const delegation = (id, prompt) => ({ type: 'assistant', timestamp: stamp, message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { prompt } }] } });
    writeJsonl(join(proj, 'sess1.jsonl'), [{ type: 'user', message: { content: 'hello' } }, delegation('a1', 'prompt one'), delegation('a2', 'prompt two')]);
    writeJsonl(join(proj, 'sess2', 'subagents', 'agent-x.jsonl'), [delegation('b1', 'nested')]);
    mkdirSync(join(work, 'rounds', 'r9', 'cases'), { recursive: true });
    writeFileSync(join(work, 'rounds', 'r9', 'cases', 'used.md'), 'prompt two\n');
    const got = harvest({ days: 30, root, work });
    assert.deepEqual(got.map((c) => c.prompt), ['prompt one']);
    const lines = readFileSync(join(work, 'candidates.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).project, '-some-project');
    assert.equal(harvest({ days: 30, root, work, project: 'nope' }).length, 0);
  } finally { cleanup(root, work); }
});

// ---------------------------------------------------------------- lib: rounds, blinding, grades
test('validateRound reports each problem', () => {
  assert.deepEqual(validateRound(baseRound()), []);
  const has = (r, re) => assert.ok(validateRound(r).some((e) => re.test(e)), `${re} in ${JSON.stringify(validateRound(r))}`);
  has(null, /must be an object/);
  has(baseRound({ id: 'bad id' }), /id must be/);
  has(baseRound({ date: '07-11-2026' }), /date must be/);
  has(baseRound({ kind: 'other' }), /kind must be/);
  has(baseRound({ repo: 'relative/path' }), /repo must be an absolute/);
  has(baseRound({ commit: 'not-a-sha' }), /commit must be a hex/);
  has(baseRound({ repeats: 0 }), /repeats/);
  has(baseRound({ conditions: [] }), /conditions must be a non-empty/);
  has(baseRound({ conditions: [CONDS[0], { ...CONDS[0], id: 'x' }, CONDS[1]] }), /duplicate condition key/);
  has(baseRound({ conditions: [{ ...CONDS[0], prompt: 'weird' }, CONDS[1]] }), /prompt must be original or improved/);
  has(baseRound({ conditions: [CONDS[0]] }), /exactly one condition needs role "baseline"/);
  has(baseRound({ conditions: [{ ...CONDS[0], prompt: 'improved' }, CONDS[1]] }), /needs improvedPrompt/);
  has(baseRound({ cases: [] }), /cases must be a non-empty/);
  has(baseRound({ cases: [{ id: 't1', prompt: 'p' }] }), /needs id, prompt, rubric/);
  has(baseRound({ cases: [{ id: 't1', prompt: 'p', rubric: 'r', write: 'yes' }] }), /write must be a boolean/);
  has(baseRound({ cases: [{ id: 't1', prompt: 'p', rubric: 'r', agents: { Z: 'x' } }] }), /agents must map condition keys/);
  has(baseRound({ allowedTools: 'Read' }), /allowedTools/);
  assert.deepEqual(validateRound(baseRound({ kind: 'effort', repeats: 3, conditions: [CONDS[0]] })), [], 'an effort round needs no baseline');
  has(baseRound({ kind: 'effort', repeats: 1, conditions: [CONDS[0]] }), /repeats > 1/);
});

test('blindOrder is deterministic, seeded by round and case, and hides run keys', () => {
  const keys = ['476-B', '476-C', '476-D'];
  const a = blindOrder('r2', '476', keys);
  assert.deepEqual(a, blindOrder('r2', '476', [...keys].reverse()), 'input order does not matter');
  assert.deepEqual(Object.keys(a), ['P', 'Q', 'R']);
  assert.deepEqual(Object.values(a).sort(), keys);
  const seen = new Set(['r2:476', 'r2:404', 'r3:476', 'r3:404', 'r4:1', 'r5:9'].map((s) => JSON.stringify(blindOrder(s.split(':')[0], s.split(':')[1], keys))));
  assert.ok(seen.size > 1, 'different seeds give different orders');
  assert.equal(Object.keys(blindOrder('r', 'c', Array.from({ length: 26 }, (_, i) => `k${i}`))).length, 26);
  assert.throws(() => blindOrder('r', 'c', Array.from({ length: 27 }, (_, i) => `k${i}`)), /26 labels/);
});

test('stripModelLines and buildGradePrompt leave no model, effort or agent name', () => {
  const text = 'keep this\nuse sonnet here\nEffort high line\nclaude-opus-5-5 line\nt2-explore did it\nkeep that';
  assert.equal(stripModelLines(text), 'keep this\nkeep that');
  const prompt = buildGradePrompt({
    task: 'Find it.\nRecommended model: haiku',
    rubric: '1. First\nconditions are A Haiku and B Opus',
    reports: [{ label: 'P', text: 'report p\nwritten by sonnet' }, { label: 'Q', text: 'report q' }],
  });
  assert.ok(!/haiku|sonnet|opus|effort|t2-explore/i.test(prompt.split('# Output')[0]));
  assert.match(prompt, /## Report P\n\nreport p/);
  assert.match(prompt, /## Report Q\n\nreport q/);
  assert.match(prompt, /ONLY one JSON object/);
});

test('extractJsonObject finds the JSON object in prose, fences and nested strings', () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"P": {"a": 1}}\n```\nbye'), { P: { a: 1 } });
  assert.deepEqual(extractJsonObject('{"k": "a } brace and \\" quote"} trailing'), { k: 'a } brace and " quote' });
  assert.deepEqual(extractJsonObject('{broken {"ok": true}'), { ok: true });
  assert.equal(extractJsonObject('no object here'), null);
  assert.equal(extractJsonObject('{"unterminated": '), null);
});

test('validateGrades and normalizeGrades', () => {
  const good = (o = {}) => ({ items: [2, 1], total: 3, max: 4, relay: '예', key_miss: '', ...o });
  assert.deepEqual(validateGrades({ P: good(), Q: good({ relay: '부분' }) }, ['P', 'Q']), []);
  const errs = validateGrades({ P: good({ relay: 'maybe' }), Q: good({ key_miss: 5 }), R: good({ total: 9 }), S: { items: 'x' } }, ['P', 'Q', 'R', 'S', 'T']);
  assert.ok(errs.some((e) => /^P: relay invalid/.test(e)));
  assert.ok(errs.some((e) => /^Q: key_miss invalid/.test(e)));
  assert.ok(errs.some((e) => /^R: total 9 exceeds max 4/.test(e)));
  assert.ok(errs.some((e) => /^S: items\/total\/max invalid/.test(e)));
  assert.ok(errs.some((e) => /^missing label T/.test(e)));
  assert.equal(normalizeGrades({ P: good({ total: 99 }) }).P.total, 3, 'total becomes the sum of items');
  assert.equal(normalizeGrades(null), null);
});

test('parseGraderReply unwraps the claude json envelope and validates', () => {
  const labels = ['P', 'Q'];
  const g = { items: [2, 2], total: 4, max: 4, relay: '예', key_miss: '' };
  const envelope = (result, extra = {}) => JSON.stringify({ type: 'result', result, ...extra });
  const ok = parseGraderReply(envelope(`Sure.\n${JSON.stringify({ P: g, Q: { ...g, total: 1 } })}`), labels);
  assert.equal(ok.grades.Q.total, 4, 'normalized to the item sum');
  assert.ok(parseGraderReply(envelope('no json'), labels).errors[0].match(/no JSON/));
  assert.ok(parseGraderReply(envelope(JSON.stringify({ P: g })), labels).errors.some((e) => /missing label Q/.test(e)));
  assert.ok(parseGraderReply(envelope('boom', { is_error: true }), labels).errors[0].match(/claude reported an error/));
  assert.equal(parseGraderReply(JSON.stringify({ P: g, Q: g }), labels).grades.P.relay, '예', 'raw JSON without an envelope');
});

// ---------------------------------------------------------------- lib: privacy and text helpers
test('maskSecrets masks token shapes and leaves ordinary text', () => {
  const ghp = 'ghp_' + 'Ab12'.repeat(9);
  const sk = 'sk-ant-' + 'x9'.repeat(25);
  const out = maskSecrets(`a ${ghp} b ${sk} c ${'npm_' + 'z'.repeat(32)} d AKIA${'A1B2C3D4E5F6G7H8'} plain text`);
  assert.equal(out, 'a ghp_***REDACTED*** b sk-ant-***REDACTED*** c npm_***REDACTED*** d AKIA***REDACTED*** plain text');
  assert.equal(maskSecrets('nothing to see'), 'nothing to see');
  assert.equal(maskSecrets(null), '');
});

test('scrub removes home paths, names and addresses; findPrivacyHit finds what is left', () => {
  assert.equal(scrub('/Users/someone/projects/sprag/src/a.js'), '<repo>/src/a.js');
  assert.equal(scrub('/Users/someone/projects/sprag-team/x'), '<server repo>/x');
  assert.equal(scrub('see /Users/someone/Documents/notes.txt now'), 'see ~/… now');
  assert.equal(scrub('/private/tmp/claude-502/proj/out.txt ok'), '<scratch>/… ok');
  assert.equal(scrub('mail me@example.com please'), 'mail <email> please');
  assert.equal(scrub(`${OWNER} and ${NAME.toUpperCase()}`), ' and ');
  assert.equal(scrub('plain'), 'plain');
  const dirty = { a: ['fine', { b: `see claude-502 here` }], c: 'ok' };
  assert.deepEqual(findPrivacyHit(dirty), { path: 'a[1].b', match: 'claude-502' });
  assert.equal(findPrivacyHit({ a: 'clean', b: [1, 2] }), null);
  assert.equal(findPrivacyHit(scrubDeep({ x: [`/Users/someone/a ${OWNER} me@example.com`] })), null);
  assert.deepEqual(scrubDeep({ k: ['/Users/someone/projects/sprag/a'], n: 3 }), { k: ['<repo>/a'], n: 3 });
  // The joined form is the public GitHub owner name and must stay untouched.
  assert.equal(scrub('github.com/janedoe/sprag'), 'github.com/janedoe/sprag');
  assert.deepEqual(findPrivacyHit({ a: 'by jane_doe' }), { path: 'a', match: 'jane_doe' });
});

test('excerptOf and capped count code points and prefer clean cuts', () => {
  assert.equal(excerptOf('short text'), 'short text');
  const lines = Array.from({ length: 60 }, (_, i) => `line number ${i}`).join('\n');
  const cut = excerptOf(lines, 200);
  assert.ok(cut.endsWith(' …') && !cut.slice(0, -2).endsWith('\n'));
  assert.ok(cut.length <= 202);
  assert.ok(lines.startsWith(cut.slice(0, -2)), 'cut at a line end, nothing rewritten');
  assert.equal(excerptOf('a'.repeat(50), 10), 'a'.repeat(10) + ' …', 'no separator: hard cut');
  assert.deepEqual(capped('abc', 8000), ['abc', false]);
  const [c, truncated] = capped('x'.repeat(9000));
  assert.equal(truncated, true);
  assert.equal(c, 'x'.repeat(8000) + '\n…');
  const emoji = '😀'.repeat(8001);
  assert.equal(capped(emoji)[1], true);
  assert.equal([...capped(emoji)[0]].length, 8002, 'counted in code points, not UTF-16 units');
  assert.equal(capped('😀'.repeat(8000))[1], false);
});

test('pyRound follows Python: exact ties go to the even digit', () => {
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(6.5), 6);
  assert.equal(pyRound(0.25, 1), 0.2);
  assert.equal(pyRound(0.75, 1), 0.8);
  assert.equal(pyRound(25.35, 1), 25.4, '25.35 is a hair above the tie in binary');
  assert.equal(pyRound(1.005, 2), 1, '1.005 is a hair below the tie in binary');
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(0.00415, 4), 0.0042);
  assert.equal(shortModel('claude-sonnet-5-5-20261001'), 'sonnet');
  assert.throws(() => shortModel('claude-fable-5-1'), /cannot map model/);
});

// ---------------------------------------------------------------- lib: cost and trace
test('costOfTranscript prices the last usage per message at the dated rates', () => {
  const r = ratesAt('claude-sonnet-5-5', '2026-11-07');
  assert.deepEqual([r.input, r.cacheWrite5m, r.cacheWrite1h, r.cacheRead, r.output], [2, 2.5, 4, 0.1, 10], 'rates the hand computation below assumes');
  const c = costOfTranscript(transcript('claude-sonnet-5-5'));
  // m1 final: 100000 in, 6000 out, 1000000 read, 200000 5m write. m2 final: 10000 in, 4000 out, 1300000 read.
  assert.deepEqual(c.totals, { input: 110000, cacheCreation: 200000, cacheRead: 2300000, ephemeral5m: 200000, ephemeral1h: 0, output: 10000 });
  // (110000*2 + 200000*2.5 + 2300000*0.1 + 10000*10) / 1e6
  assert.equal(c.exactUsd.toFixed(6), '1.050000');
  assert.equal(c.usd, 1.05);
  assert.equal(c.calls, 2, 'the repeated tool_use block counts once');
  assert.equal(c.ms, 6500);
  assert.equal(c.model, 'claude-sonnet-5-5');
  const opus = costOfTranscript(transcript('claude-opus-5-5'));
  // (110000*4 + 200000*5 + 2300000*0.2 + 10000*20) / 1e6
  assert.equal(opus.usd, 2.1);
});

test('buildTrace emits compact events with cumulative tokens and cost, and labels tools safely', () => {
  const events = buildTrace(transcript('claude-sonnet-5-5'), 'claude-sonnet-5-5', 1.05);
  assert.deepEqual(events, [
    { t: 2, kind: 'think', tok: 1306000, usd: 0.86 },
    { t: 3.2, kind: 'tool', tool: 'Read', arg: 'src/cost.js', tok: 1306000, usd: 0.86 },
    { t: 6, kind: 'text', tok: 2620000, usd: 1.05 },
    { t: 6.5, kind: 'tool', tool: 'Bash', arg: 'npm test 2>&1 | tail -5', tok: 2620000, usd: 1.05 },
  ]);
  assert.throws(() => buildTrace(transcript('claude-sonnet-5-5'), 'claude-sonnet-5-5', 2), /differs from run cost/);
  // cap: thinking is dropped first, then even sampling keeps the first and the last event
  const many = [{ type: 'user', timestamp: iso(0), message: { content: 'go' } }];
  for (let i = 1; i <= 120; i++) many.push({ type: 'assistant', timestamp: iso(i), message: { id: `m${i}`, model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `f${i}.js` } }] } });
  const capped80 = buildTrace(many, 'claude-sonnet-5-5', costOfTranscript(many).exactUsd, 80);
  assert.equal(capped80.length, 80);
  assert.equal(capped80[0].arg, 'f1.js');
  assert.equal(capped80.at(-1).arg, 'f120.js');
});

test('labelFor allowlists arguments and hides anything that looks like a secret', () => {
  assert.equal(labelFor('WebFetch', { url: 'https://example.com/a/b?token=abc#x' }), 'example.com/a/b');
  assert.equal(labelFor('WebSearch', { query: 'node test runner' }), 'node test runner');
  assert.equal(labelFor('Grep', { pattern: 'spawnTeamSync' }), 'spawnTeamSync');
  assert.equal(labelFor('Bash', { command: 'curl -H "Authorization: Bearer abc" x' }), '(hidden)');
  assert.equal(labelFor('Edit', { file_path: '/Users/someone/x' }), '');
  assert.equal(labelFor('Read', { file_path: 'a'.repeat(30) + '/' + 'b'.repeat(70) }), '(hidden)');
});

test('countWebSearches splits executed searches from budget-blocked ones', () => {
  const asst = (id, name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
  const res = (id, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  assert.deepEqual(countWebSearches([asst('s1', 'WebSearch'), res('s1', 'results'), asst('s2', 'WebSearch'), res('s2', 'Web search was not performed (budget)'), asst('r1', 'Read'), res('r1', 'x')]), { ws_ok: 1, ws_blocked: 1 });
});

test('cleanEnv drops API credentials and keeps the rest', () => {
  const env = cleanEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

// ---------------------------------------------------------------- replay
function fakeSpawn() {
  const calls = [];
  const fn = (...args) => { calls.push(args); throw new Error('spawn must not be called'); };
  fn.calls = calls;
  return fn;
}

test('claudeArgs: dontAsk always, deny list unless the case writes, never bypassPermissions', () => {
  const cond = { key: 'A', model: 'claude-haiku-5-5', effort: 'low', agent: 't2-explore' };
  const ro = claudeArgs(cond, 'sid');
  assert.deepEqual(ro, ['-p', '--model', 'claude-haiku-5-5', '--effort', 'low', '--agent', 't2-explore', '--session-id', 'sid', '--output-format', 'json', '--permission-mode', 'dontAsk', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit']);
  const rw = claudeArgs(cond, 'sid', { write: true, agent: 't2-runner', allowedTools: ['Read', 'Bash'] });
  assert.ok(!rw.includes('--disallowedTools'));
  assert.deepEqual(rw.slice(rw.indexOf('--agent'), rw.indexOf('--agent') + 2), ['--agent', 't2-runner']);
  assert.deepEqual(rw.slice(rw.indexOf('--allowedTools')), ['--allowedTools', 'Read', 'Bash', 'Edit', 'Write']);
  for (const a of [ro, rw]) { assert.ok(!a.join(' ').includes('bypassPermissions')); assert.ok(!a.includes('--dangerously-skip-permissions')); }
  assert.ok(!claudeArgs({ ...cond, agent: undefined }, 'sid').includes('--agent'));
});

test('planRuns keys: one per case and condition, with -rep when repeating', () => {
  const round = baseRound({ cases: [{ id: 't1', prompt: 'p', rubric: 'r' }, { id: 't2', prompt: 'p', rubric: 'r' }] });
  assert.deepEqual(planRuns(round).map((r) => r.key), ['t1-B', 't1-D', 't2-B', 't2-D']);
  assert.deepEqual(planRuns(round, 't2').map((r) => r.key), ['t2-B', 't2-D']);
  const eff = baseRound({ kind: 'effort', repeats: 2, conditions: [CONDS[0]] });
  assert.deepEqual(planRuns(eff).map((r) => r.key), ['t1-B-1', 't1-B-2']);
});

test('replay without --yes spawns nothing; --dry-run prints every full command', async () => {
  const round = baseRound({
    allowedTools: ['Read', 'Bash'],
    cases: [{ id: 't1', prompt: 'cases/t1.md', rubric: 'rubric/t1.md', agents: { B: 't2-runner' } }, { id: 't2', prompt: 'cases/t1.md', rubric: 'rubric/t1.md', write: true }],
  });
  const dir = makeRoundDir({ round });
  try {
    const spawn = fakeSpawn(); const lines = [];
    const log = (l) => lines.push(l);
    assert.deepEqual(await replay(dir, { spawn, log, costFilesList: [] }), { started: 0 });
    assert.ok(lines.some((l) => /stopped before running: pass --yes/.test(l)));
    assert.ok(lines.some((l) => /estimated tokens/.test(l)));
    assert.ok(!existsSync(join(dir, 'wt')) && !existsSync(join(dir, 'runs.json')), 'nothing written');

    lines.length = 0;
    await replay(dir, { spawn, log, dryRun: true, costFilesList: [] });
    assert.equal(spawn.calls.length, 0);
    const cmds = lines.filter((l) => /^\s+\[t\d-[BD]\]/.test(l));
    assert.equal(cmds.length, 4);
    const byKey = Object.fromEntries(cmds.map((l) => [l.match(/\[(t\d-[BD])\]/)[1], l]));
    for (const l of cmds) {
      assert.match(l, /env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude -p --model claude-/);
      assert.match(l, /--permission-mode dontAsk/);
      assert.match(l, /--allowedTools Read Bash/);
      assert.ok(!/bypassPermissions/.test(l));
    }
    assert.match(byKey['t1-B'], /--agent t2-runner/);
    assert.match(byKey['t1-B'], /--disallowedTools Edit Write NotebookEdit/);
    assert.ok(!/--agent/.test(byKey['t1-D']));
    assert.ok(!/--disallowedTools/.test(byKey['t2-B']) && /Edit Write/.test(byKey['t2-B']), 'a write case is not denied Edit/Write');
    assert.ok(lines.some((l) => /git -C .* worktree add --detach .* abc1234/.test(l)));
    await assert.rejects(replay(dir, { spawn, log, only: 'nope', costFilesList: [] }), /no case nope/);
  } finally { cleanup(dir); }
});

test('replay refuses to start without a rubric or an invalid round', async () => {
  const dir = makeRoundDir();
  try {
    rmSync(join(dir, 'rubric', 't1.md'));
    await assert.rejects(replay(dir, { spawn: fakeSpawn(), log: quiet, costFilesList: [] }), /rubric missing for case t1/);
    writeJson(join(dir, 'round.json'), baseRound({ commit: 'zzz' }));
    await assert.rejects(replay(dir, { spawn: fakeSpawn(), log: quiet, costFilesList: [] }), /round.json invalid/);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------- grade
/** A claude stand-in: reads the blind prompt from stdin and grades by the words GOOD/BAD in each report. */
function gradingSpawn({ reply = null } = {}) {
  const calls = []; let active = 0; let maxActive = 0;
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let prompt = '';
    child.stdin = Object.assign(new EventEmitter(), { end(p) {
      prompt = p; calls.push({ cmd, args, opts, prompt });
      active++; maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        const out = {};
        for (const m of prompt.matchAll(/## Report (\w+)\n\n([\s\S]*?)(?=\n\n## Report |\n\n# Output)/g)) {
          const good = m[2].includes('GOOD');
          out[m[1]] = { items: [good ? 2 : 0, good ? 2 : 1], total: 99, max: 4, relay: good ? '예' : '아니오', key_miss: good ? '' : 'missed it' };
        }
        active--;
        child.stdout.emit('data', JSON.stringify({ type: 'result', result: reply ?? `Graded.\n${JSON.stringify(out)}` }));
        child.emit('close', 0);
      }, 5);
    } });
    return child;
  };
  spawn.calls = calls; spawn.maxActive = () => maxActive;
  return spawn;
}

function gradeRound(caseCount = 1) {
  const cases = Array.from({ length: caseCount }, (_, i) => ({ id: `g${i + 1}`, prompt: `cases/g${i + 1}.md`, rubric: `rubric/g${i + 1}.md` }));
  const dir = tmp('grade');
  for (const d of ['reports', 'cases', 'rubric']) mkdirSync(join(dir, d));
  writeJson(join(dir, 'round.json'), baseRound({ cases }));
  for (const c of cases) {
    writeFileSync(join(dir, c.prompt), 'Repo: {{REPO}}. Do the thing.\n');
    writeFileSync(join(dir, c.rubric), '1. Correct\n2. Complete\n');
    writeFileSync(join(dir, 'reports', `${c.id}-B.md`), 'A GOOD report\nwritten by sonnet, a line the grader never sees');
    writeFileSync(join(dir, 'reports', `${c.id}-D.md`), JSON.stringify({ message: 'A BAD report' }));
  }
  return dir;
}

test('gradeArgs: the exact grader command, no tools', () => {
  assert.deepEqual(gradeArgs(), ['-p', '--model', 'claude-opus-5-5', '--effort', 'high', '--output-format', 'json', '--tools', '']);
});

test('grade without --yes writes nothing and spawns nothing', async () => {
  const dir = gradeRound(2);
  try {
    const spawn = fakeSpawn(); const lines = [];
    const res = await grade(dir, { spawn, log: (l) => lines.push(l) });
    assert.deepEqual(res, { graded: 0, failed: [] });
    assert.equal(spawn.calls.length, 0);
    assert.deepEqual(readdirSync(dir).sort(), ['cases', 'reports', 'round.json', 'rubric']);
    assert.ok(lines.some((l) => /2 case\(s\) to grade, 4 report\(s\), at most 3 graders at once/.test(l)));
    assert.ok(lines.some((l) => /API-equivalent ~\$\d/.test(l) && /not charged/.test(l)));
    assert.ok(lines.some((l) => /--tools ""/.test(l)));
    assert.ok(lines.some((l) => /pass --yes/.test(l)));
  } finally { cleanup(dir); }
});

test('grade --yes blinds, runs graders with a clean env, unblinds and merges', async () => {
  const dir = gradeRound(5); const cwd = tmp('gradecwd');
  const prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'must-not-leak';
  try {
    const spawn = gradingSpawn();
    const res = await grade(dir, { yes: true, spawn, log: quiet, cwd });
    assert.deepEqual(res, { graded: 5, failed: [] });
    assert.equal(spawn.calls.length, 5);
    assert.ok(spawn.maxActive() <= 3 && spawn.maxActive() >= 2, `at most 3 graders at once, saw ${spawn.maxActive()}`);
    for (const c of spawn.calls) {
      assert.equal(c.cmd, 'claude');
      assert.deepEqual(c.args, gradeArgs());
      assert.equal(c.opts.shell, false);
      assert.equal(c.opts.cwd, cwd);
      assert.ok(!('ANTHROPIC_API_KEY' in c.opts.env) && !('ANTHROPIC_AUTH_TOKEN' in c.opts.env));
      assert.ok(!/sonnet|haiku|opus/i.test(c.prompt.split('# Output')[0]), 'model names stripped from the blind prompt');
      assert.ok(!/g\d-[BD]/.test(c.prompt), 'run keys never reach the grader');
    }
    const scores = JSON.parse(readFileSync(join(dir, 'scores_by_run.json'), 'utf8'));
    assert.deepEqual(Object.keys(scores).sort(), ['g1-B', 'g1-D', 'g2-B', 'g2-D', 'g3-B', 'g3-D', 'g4-B', 'g4-D', 'g5-B', 'g5-D']);
    assert.equal(scores['g3-B'].relay, '예');
    assert.equal(scores['g3-B'].total, 4, 'total recomputed from items');
    assert.equal(scores['g3-D'].relay, '아니오');
    assert.equal(scores['g3-D'].key_miss, 'missed it');
    const key = JSON.parse(readFileSync(join(dir, 'blind_key.json'), 'utf8'));
    assert.equal(Object.keys(key).length, 10);
    assert.equal(key[scores['g3-B'].label], 'g3-B');
    assert.ok(existsSync(join(dir, 'blind', 'g3.md')) && existsSync(join(dir, 'grading', 'g3.out.json')));
    assert.equal(readFileSync(join(dir, 'blind', 'g3.md'), 'utf8'), spawn.calls.find((c) => c.prompt.includes('Report')).prompt.length > 0 ? readFileSync(join(dir, 'blind', 'g3.md'), 'utf8') : '');
    // graded cases are skipped on the next run
    const again = await grade(dir, { yes: true, spawn: fakeSpawn(), log: quiet, cwd });
    assert.deepEqual(again, { graded: 0, failed: [] });
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
    cleanup(dir, cwd);
  }
});

test('grade reports an unparsable reply and merges nothing for that case', async () => {
  const dir = gradeRound(1); const cwd = tmp('gradecwd');
  try {
    const lines = [];
    const res = await grade(dir, { yes: true, spawn: gradingSpawn({ reply: 'I cannot comply.' }), log: (l) => lines.push(l), cwd });
    assert.equal(res.graded, 0);
    assert.equal(res.failed.length, 1);
    assert.match(res.failed[0].errors[0], /no JSON/);
    assert.ok(!existsSync(join(dir, 'scores_by_run.json')));
    assert.ok(lines.some((l) => /failed g1/.test(l)));
  } finally { cleanup(dir, cwd); }
});

// ---------------------------------------------------------------- publish
test('buildCase builds the exact public case from a round directory', () => {
  const dir = makeRoundDir();
  try {
    const c = buildCase(dir, publicEntry({ userPrompt: { ko: '요청', en: 'see /Users/someone/x' } }), baseRound());
    assert.deepEqual(Object.keys(c), ['id', 'round', 'kind', 'story', 'storyNote', 'title', 'userPrompt', 'task', 'truth', 'lesson', 'recommended', 'lanes', 'baseline', 'screenshot', 'runs']);
    assert.equal(c.round, 'rt');
    assert.deepEqual(c.lanes, ['sonnet-high', 'opus-direct']);
    assert.equal(c.screenshot, null);
    assert.equal(c.userPrompt.en, 'see ~/…', 'public text is scrubbed');
    assert.deepEqual(c.baseline, { run: 't1-D', usd: 2.1, tokens: 2620000, seconds: 6 });
    const [b, d] = c.runs;
    assert.deepEqual(Object.keys(b), ['round', 'run', 'condition', 'model', 'effort', 'prompt', 'verdict', 'score', 'max', 'keyMiss', 'usd', 'tokens', 'seconds', 'toolCalls', 'webSearches', 'excerpt', 'report', 'reportTruncated', 'trace', 'savingsPct']);
    assert.deepEqual(Object.keys(d).slice(-4), ['reportTruncated', 'trace', 'role', 'savingsPct']);
    assert.deepEqual([b.run, b.condition, b.model, b.effort, b.verdict, b.score, b.max, b.usd, b.tokens, b.seconds, b.toolCalls, b.webSearches],
      ['t1-B', 'sonnet-high', 'sonnet', 'high', 'ok', 4, 4, 1.05, 2620000, 6, 2, 3]);
    assert.equal(b.savingsPct, 50, '(1 - 1.05 / 2.1) * 100');
    assert.equal(d.savingsPct, 0);
    assert.equal(d.role, 'baseline');
    assert.equal(d.verdict, 'partial');
    assert.equal(d.keyMiss, 'Missed the second table.');
    assert.equal(b.report, 'The table is in <repo>/src/cost.js:12 and the next step is clear.');
    assert.equal(d.reportTruncated, true);
    assert.equal(d.report.length, 8002);
    assert.equal(d.excerpt, 'x'.repeat(700) + ' …');
    assert.equal(b.trace.length, 4);
    assert.equal(b.trace.at(-1).usd, b.usd, 'the trace ends at the run cost');
    assert.equal(d.trace.at(-1).usd, 2.1);
    assert.equal(findPrivacyHit(c), null);
  } finally { cleanup(dir); }
});

test('buildCase rejects bad input: cost mismatch, privacy hit, unpublished, missing baseline, unknown recommended', () => {
  const dir = makeRoundDir();
  try {
    assert.throws(() => buildCase(dir, publicEntry({ task: { ko: 'a', en: 'job claude-502 here' } }), baseRound()), /privacy check failed in case t1 at task\.en/);
    assert.throws(() => buildCase(dir, publicEntry({ publish: 'ask' }), baseRound()), /publish is "ask"/);
    assert.throws(() => buildCase(dir, publicEntry({ story: 'other' }), baseRound()), /story must be/);
    assert.throws(() => buildCase(dir, publicEntry({ title: { ko: 'x' } }), baseRound()), /title needs string ko and en/);
    assert.throws(() => buildCase(dir, publicEntry({ recommended: 'haiku-low' }), baseRound()), /recommended "haiku-low" is not one of/);
    assert.throws(() => buildCase(dir, publicEntry({ id: 'zz' }), baseRound()), /not in round rt/);
    assert.throws(() => buildCase(dir, publicEntry(), baseRound({ repeats: 2 })), /one run per condition/);
    const cost = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
    cost['t1-B'].usd = 1.06;
    writeJson(join(dir, 'cost.json'), cost);
    assert.throws(() => buildCase(dir, publicEntry(), baseRound()), /cost mismatch for rt\/t1-B/);
    cost['t1-B'].usd = 1.05;
    writeJson(join(dir, 'cost.json'), cost);
    const scores = JSON.parse(readFileSync(join(dir, 'scores_by_run.json'), 'utf8'));
    delete scores['t1-B'];
    writeJson(join(dir, 'scores_by_run.json'), scores);
    assert.throws(() => buildCase(dir, publicEntry(), baseRound()), /t1-B: cost.json entry but no score/);
    scores['t1-B'] = { items: [2, 2], total: 4, max: 4, relay: '예', key_miss: '' };
    delete scores['t1-D']; delete cost['t1-D'];
    writeJson(join(dir, 'scores_by_run.json'), scores); writeJson(join(dir, 'cost.json'), cost);
    assert.throws(() => buildCase(dir, publicEntry(), baseRound()), /no baseline run/);
  } finally { cleanup(dir); }
});

test('buildCase leaves out a lane that was not run, and applies a per-case agent override', () => {
  const round = baseRound({
    conditions: [{ key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', agent: 't2-explore', prompt: 'original' }, ...CONDS],
    cases: [{ id: 't1', prompt: 'cases/t1.md', rubric: 'rubric/t1.md', agents: { A: 't2-runner' } }],
  });
  const dir = makeRoundDir({ round });
  try {
    let c = buildCase(dir, publicEntry(), round);
    assert.deepEqual(c.lanes, ['haiku-low', 'sonnet-high', 'opus-direct'], 'the lane stays listed');
    assert.deepEqual(c.runs.map((r) => r.run), ['t1-B', 't1-D'], 'but has no run');
    // now run lane A too
    const entries = transcript('claude-haiku-5-5');
    writeJsonl(join(dir, 'transcripts', 't1-A.jsonl'), entries);
    const cc = costOfTranscript(entries);
    const cost = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
    cost['t1-A'] = { model: cc.model, totals: cc.totals, usd: cc.usd, ms: cc.ms, calls: cc.calls };
    writeJson(join(dir, 'cost.json'), cost);
    const scores = JSON.parse(readFileSync(join(dir, 'scores_by_run.json'), 'utf8'));
    scores['t1-A'] = { items: [0, 0], total: 0, max: 4, relay: '아니오', key_miss: 'nothing' };
    writeJson(join(dir, 'scores_by_run.json'), scores);
    c = buildCase(dir, publicEntry({ recommended: 'haiku-low' }), round);
    const a = c.runs[0];
    assert.equal(a.run, 't1-A');
    assert.equal(a.agent, 't2-runner', 'the override wins over the condition agent');
    assert.equal(a.verdict, 'fail');
    assert.equal(a.model, 'haiku');
    assert.equal(a.usd, 0.064, '(110000*0.1 + 200000*0.125 + 2300000*0.01 + 10000*0.5) / 1e6');
    assert.equal(publicCondition(round.conditions[0]).agent, 't2-explore', 'conditions.json keeps the condition agent');
  } finally { cleanup(dir); }
});

test('an effort round adds repeats to an existing case and nothing else', () => {
  const eff = baseRound({
    kind: 'effort', repeats: 2,
    conditions: [{ key: 'M', id: 'sonnet-medium', model: 'claude-sonnet-5-5', effort: 'medium', prompt: 'original' }, { key: 'H', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' }],
  });
  const dir = makeRoundDir({ round: eff });
  try {
    const entries = transcript('claude-sonnet-5-5'); const c = costOfTranscript(entries);
    const cost = {}; const scores = {}; const blocked = {};
    for (const [key, relay] of [['t1-M-1', '아니오'], ['t1-M-2', '부분'], ['t1-H-1', '예'], ['t1-H-2', '예']]) {
      cost[key] = { model: c.model, totals: c.totals, usd: c.usd, ms: c.ms, calls: c.calls };
      scores[key] = { items: [1, 1], total: 2, max: 4, relay, key_miss: key === 't1-M-1' ? 'missed' : '', ...(key === 't1-H-1' ? { in_window: 3 } : {}) };
      blocked[key] = { ws_ok: 2, ws_blocked: key === 't1-M-2' ? 1 : 0 };
      writeFileSync(join(dir, 'reports', `${key}.md`), `report ${key}`);
    }
    writeJson(join(dir, 'cost.json'), cost); writeJson(join(dir, 'scores_by_run.json'), scores); writeJson(join(dir, 'blocked.json'), blocked);
    assert.throws(() => buildCase(dir, publicEntry(), eff), /does not exist \(publish its conditions round first\)/);
    const existing = loadCorpus(EVALS).byFile['476'];
    const out = buildCase(dir, publicEntry({ id: 't1' }), eff, { ...existing, id: 't1' });
    assert.deepEqual(Object.keys(out), [...Object.keys(existing), ...(existing.repeats ? [] : ['repeats'])]);
    assert.deepEqual(out.runs, existing.runs, 'runs untouched');
    assert.deepEqual(out.repeats.map((r) => `${r.effort}#${r.rep}:${r.verdict}`), ['medium#1:fail', 'medium#2:partial', 'high#1:ok', 'high#2:ok']);
    assert.deepEqual(Object.keys(out.repeats[0]), ['effort', 'rep', 'total', 'max', 'relay', 'verdict', 'usd', 'seconds', 'webSearches', 'blockedPartial', 'keyMiss', 'excerpt']);
    assert.equal(out.repeats[1].blockedPartial, true);
    assert.equal(out.repeats[2].inWindow, 3);
    assert.equal(out.repeats[0].usd, 1.05);
    assert.equal(out.repeats[0].excerpt, 'report t1-M-1');
  } finally { cleanup(dir); }
});

test('the built case passes validateCorpus together with the real corpus; conflicts do not', () => {
  const dir = makeRoundDir();
  try {
    const round = baseRound();
    const c = buildCase(dir, publicEntry(), round);
    const corpus = loadCorpus(EVALS);
    const merged = mergeCorpus(corpus, round, [c]);
    validateCorpus(merged);
    assert.deepEqual(merged.index.cases, [...corpus.index.cases, 't1']);
    assert.deepEqual(merged.rounds.at(-1), { id: 'rt', date: '2026-11-07', kind: 'conditions' });
    assert.equal(merged.conditions.length, corpus.conditions.length, 'both conditions already exist');
    assert.equal(corpus.index.cases.includes('t1'), false, 'the input corpus is not mutated');
    // a new condition id is appended
    const round2 = baseRound({ conditions: [{ key: 'X', id: 'sonnet-xhigh', model: 'claude-sonnet-5-5', effort: 'xhigh', prompt: 'original' }, CONDS[1]] });
    const m2 = mergeCorpus(corpus, round2, [{ ...c, lanes: ['sonnet-xhigh', 'opus-direct'], recommended: 'opus-direct' }]);
    assert.deepEqual(m2.conditions.at(-1), { id: 'sonnet-xhigh', model: 'sonnet', effort: 'xhigh', prompt: 'original' });
    // same id, different setup
    const clash = baseRound({ conditions: [{ ...CONDS[0], effort: 'low' }, CONDS[1]] });
    assert.throws(() => mergeCorpus(corpus, clash, [c]), /condition "sonnet-high" already exists with a different setup/);
    assert.throws(() => mergeCorpus(corpus, baseRound({ id: 'r2', date: '2026-11-08' }), [{ ...c, round: 'r2' }]), /round "r2" already exists in rounds.json with a different date or kind/);
    assert.throws(() => mergeCorpus(corpus, round, [{ ...c, id: '476' }]), /already exists; pass --replace/);
    assert.doesNotThrow(() => mergeCorpus(corpus, round, [{ ...c, id: '476' }].map((x) => x), { replace: true }));
  } finally { cleanup(dir); }
});

test('publish: without --yes writes nothing; with --yes writes, appends, builds; refuses to overwrite', async () => {
  const dir = makeRoundDir(); const repo = tmp('repo');
  try {
    cpSync(EVALS, join(repo, 'evals'), { recursive: true });
    for (const f of ['README.md', 'README.ko.md']) cpSync(join(ROOT, f), join(repo, f));
    writeJson(join(dir, 'public.json'), { _note: 'x', cases: [publicEntry(), publicEntry({ id: 't9', publish: 'ask' })] });
    const before = readFileSync(join(repo, 'evals', 'index.json'), 'utf8');
    const lines = []; const log = (l) => lines.push(l);
    let built = 0;
    const build = (root) => { built++; writeAll({ repoRoot: root }); return 0; };

    const dry = await publish(dir, { repoRoot: repo, log, build });
    assert.deepEqual(dry, { written: [], built: false });
    assert.equal(built, 0);
    assert.equal(readFileSync(join(repo, 'evals', 'index.json'), 'utf8'), before);
    assert.ok(!existsSync(join(repo, 'evals', 'cases', 't1.json')));
    assert.ok(lines.some((l) => /skipping case t9/.test(l)));
    assert.ok(lines.some((l) => /pass --yes to write/.test(l)));
    assert.ok(lines.some((l) => /t1-B\s+sonnet-high\s+ok\s+4\/4/.test(l)));

    // the default build only knows the real repository
    await assert.rejects(publish(dir, { repoRoot: repo, yes: true, log }), /pass a `build` function/);
    assert.ok(!existsSync(join(repo, 'evals', 'cases', 't1.json')), 'the refusal happened before any write');

    const res = await publish(dir, { repoRoot: repo, yes: true, log, build });
    assert.equal(built, 1);
    assert.equal(res.built, true);
    const file = readFileSync(join(repo, 'evals', 'cases', 't1.json'), 'utf8');
    assert.ok(file.endsWith('}\n') && file.startsWith('{\n  "id": "t1",'), '2-space indent and a trailing newline');
    assert.deepEqual(JSON.parse(file), buildCase(dir, publicEntry(), baseRound()));
    const index = JSON.parse(readFileSync(join(repo, 'evals', 'index.json'), 'utf8'));
    assert.equal(index.cases.at(-1), 't1');
    assert.equal(JSON.parse(readFileSync(join(repo, 'evals', 'rounds.json'), 'utf8')).at(-1).id, 'rt');
    assert.deepEqual(staleFiles({ repoRoot: repo }), [], 'build ran against the new corpus');
    const data = readFileSync(join(repo, 'site', 'proof', 'data.json'), 'utf8');
    assert.ok(data.includes('"id": "t1"'));

    await assert.rejects(publish(dir, { repoRoot: repo, yes: true, log, build }), /already exists; pass --replace/);
    assert.equal(built, 1, 'a refused overwrite builds nothing');
    await publish(dir, { repoRoot: repo, yes: true, replace: true, log, build });
    assert.equal(built, 2);
    assert.equal(JSON.parse(readFileSync(join(repo, 'evals', 'index.json'), 'utf8')).cases.filter((id) => id === 't1').length, 1, 'replace does not duplicate the index entry');

    await assert.rejects(publish(dir, { repoRoot: repo, caseId: 't9', log, build }), /publish is "ask"/);
    await assert.rejects(publish(dir, { repoRoot: repo, caseId: 'nope', log, build }), /no case nope in public.json/);
  } finally { cleanup(dir, repo); }
});

test('publish aborts on a privacy hit before writing anything', async () => {
  const dir = makeRoundDir(); const repo = tmp('repo');
  try {
    cpSync(EVALS, join(repo, 'evals'), { recursive: true });
    writeJson(join(dir, 'public.json'), [publicEntry({ lesson: { ko: 'x', en: 'ran under claude-502 once' } })]);
    await assert.rejects(publish(dir, { repoRoot: repo, yes: true, log: quiet, build: () => 0 }), /privacy check failed in case t1 at lesson\.en/);
    assert.ok(!existsSync(join(repo, 'evals', 'cases', 't1.json')));
  } finally { cleanup(dir, repo); }
});

test('readReport accepts plain text and {"message"} JSON, scrubbed and trimmed', () => {
  const dir = tmp('report');
  try {
    writeFileSync(join(dir, 'a.md'), '  see /Users/someone/projects/sprag/a.js  \n');
    writeFileSync(join(dir, 'b.md'), JSON.stringify({ message: 'from json ' + OWNER }));
    writeFileSync(join(dir, 'c.md'), '{not json at all');
    assert.equal(readReport(join(dir, 'a.md')), 'see <repo>/a.js');
    assert.equal(readReport(join(dir, 'b.md')), 'from json');
    assert.equal(readReport(join(dir, 'c.md')), '{not json at all');
  } finally { cleanup(dir); }
});

test('weekly digest: new candidates only, corrected turns listed once, replay sessions dropped', async () => {
  const { weeklyDigest, formatDigest } = await import('../scripts/evals/weekly.mjs');
  const c = (id, extra) => ({ id, session: 's1', project: '-p-proj', userPrompt: 'find the loader', subagentType: 't2-explore', effort: null, nextUserPrompt: 'thanks', ...extra });
  const cands = [
    c('a1', { nextUserPrompt: '아니야 다른 파일이야' }),
    c('a2', { nextUserPrompt: '아니야 다른 파일이야' }),
    // The one contrastive '아니라' is the input under test: it must not count as a correction.
    c('b1', { session: 's2', userPrompt: 'B로 해줘', nextUserPrompt: 'A가 아니라 B로 바꿔' }),
    c('old'),
    c('r1', { project: '-x-handoff-evals-work-rounds-r3-wt', nextUserPrompt: 'wrong' }),
  ];
  const d = weeklyDigest(cands, new Set(['old']));
  assert.deepEqual(d.fresh.map((x) => x.id), ['a1', 'a2', 'b1']);
  assert.equal(d.suspects.length, 1, '"아니라" alone is not a correction, and one turn is listed once');
  assert.equal(d.suspects[0].count, 2);
  const text = formatDigest(d, { days: 7 });
  assert.match(text, /새 위임 3건/);
  assert.match(text, /a1 외 1건/);
  assert.match(formatDigest(weeklyDigest([], new Set()), { days: 7 }), /새 위임이 없습니다/);
});

test('weekly main: --dry-run posts nothing; a post moves the state forward', async () => {
  const { main } = await import('../scripts/evals/weekly.mjs');
  const work = tmp('weekly');
  const root = tmp('weekly-root');
  const prev = process.env.SPRAG_EVALS_WORK;
  process.env.SPRAG_EVALS_WORK = work;
  try {
    const posts = [];
    const log = console.log; console.log = () => {};
    try {
      await main(['--dry-run'], { post: (t) => posts.push(t), root });
      assert.equal(posts.length, 0);
      await main([], { post: (t) => posts.push(t), root });
    } finally { console.log = log; }
    assert.equal(posts.length, 1);
    const state = JSON.parse(readFileSync(join(work, 'weekly-state.json'), 'utf8'));
    assert.ok(state.lastRun);
  } finally {
    if (prev === undefined) delete process.env.SPRAG_EVALS_WORK; else process.env.SPRAG_EVALS_WORK = prev;
    cleanup(work, root);
  }
});
