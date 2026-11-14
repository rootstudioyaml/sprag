#!/usr/bin/env node
/**
 * Build the "main model writes the specification, a lower model implements it" rounds from a graded implementation
 * round (implround.mjs). No model is called here.
 *
 *   node scripts/evals/specround.mjs prep  <impl-round-dir> --id <round-A-id>
 *   node scripts/evals/specround.mjs apply <round-A-dir> <impl-round-dir> --id <round-B-id>
 *
 * The source round compared a sub-agent (S) with the main model doing the task itself (B), both from the same hand-off.
 * The product asks for more: the main model writes a detailed specification first (src/implementation-delegation.js),
 * then the worker implements from it. `prep` builds round A: condition P, Opus rewrites each original hand-off under that
 * standard (read-only; its cost is the cost of the specification step). After replaying A, `apply` builds round B:
 * condition N, Sonnet implements from the new specification with the current t1-worker body (written to agents.json and
 * passed with --agents) and the cap line the real guard would append. S and B are copied from the source round with their
 * copies rebuilt from the saved diffs, so the grader compares N, S and B blind. Only `git worktree add` and `git apply` run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { workDir, readJson, copyRel, copyRuns, validateRound, isMain } from './lib.mjs';
import { writeWorktreeFor, worktreeFor } from './replay.mjs';
import { implementationDelegationRule } from '../../src/implementation-delegation.js';
import { boundsText, IMPLEMENTATION_CAP_LINE, isImplementationHandOff, statesOwnBudget } from '../../src/delegation-guard.js';

export const SPEC_PREP_RULE = 'impl-spec-prep-v1';
export const SPEC_RULE = 'impl-spec-v1';
export const SPEC_CONDITION = { key: 'P', id: 'opus-spec', model: 'claude-opus-5-5', effort: 'high', prompt: 'improved', role: 'baseline' };
export const NEXT_CONDITION = { key: 'N', id: 'sonnet-spec', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker-next', agentsFile: 'agents.json', prompt: 'improved' };
const MARKER = '<!-- sprag:delegation -->';
const OWN_CAP_LINE = 'Cap for this delegation: the budget stated in your prompt above. It replaces the default cap.';
const NUMERIC_CAP_LINE = 'Cap for this delegation: 20 tool calls, 8,000 output tokens.';

/** Pure: what the main model is told when it rewrites a draft as a specification. {{REPO}} is filled in by replay.mjs. */
export function specPrompt({ draft, standard }) {
  return `You are the main model of a coding session. You settled the design in the draft below and are about to hand the implementation to a sub-agent: a mid-tier model that sees nothing but the text you give it. Before you hand it off, rewrite the draft as a specification under the standard that follows. The repository copy is at {{REPO}}, at the commit the work starts from.

# Standard

${standard.trim()}

# What to do

1. Keep the design and the scope of the draft. Do not add features and do not drop requirements.
2. Read the code under {{REPO}} that the change touches. Find item 4 (other callers of what changes, copies, documents) and item 5 (lists a test enforces, registration steps, style rules) yourself, and write them into the specification with file paths.
3. State no output-token cap. Keep a tool-call budget only if the draft has one.
4. Do not implement anything and do not change any file.
5. Refer to the repository only by the path {{REPO}}.

Answer with ONLY the specification text. It is passed to the sub-agent verbatim, so write no preface and no closing note.

# The draft

${draft.trim()}
`;
}

/** Pure: the original hand-off without the appendix sprag added to it. */
export const stripAppendix = (text) => { const i = text.indexOf(MARKER); return i < 0 ? text : text.slice(0, i); };

/**
 * Pure: the hand-off text the worker gets. `spec` has round A's worktree path already replaced; the appendix is the
 * original's with its bounds section swapped for today's bounds text and the cap line the guard picks for this spec.
 */
export function specHandOff({ spec, originalPrompt, bounds }) {
  spec = spec.trim();
  const capLine = isImplementationHandOff({ subagent_type: 't1-worker', prompt: spec }) ? 'implementation' : statesOwnBudget(spec) ? 'own' : 'numeric';
  const line = { implementation: IMPLEMENTATION_CAP_LINE, own: OWN_CAP_LINE, numeric: NUMERIC_CAP_LINE }[capLine];
  const heading = '## Bounds and output shape';
  const section = `${heading}\n\n${bounds}\n\n${line}`;
  const at = originalPrompt.indexOf(MARKER);
  let appendix;
  if (at < 0) appendix = `${MARKER}\n\n${section}`;
  else {
    const old = originalPrompt.slice(at).trimEnd();
    const m = /^## Bounds and output shape[^\n]*(?:\n|$)[\s\S]*?(?=^## |(?![\s\S]))/m.exec(old);
    if (!m) appendix = `${old}\n\n${section}`;
    else {
      const gap = /\s*$/.exec(m[0])[0]; // keep the blank lines that separated the old section from the next one
      appendix = old.slice(0, m.index) + section + gap + old.slice(m.index + m[0].length);
    }
  }
  return { text: `${spec}\n\n${appendix.trimEnd()}\n`, capLine };
}

/** The cases both builders work on, exactly as reviewround picks them. */
function pickCases(src, sourceDir, lane, base, srcRuns) {
  return src.cases.filter((c) => c.write === true && !c.meta?.excluded && srcRuns[`${c.id}-${lane.key}`] && srcRuns[`${c.id}-${base.key}`]
    && existsSync(join(sourceDir, 'diffs', `${c.id}-${lane.key}.patch`)) && existsSync(join(sourceDir, 'diffs', `${c.id}-${base.key}.patch`)));
}
function conditionsOf(src) {
  const base = src.conditions.find((c) => c.role === 'baseline'); const lane = src.conditions.find((c) => c.role !== 'baseline');
  if (!base || !lane) throw new Error('the source round needs a baseline and one other condition');
  return { base, lane };
}
function outDirFor(root, id) {
  if (!/^[\w-]+$/.test(id || '')) throw new Error('--id must be a slug');
  const outDir = join(root, id);
  if (existsSync(outDir)) throw new Error(`round already exists: ${outDir}`);
  return outDir;
}
const writeRound = (outDir, round, runs, cost) => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 1) + '\n');
  writeFileSync(join(outDir, 'runs.json'), JSON.stringify(runs, null, 1)); writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 1));
};

/** Round A: the main model rewrites each original hand-off as a specification (read-only). */
export function specPrep(sourceDir, { id, root = join(workDir(), 'rounds'), log = console.log, date = new Date().toISOString().slice(0, 10) } = {}) {
  sourceDir = resolve(sourceDir);
  const src = readJson(join(sourceDir, 'round.json'));
  const outDir = outDirFor(root, id);
  const { base, lane } = conditionsOf(src);
  const picked = pickCases(src, sourceDir, lane, base, readJson(join(sourceDir, 'runs.json'), {}));
  if (!picked.length) throw new Error('no case with both runs and both saved diffs');
  const cases = picked.map(({ seedPatch, ...c }) => ({
    ...c, write: false, improvedPrompt: `specprompt/${c.id}.md`, conditions: [SPEC_CONDITION.key], meta: { ...(c.meta || {}), sourceRound: src.id },
  }));
  const round = { ...src, id, date, rule: SPEC_PREP_RULE, grading: 'verify', conditions: [{ ...SPEC_CONDITION }], cases };
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  const standard = implementationDelegationRule('claude', 'en');
  for (const c of cases) {
    copyRel(sourceDir, outDir, c.prompt); copyRel(sourceDir, outDir, c.rubric);
    const draft = stripAppendix(readFileSync(join(sourceDir, c.prompt), 'utf8'));
    mkdirSync(join(outDir, 'specprompt'), { recursive: true });
    writeFileSync(join(outDir, c.improvedPrompt), specPrompt({ draft, standard }));
  }
  writeRound(outDir, round, {}, {});
  log(`spec prep round ${id} from ${src.id}: ${cases.length} case(s), ${cases.length} run(s) to replay -> ${outDir}`);
  return { round, dir: outDir };
}

/** Round B: the worker implements from round A's specifications; S and B are copied from the source for blind grading. */
export function specApply(specDir, sourceDir, { id, root = join(workDir(), 'rounds'), git = (args) => execFileSync('git', args, { encoding: 'utf8' }), log = console.log, date = new Date().toISOString().slice(0, 10) } = {}) {
  specDir = resolve(specDir); sourceDir = resolve(sourceDir);
  const src = readJson(join(sourceDir, 'round.json')); const specRound = readJson(join(specDir, 'round.json'));
  const outDir = outDirFor(root, id);
  const { base, lane } = conditionsOf(src);
  if ([lane.key, base.key].includes(NEXT_CONDITION.key)) throw new Error(`the source round already uses condition key ${NEXT_CONDITION.key}`);
  const srcRuns = readJson(join(sourceDir, 'runs.json'), {}); const srcCost = readJson(join(sourceDir, 'cost.json'), {});
  const specRuns = readJson(join(specDir, 'runs.json'), {});
  const bounds = boundsText();
  if (!bounds) throw new Error('presets/delegation/bounds.md is missing or empty');
  const reportOf = (c) => { const f = join(specDir, 'reports', `${c.id}-${SPEC_CONDITION.key}.md`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  const round = { ...src, id, date, rule: SPEC_RULE, baselineFrom: src.id, specFrom: specRound.id, conditions: [{ ...NEXT_CONDITION }, { ...lane }, { ...base }], cases: [] };
  const runs = {}, cost = {}, counts = { implementation: 0, own: 0, numeric: 0 }, texts = {};
  // Every specification is checked before anything is written, so a bad one leaves no half-built round behind.
  for (const { seedPatch, ...c } of pickCases(src, sourceDir, lane, base, srcRuns)) {
    if (!reportOf(c).trim() || !specRuns[`${c.id}-${SPEC_CONDITION.key}`]) { log(`skipped ${c.id}: no specification`); continue; }
    const wtA = worktreeFor(specDir, specRound, specRound.cases.find((x) => x.id === c.id) || c).wt;
    const spec = reportOf(c).replaceAll(wtA, '{{REPO}}');
    if (spec.includes(c.repo || src.repo)) throw new Error(`specification for ${c.id} still names the repository root`);
    const { text, capLine } = specHandOff({ spec, originalPrompt: readFileSync(join(sourceDir, c.prompt), 'utf8'), bounds });
    counts[capLine]++; texts[c.id] = text;
    round.cases.push({ ...c, improvedPrompt: `spec/${c.id}.md`, conditions: [NEXT_CONDITION.key, lane.key, base.key], meta: { ...(c.meta || {}), sourceRound: src.id, specRound: specRound.id, capLine } });
  }
  if (!round.cases.length) throw new Error('no case with a specification');
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  for (const c of round.cases) {
    copyRel(sourceDir, outDir, c.prompt); copyRel(sourceDir, outDir, c.rubric);
    for (const k of [lane.key, base.key]) {
      copyRel(sourceDir, outDir, `diffs/${c.id}-${k}.patch`);
      copyRuns({ sourceDir, outDir, caseId: c.id, srcKey: k, newKey: k, srcRuns, srcCost, runs, cost });
    }
    mkdirSync(join(outDir, 'spec'), { recursive: true });
    writeFileSync(join(outDir, c.improvedPrompt), texts[c.id]);
  }
  // The grader reads the copies of S and B under this round's id, so they are rebuilt here from the saved diffs.
  for (const c of round.cases) for (const k of [lane.key, base.key]) {
    const w = writeWorktreeFor(round, c, `${c.id}-${k}`);
    if (existsSync(w.wt)) continue;
    mkdirSync(dirname(w.wt), { recursive: true });
    git(['-C', w.repo, 'worktree', 'add', '--detach', w.wt, w.commit]);
    const patch = join(outDir, 'diffs', `${c.id}-${k}.patch`);
    if (readFileSync(patch, 'utf8').trim()) git(['-C', w.wt, 'apply', '--index', patch]);
  }
  const worker = JSON.parse(readFileSync(new URL('../../presets/agents.json', import.meta.url), 'utf8')).agents.find((a) => a.name === 't1-worker');
  if (!worker) throw new Error('presets/agents.json has no t1-worker');
  writeRound(outDir, round, runs, cost);
  writeFileSync(join(outDir, NEXT_CONDITION.agentsFile), JSON.stringify({ [NEXT_CONDITION.agent]: { description: worker.description.en, prompt: worker.body.en, tools: worker.tools, model: 'sonnet' } }, null, 1) + '\n');
  log(`spec apply round ${id} from ${src.id} (specifications ${specRound.id}): ${round.cases.length} case(s), ${round.cases.length} run(s) to replay, cap lines implementation ${counts.implementation} / own ${counts.own} / numeric ${counts.numeric} -> ${outDir}`);
  return { round, dir: outDir };
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--id');
  const usage = () => { console.error('usage: specround.mjs prep <impl-round-dir> --id <round-A-id>\n       specround.mjs apply <round-A-dir> <impl-round-dir> --id <round-B-id>'); return 2; };
  const id = opt('--id');
  if (!id || id.startsWith('--')) return usage();
  const sub = argv[0];
  if (sub === 'prep' && pos.length === 1) { try { specPrep(pos[0], { id }); return 0; } catch (e) { console.error(e.message); return 1; } }
  if (sub === 'apply' && pos.length === 2) { try { specApply(pos[0], pos[1], { id }); return 0; } catch (e) { console.error(e.message); return 1; } }
  return usage();
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
