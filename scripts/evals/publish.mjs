// Turn a graded round into tracked public cases under evals/ and rebuild every generated surface.
// Usage: node scripts/evals/publish.mjs <round-dir> [--case <id>] [--replace] [--yes]
//
// Reads <round-dir>/public.json (the public wording of each case, bilingual) plus the round's round.json,
// cost.json, blocked.json, scores_by_run.json, reports/ and transcripts/. Without --yes it prints a summary and
// writes nothing. With --yes it validates the whole corpus first, then writes evals/cases/<id>.json,
// index.json, rounds.json and conditions.json, and runs scripts/evals/build.mjs.
//
// A "conditions" round creates a case. An "effort" round adds `repeats` to a case that already exists (the case
// keeps its runs from the conditions round), so publish the conditions round first.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPO_ROOT, privacyRe, loadCorpus, validateCorpus } from './build.mjs';
import {
  validateRound, readJson, readJsonl, readReport, excerptOf, capped, scrub, scrubDeep, findPrivacyHit, buildTrace,
  exactUsd, tokensOf, ratesFor, pyRound, shortModel, agentFor, VERDICT, isMain,
} from './lib.mjs';

const STORIES = ['quality-up', 'cost-down', 'context'];
const BILINGUAL = ['storyNote', 'title', 'userPrompt', 'task', 'truth', 'lesson'];
const REPEAT_EXCERPT_CHARS = 1200;
const BUILD_PATH = fileURLToPath(new URL('./build.mjs', import.meta.url));

/** The public form of a round's condition: short model name, fixed key order. */
export function publicCondition(cond) {
  return { id: cond.id, model: shortModel(cond.model), effort: cond.effort, prompt: cond.prompt,
    ...(cond.role ? { role: cond.role } : {}), ...(cond.agent ? { agent: cond.agent } : {}) };
}

/** Port of build_public.py build_run. `agent` is the lane's agent after any per-case override. */
export function buildRun({ roundId, date, runKey, cond, agent, score, cost, webSearches, reportPath, transcriptPath }) {
  const totals = cost.totals;
  const rates = ratesFor(cost.model, cost.at || date);
  const usd = exactUsd(totals, rates);
  if (Math.abs(pyRound(usd, 2) - cost.usd) > 1e-9) throw new Error(`cost mismatch for ${roundId}/${runKey}: exact ${usd.toFixed(4)} vs recorded ${cost.usd}`);
  const full = existsSync(reportPath) ? readReport(reportPath) : '';
  const [report, truncated] = capped(full);
  const run = {
    round: roundId, run: runKey, condition: cond.id, model: shortModel(cond.model), effort: cond.effort,
    prompt: cond.prompt || 'original', verdict: VERDICT[score.relay], score: score.total, max: score.max,
    keyMiss: scrub(score.key_miss || ''), usd: pyRound(usd, 4), tokens: tokensOf(totals), seconds: pyRound(cost.ms / 1000),
    toolCalls: cost.calls, webSearches, excerpt: excerptOf(full), report, reportTruncated: truncated,
  };
  if (!run.verdict) throw new Error(`${runKey}: relay "${score.relay}" is not 예/부분/아니오`);
  if (transcriptPath && existsSync(transcriptPath)) run.trace = buildTrace(readJsonl(transcriptPath), cost.model, run.usd);
  if (cond.role) run.role = cond.role;
  if (agent) run.agent = agent;
  return { run, full };
}

function files(roundDir) {
  return {
    scores: readJson(join(roundDir, 'scores_by_run.json'), {}),
    cost: readJson(join(roundDir, 'cost.json'), {}),
    blocked: readJson(join(roundDir, 'blocked.json'), {}),
  };
}

function checkEntry(entry, roundManifest) {
  const fail = (m) => { throw new Error(`case ${entry?.id}: ${m}`); };
  if (!entry || !entry.id) throw new Error('public.json entry needs an id');
  if (entry.publish !== true) fail(`publish is ${JSON.stringify(entry.publish)}, not true`);
  if (!roundManifest.cases.some((c) => c.id === entry.id)) fail(`not in round ${roundManifest.id}`);
  for (const f of BILINGUAL) if (typeof entry[f]?.ko !== 'string' || typeof entry[f]?.en !== 'string') fail(`${f} needs string ko and en`);
  if (!STORIES.includes(entry.story)) fail(`story must be one of ${STORIES.join('|')}`);
  if (!entry.kind || !entry.recommended) fail('needs kind and recommended');
}

/**
 * Pure: the public case object for one entry of public.json (no writes).
 * For an "effort" round pass `existing`, the published case that receives the `repeats`.
 */
export function buildCase(roundDir, entry, roundManifest, existing = null) {
  const errs = validateRound(roundManifest);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  checkEntry(entry, roundManifest);
  const caseCfg = roundManifest.cases.find((c) => c.id === entry.id);
  const { scores, cost, blocked } = files(roundDir);
  const repeats = roundManifest.repeats || 1;
  const reportOf = (k) => join(roundDir, 'reports', `${k}.md`);
  const transcriptOf = (k) => join(roundDir, 'transcripts', `${k}.jsonl`);
  const common = (key, cond) => ({
    roundId: roundManifest.id, date: roundManifest.date, runKey: key, cond, agent: agentFor(caseCfg, cond),
    score: scores[key], cost: cost[key], webSearches: blocked[key]?.ws_ok ?? 0, reportPath: reportOf(key),
  });
  const present = (key) => {
    const hasScore = key in scores, hasCost = key in cost;
    if (hasScore !== hasCost) throw new Error(`${key}: ${hasScore ? 'scored but no cost.json entry' : 'cost.json entry but no score (grade it first)'}`);
    return hasScore;
  };

  let result;
  if (roundManifest.kind === 'effort') {
    if (!existing) throw new Error(`case ${entry.id}: an effort round adds repeats to a published case, but evals/cases/${entry.id}.json does not exist (publish its conditions round first)`);
    const reps = [];
    for (const cond of roundManifest.conditions) for (let rep = 1; rep <= repeats; rep++) {
      const key = `${entry.id}-${cond.key}-${rep}`;
      if (!present(key)) continue;
      const { run, full } = buildRun({ ...common(key, cond), transcriptPath: null });
      const sc = scores[key]; const b = blocked[key] || {};
      reps.push({
        effort: cond.effort, rep, total: sc.total, max: sc.max, relay: sc.relay, verdict: run.verdict, usd: run.usd,
        seconds: run.seconds, webSearches: b.ws_ok ?? 0, blockedPartial: (b.ws_blocked ?? 0) > 0, keyMiss: run.keyMiss,
        excerpt: excerptOf(full, REPEAT_EXCERPT_CHARS), ...('in_window' in sc ? { inWindow: sc.in_window } : {}),
      });
    }
    if (!reps.length) throw new Error(`case ${entry.id}: no graded runs in round ${roundManifest.id}`);
    result = { ...structuredClone(existing), repeats: reps };
  } else {
    if (repeats !== 1) throw new Error('a "conditions" round has one run per condition (repeats 1); use kind "effort" for repeats');
    const runs = [];
    for (const cond of roundManifest.conditions) {
      const key = `${entry.id}-${cond.key}`;
      if (!present(key)) continue; // a lane that was not run (case 476 has no lane A) stays out of runs
      runs.push(buildRun({ ...common(key, cond), transcriptPath: transcriptOf(key) }).run);
    }
    const base = runs.find((r) => r.role === 'baseline');
    if (!base) throw new Error(`case ${entry.id} has no baseline run`);
    for (const r of runs) r.savingsPct = pyRound((1 - r.usd / base.usd) * 100, 1);
    const lanes = roundManifest.conditions.map((c) => c.id);
    if (!lanes.includes(entry.recommended)) throw new Error(`case ${entry.id}: recommended "${entry.recommended}" is not one of ${lanes.join(', ')}`);
    result = {
      id: entry.id, round: roundManifest.id, kind: entry.kind, story: entry.story, storyNote: entry.storyNote,
      title: entry.title, userPrompt: entry.userPrompt, task: entry.task, truth: entry.truth, lesson: entry.lesson,
      recommended: entry.recommended, lanes,
      baseline: { run: base.run, usd: base.usd, tokens: base.tokens, seconds: base.seconds },
      screenshot: entry.screenshot ?? null, runs,
    };
  }
  result = scrubDeep(result);
  const hit = findPrivacyHit(result, '', privacyRe());
  if (hit) throw new Error(`privacy check failed in case ${entry.id} at ${hit.path || '(root)'}: matches ${JSON.stringify(hit.match)}`);
  return result;
}

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const sameCondition = (a, b) => ['model', 'effort', 'prompt', 'role', 'agent'].every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Pure: the corpus after adding `cases` from this round. Throws on conflicts or an invalid result. */
export function mergeCorpus(corpus, roundManifest, cases, { replace = false } = {}) {
  const index = { ...corpus.index, cases: [...corpus.index.cases] };
  const byFile = { ...corpus.byFile };
  for (const c of cases) {
    const kind = roundManifest.kind;
    if (byFile[c.id] && kind === 'conditions' && !replace) throw new Error(`evals/cases/${c.id}.json already exists; pass --replace to overwrite it`);
    if (kind === 'effort' && byFile[c.id]?.repeats && !replace) throw new Error(`case ${c.id} already has repeats; pass --replace to overwrite them`);
    byFile[c.id] = c;
    if (!index.cases.includes(c.id)) index.cases.push(c.id);
  }
  const conditions = [...corpus.conditions];
  // Repeats vary effort only and reference no condition id, so an effort round adds none.
  for (const cond of roundManifest.kind === 'effort' ? [] : roundManifest.conditions.map(publicCondition)) {
    const have = conditions.find((x) => x.id === cond.id);
    if (!have) conditions.push(cond);
    else if (!sameCondition(have, cond)) throw new Error(`condition "${cond.id}" already exists with a different setup in conditions.json; give this round's condition a new id`);
  }
  const rounds = [...corpus.rounds];
  const have = rounds.find((r) => r.id === roundManifest.id);
  const entry = { id: roundManifest.id, date: roundManifest.date, kind: roundManifest.kind };
  if (!have) rounds.push(entry);
  else if (have.date !== entry.date || have.kind !== entry.kind) throw new Error(`round "${entry.id}" already exists in rounds.json with a different date or kind`);
  const merged = { index, conditions, rounds, byFile, files: Object.keys(byFile).sort() };
  validateCorpus(merged);
  return merged;
}

function runBuild(spawn = nodeSpawn) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [BUILD_PATH], { stdio: 'inherit', shell: false });
    child.on('error', (e) => { console.error(e.message); res(1); });
    child.on('close', (code) => res(code ?? 1));
  });
}

function summarize(c, log) {
  log(`  case ${c.id} (${c.kind}, ${c.story}): ${c.title.en}`);
  if (c.repeats) {
    log(`    ${c.repeats.length} repeats: ${c.repeats.map((r) => `${r.effort}#${r.rep} ${r.verdict} $${r.usd}`).join(', ')}`);
    return;
  }
  log(`    recommended ${c.recommended}; baseline ${c.baseline.run} $${c.baseline.usd}`);
  for (const r of c.runs) log(`    ${r.run.padEnd(10)} ${r.condition.padEnd(22)} ${r.verdict.padEnd(7)} ${r.score}/${r.max}  $${String(r.usd).padEnd(7)} ${String(r.savingsPct).padStart(6)}%  ${r.toolCalls} calls  trace ${r.trace ? `${r.trace.length} events` : 'none'}`);
}

export async function publish(roundDir, { caseId = null, replace = false, yes = false, repoRoot = DEFAULT_REPO_ROOT, build = null, log = console.log } = {}) {
  roundDir = resolve(roundDir);
  const roundManifest = readJson(join(roundDir, 'round.json'));
  const errs = validateRound(roundManifest);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  const pub = readJson(join(roundDir, 'public.json'));
  if (!pub) throw new Error(`public.json missing in ${roundDir}`);
  const all = Array.isArray(pub) ? pub : pub.cases;
  if (!Array.isArray(all)) throw new Error('public.json must be an array or { cases: [...] }');
  let entries = caseId ? all.filter((e) => String(e.id) === caseId) : all;
  if (caseId && !entries.length) throw new Error(`no case ${caseId} in public.json`);
  if (!caseId) {
    const held = entries.filter((e) => e.publish !== true);
    for (const e of held) log(`skipping case ${e.id}: publish is ${JSON.stringify(e.publish)}`);
    entries = entries.filter((e) => e.publish === true);
  }
  if (!entries.length) throw new Error('nothing to publish');

  const evalsDir = join(repoRoot, 'evals');
  const corpus = loadCorpus(evalsDir);
  const cases = entries.map((e) => buildCase(roundDir, e, roundManifest, corpus.byFile[String(e.id)] ?? null));
  const merged = mergeCorpus(corpus, roundManifest, cases, { replace });

  log(`round ${roundManifest.id} (${roundManifest.kind}, ${roundManifest.date}): ${cases.length} case(s) ready, corpus validates (${merged.index.cases.length} cases after)`);
  for (const c of cases) summarize(c, log);
  const added = merged.conditions.length - corpus.conditions.length;
  if (added) log(`  conditions.json gains ${added}: ${merged.conditions.slice(corpus.conditions.length).map((c) => c.id).join(', ')}`);
  if (merged.rounds.length > corpus.rounds.length) log(`  rounds.json gains ${roundManifest.id}`);
  if (!yes) { log('stopped before writing: pass --yes to write evals/ and rebuild'); return { written: [], built: false }; }

  // The real build.mjs only knows the real repo; check before writing so a refusal leaves evals/ untouched.
  if (!build && resolve(repoRoot) !== resolve(DEFAULT_REPO_ROOT)) throw new Error('pass a `build` function when repoRoot is not this repository');
  const written = [];
  const put = (file, value) => { writeFileSync(file, json(value)); written.push(file); };
  for (const c of cases) put(join(evalsDir, 'cases', `${c.id}.json`), c);
  put(join(evalsDir, 'index.json'), merged.index);
  put(join(evalsDir, 'conditions.json'), merged.conditions);
  put(join(evalsDir, 'rounds.json'), merged.rounds);
  log(`wrote ${written.length} files under ${evalsDir}`);
  const code = await (build ? build(repoRoot) : runBuild());
  if (code !== 0) throw new Error(`build.mjs exited ${code}; evals/ is written but the generated files are stale`);
  return { written, built: true };
}

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: publish.mjs <round-dir> [--case <id>] [--replace] [--yes]'); return 2; }
  try {
    await publish(argv[0], { caseId: opt('--case'), replace: argv.includes('--replace'), yes: argv.includes('--yes') });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
