#!/usr/bin/env node
/**
 * Build every published surface of the replayed-delegation corpus from evals/.
 *
 *   evals/index.json, conditions.json, rounds.json, cases/<id>.json   source of truth
 *   evals/live.json (optional)      real-usage aggregates from scripts/evals/live.mjs
 *   evals/bulk.json (optional)      graded bulk-round aggregates from scripts/evals/bulk.mjs
 *   evals/bulk-notes.json (optional) method and partial-mark notes shown with the bulk block
 *     -> site/proof/data.json        the /proof/ page
 *     -> evals/summary.json          compact summary shipped in the npm package
 *     -> evals/SUMMARY.md            table for GitHub readers
 *     -> README.md, README.ko.md     evidence block between the sprag:evidence markers
 *
 *   node scripts/evals/build.mjs          write the files
 *   node scripts/evals/build.mjs --check  exit 1 listing stale files, write nothing
 *
 * Output is deterministic: no timestamps, fixed key order, fixed row order.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = join(HERE, '..', '..');

export const PROOF_URL = 'https://sprag.io/proof/';
export const EVIDENCE_START = '<!-- sprag:evidence:start -->';
export const EVIDENCE_END = '<!-- sprag:evidence:end -->';

const STORIES = ['quality-up', 'cost-down', 'context'];
const VERDICTS = ['ok', 'partial', 'fail'];
const REQUIRED_CASE_FIELDS = [
  'id', 'round', 'kind', 'story', 'title', 'userPrompt', 'task', 'truth', 'lesson',
  'recommended', 'lanes', 'baseline', 'runs',
];
const BILINGUAL_FIELDS = ['title', 'userPrompt', 'task', 'truth', 'lesson'];

// What must never reach the public corpus: local home paths, scratch dirs,
// session dirs, the private server repo and email addresses.
const GENERIC_PRIVACY = String.raw`\/Users\/|\/private\/tmp|claude-\d{3}|sprag-team|[\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]`;

/**
 * Personal identifiers to block, read from the machine at run time and never
 * written into this repository, not even as a pattern: one per line in
 * `<evals work dir>/private-names.txt` (git-ignored, beside the raw rounds) and
 * comma-separated in SPRAG_EVALS_PRIVATE_NAMES. Without either, only the
 * generic patterns apply, which is the case in CI.
 */
export function privateNames(env = process.env) {
  const names = new Set();
  for (const n of String(env.SPRAG_EVALS_PRIVATE_NAMES || '').split(',')) if (n.trim()) names.add(n.trim());
  const work = env.SPRAG_EVALS_WORK || join(DEFAULT_REPO_ROOT, 'handoff', 'evals-work');
  const file = join(work, 'private-names.txt');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const n = line.trim();
      if (n && !n.startsWith('#')) names.add(n);
    }
  }
  return [...names];
}

// A name written with separators also matches the other separators (a.b.c,
// a-b-c, a_b_c), but never the joined form, which is the public GitHub owner.
const namePattern = (name) => name.split(/[.\-_ ]+/).filter(Boolean)
  .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[.\\-_ ]');

/** Matches a private name, or null when none is configured. */
export function nameRegex(names = privateNames(), flags = 'gi') {
  return names.length ? new RegExp(names.map(namePattern).join('|'), flags) : null;
}

/** The full privacy check: private names plus the generic patterns. */
export function privacyRe(names = privateNames()) {
  return new RegExp([...names.map(namePattern), GENERIC_PRIVACY].join('|'), 'i');
}

const VERDICT_LABEL = {
  en: { ok: 'Relayable', partial: 'Partial', fail: 'Missed' },
  ko: { ok: '그대로 전달', partial: '부분', fail: '놓침' },
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Same bytes the first data.json had (it was written by a Python builder):
 * one-space indent per level, literal UTF-8, final newline, and three quirks
 * that JSON.stringify cannot express.
 *   1. Each `trace` array holds one compact `{"t":1.9,...}` object per line,
 *      indented three spaces, with the closing bracket at two spaces.
 *   2. Whole-number floats keep their `.0`, but only where the data is a float
 *      by nature: `savingsPct` and a trace entry's `t`. JS cannot tell 2.0 from 2.
 *   3. Empty arrays and objects are `[]` and `{}`.
 */
const FLOAT_KEYS = new Set(['savingsPct', 't']);

function siteNumber(n, key) {
  return FLOAT_KEYS.has(key) && Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function siteCompact(v, key) {
  if (typeof v === 'number') return siteNumber(v, key);
  if (Array.isArray(v)) return `[${v.map((x) => siteCompact(x)).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${siteCompact(x, k)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function siteValue(v, depth, key) {
  if (typeof v === 'number') return siteNumber(v, key);
  const pad = ' '.repeat(depth + 1);
  const close = ' '.repeat(depth);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (key === 'trace') return `[\n${v.map((x) => `   ${siteCompact(x)}`).join(',\n')}\n  ]`;
    return `[\n${v.map((x) => pad + siteValue(x, depth + 1)).join(',\n')}\n${close}]`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${siteValue(x, depth + 1, k)}`).join(',\n')}\n${close}}`;
  }
  return JSON.stringify(v);
}

export const serializeSite = (value) => siteValue(value, 0) + '\n';
const serializePretty = (value) => JSON.stringify(value, null, 2) + '\n';

export function loadCorpus(evalsDir) {
  const index = readJson(join(evalsDir, 'index.json'));
  const conditions = readJson(join(evalsDir, 'conditions.json'));
  const rounds = readJson(join(evalsDir, 'rounds.json'));
  const casesDir = join(evalsDir, 'cases');
  const files = existsSync(casesDir)
    ? readdirSync(casesDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
    : [];
  const byFile = {};
  for (const id of files) byFile[id] = readJson(join(casesDir, `${id}.json`));
  return { index, conditions, rounds, files, byFile };
}

function walk(value, visit, path = '') {
  if (typeof value === 'string' || typeof value === 'number') visit(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, visit, path ? `${path}.${k}` : k);
  }
}

export function validateCorpus(corpus) {
  const { index, conditions, rounds, files, byFile } = corpus;
  const fail = (id, msg) => {
    throw new Error(`evals: case ${id}: ${msg}`);
  };

  if (!index || !Array.isArray(index.cases)) throw new Error('evals: index.json needs a "cases" array');
  const seen = new Set();
  for (const id of index.cases) {
    if (seen.has(id)) fail(id, 'listed more than once in index.json');
    seen.add(id);
    if (!files.includes(id)) fail(id, 'listed in index.json but evals/cases has no such file');
  }
  for (const id of files) {
    if (!seen.has(id)) fail(id, 'has a case file but index.json does not list it');
  }

  const condById = new Map();
  for (const c of conditions) {
    if (condById.has(c.id)) throw new Error(`evals: conditions.json: duplicate condition id ${c.id}`);
    condById.set(c.id, c);
  }
  const roundIds = new Set(rounds.map((r) => r.id));

  const ids = new Set();
  for (const id of index.cases) {
    const c = byFile[id];
    if (String(c.id) !== id) fail(id, `file name does not match its id field (${JSON.stringify(c.id)})`);
    if (ids.has(c.id)) fail(id, 'duplicate id');
    ids.add(c.id);
    for (const f of REQUIRED_CASE_FIELDS) {
      if (c[f] === undefined || c[f] === null) fail(id, `missing required field "${f}"`);
    }
    for (const f of BILINGUAL_FIELDS) {
      if (typeof c[f]?.ko !== 'string' || typeof c[f]?.en !== 'string') fail(id, `${f} needs string ko and en`);
    }
    if (!roundIds.has(c.round)) fail(id, `round "${c.round}" is not in rounds.json`);
    if (!STORIES.includes(c.story)) fail(id, `story "${c.story}" must be one of ${STORIES.join('|')}`);
    if (!Array.isArray(c.lanes) || !Array.isArray(c.runs)) fail(id, 'lanes and runs must be arrays');
    for (const lane of c.lanes) {
      if (!condById.has(lane)) fail(id, `lane "${lane}" is not in conditions.json`);
    }
    if (!condById.has(c.recommended)) fail(id, `recommended "${c.recommended}" is not in conditions.json`);

    for (const r of c.runs) {
      if (!condById.has(r.condition)) fail(id, `run ${r.run} uses unknown condition "${r.condition}"`);
      if (!VERDICTS.includes(r.verdict)) fail(id, `run ${r.run} verdict "${r.verdict}" must be ok|partial|fail`);
      if (r.round !== undefined && !roundIds.has(r.round)) fail(id, `run ${r.run} round "${r.round}" is not in rounds.json`);
    }
    // Repeats vary effort only (no condition id), so only their verdict is checked.
    for (const r of c.repeats || []) {
      if (!VERDICTS.includes(r.verdict)) fail(id, `a repeat verdict "${r.verdict}" must be ok|partial|fail`);
    }

    const baselineRuns = c.runs.filter((r) => r.role === 'baseline');
    if (baselineRuns.length > 1) fail(id, 'more than one run has role "baseline"');
    const hasObject = c.baseline && typeof c.baseline === 'object' && Object.keys(c.baseline).length > 0;
    if (!hasObject && baselineRuns.length !== 1) {
      fail(id, 'needs exactly one run with role "baseline" or a baseline object');
    }
    const base = baselineUsd(c);
    if (!Number.isFinite(base) || base <= 0) fail(id, 'baseline usd must be a positive finite number');
    const rec = recommendedRun(c, rounds);
    if (!rec) fail(id, `no run uses the recommended condition "${c.recommended}"`);
    if (!Number.isFinite(rec.usd)) fail(id, 'recommended run usd must be a finite number');

    walk(c, (v, path) => {
      if (typeof v === 'number' && !Number.isFinite(v)) fail(id, `${path} is not a finite number`);
    });
  }

  // Privacy: every string in every case file, plus the shared tables.
  const re = privacyRe();
  const scan = (label, value) =>
    walk(value, (v, path) => {
      const hit = typeof v === 'string' && v.match(re);
      if (hit) {
        throw new Error(`evals: privacy check failed in ${label} at ${path || '(root)'}: matches "${hit[0]}"`);
      }
    });
  for (const id of index.cases) scan(`case ${id}`, byFile[id]);
  scan('conditions.json', conditions);
  scan('rounds.json', rounds);
}

function baselineUsd(c) {
  if (c.baseline && Number.isFinite(c.baseline.usd)) return c.baseline.usd;
  const run = c.runs.find((r) => r.role === 'baseline');
  return run ? run.usd : NaN;
}

function recommendedRun(c, rounds) {
  const order = new Map(rounds.map((r, i) => [r.id, i]));
  const rank = (r) => order.get(r.round ?? c.round) ?? Infinity;
  const matches = c.runs.map((r, i) => ({ r, i })).filter(({ r }) => r.condition === c.recommended);
  matches.sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);
  return matches.length ? matches[0].r : null;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function buildSummary(corpus) {
  const { index, rounds, byFile } = corpus;
  const cases = index.cases.map((id) => byFile[id]);
  const byStory = {};
  const byKind = {};
  let runs = 0;
  const items = cases.map((c) => {
    runs += c.runs.length + (c.repeats ? c.repeats.length : 0);
    byStory[c.story] = (byStory[c.story] || 0) + 1;
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    const rec = recommendedRun(c, rounds);
    const base = baselineUsd(c);
    return {
      id: c.id,
      title: c.title,
      kind: c.kind,
      story: c.story,
      round: c.round,
      recommended: c.recommended,
      recommendedLabel: conditionLabel(corpus.conditions.find((x) => x.id === c.recommended)),
      recommendedVerdict: rec.verdict,
      recommendedUsd: rec.usd,
      baselineUsd: base,
      savingsPct: round1((1 - rec.usd / base) * 100),
      lesson: c.lesson,
    };
  });
  const dates = rounds.map((r) => r.date).filter(Boolean).sort();
  return {
    generatedFrom: 'evals/',
    cases: cases.length,
    runs,
    rounds: rounds.map((r) => r.id),
    latest: dates.length ? dates[dates.length - 1] : null,
    byStory,
    byKind,
    items,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function conditionLabel(condition) {
  if (!condition) return '';
  const base = `${cap(condition.model)} · ${condition.effort}`;
  return condition.prompt === 'improved' ? `${base} (improved prompt)` : base;
}

function costText(pct, lang) {
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return lang === 'ko' ? `${abs}% 저렴` : `${abs}% cheaper`;
  if (pct < 0) return lang === 'ko' ? `${abs}% 비쌈` : `${abs}% more`;
  return lang === 'ko' ? '같음' : 'same';
}

const cell = (s) => String(s).replace(/\|/g, '\\|');

function itemRow(item, condById, lang, titleKey) {
  return [
    cell(item.title[titleKey]),
    conditionLabel(condById.get(item.recommended)),
    VERDICT_LABEL[lang][item.recommendedVerdict],
    costText(item.savingsPct, lang),
  ];
}

const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export function buildSummaryMd(summary, conditions) {
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const rows = summary.items.map((it) => {
    const [title, setup, verdict, cost] = itemRow(it, condById, 'en', 'en');
    return [title, it.kind, it.story, setup, verdict, cost];
  });
  return [
    '# Replayed delegations',
    '',
    `Full write-ups and every run: ${PROOF_URL}`,
    '',
    `${summary.cases} cases, ${summary.runs} runs, ${summary.rounds.length} rounds, latest ${summary.latest}. ` +
      'Cost is the recommended setup against the Opus baseline on the same task. Generated by `npm run evals:build`.',
    '',
    table(['Case', 'Kind', 'Story', 'Recommended setup', 'Verdict', 'Cost vs Opus baseline'], rows),
    '',
  ].join('\n');
}

export function buildEvidenceBlock(summary, conditions, lang) {
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const latest = summary.items.slice(-8).reverse();
  const rows = latest.map((it) => itemRow(it, condById, lang, lang));
  if (lang === 'ko') {
    return [
      '### 재생으로 검증한 위임',
      '',
      `위임 사례 ${summary.cases}건을 라운드 ${summary.rounds.length}개에 걸쳐 실행 ${summary.runs}회로 다시 돌렸고 가장 최근 재생은 ${summary.latest}입니다.`,
      '',
      table(['사례', '추천 설정', '판정', 'Opus 대비 비용'], rows),
      '',
      `모든 실행 기록은 [sprag.io/proof](${PROOF_URL})에서, 전체 표는 [evals/SUMMARY.md](https://github.com/rootstudioyaml/sprag/blob/main/evals/SUMMARY.md)에서 볼 수 있습니다.`,
    ].join('\n');
  }
  return [
    '### Replayed delegations',
    '',
    `${summary.cases} real delegations were replayed across ${summary.rounds.length} rounds in ${summary.runs} runs, the latest on ${summary.latest}.`,
    '',
    table(['Case', 'Recommended setup', 'Verdict', 'Cost vs Opus'], rows),
    '',
    `Every run is on [sprag.io/proof](${PROOF_URL}), and the full table is in [evals/SUMMARY.md](https://github.com/rootstudioyaml/sprag/blob/main/evals/SUMMARY.md).`,
  ].join('\n');
}

/** Replace the marked block, or insert it just before `anchor` the first time. */
export function applyEvidenceBlock(text, block, anchor) {
  const wrapped = `${EVIDENCE_START}\n${block}\n${EVIDENCE_END}`;
  const s = text.indexOf(EVIDENCE_START);
  const e = text.indexOf(EVIDENCE_END);
  if (s !== -1 && e > s) return text.slice(0, s) + wrapped + text.slice(e + EVIDENCE_END.length);
  if (s !== -1 || e !== -1) throw new Error('evals: README has only one of the sprag:evidence markers');
  const at = text.indexOf(`\n${anchor}\n`);
  if (at === -1) throw new Error(`evals: README has no "${anchor}" heading to place the evidence block before`);
  return text.slice(0, at + 1) + wrapped + '\n\n' + text.slice(at + 1);
}

const README_TARGETS = [
  { file: 'README.md', lang: 'en', anchor: '## Research behind the tier rules' },
  { file: 'README.ko.md', lang: 'ko', anchor: '## 티어 기준의 근거가 된 연구' },
];

/**
 * Totals for the proof page headline and the home page banner: replayed cases plus the bulk set,
 * Opus-direct cost against the recommended condition's cost, and how the recommended runs were graded.
 * `handed` covers only the jobs sprag handed off (recommended or lane is not opus-direct), `kept` counts
 * the jobs it left on the main model, where both sides cost the same. Opus is the grading reference for
 * bulk rows, so they count as ok on the Opus side. Without bulk.cases the bulk totals are added to the
 * overall numbers only, and handed and kept come from the graded cases alone.
 */
export function buildBanner(siteData) {
  const round = (v) => Math.round(v * 100) / 100;
  const savedOf = (opus, pick) => (opus > 0 ? 100 - Math.round(pick / opus * 100) : 0);
  const all = { n: 0, opusUsd: 0, pickUsd: 0, ok: 0, partial: 0, fail: 0, opusOk: 0 };
  const hd = { n: 0, opusUsd: 0, pickUsd: 0, ok: 0, partial: 0, fail: 0 };
  let keptN = 0;
  const tally = (t, verdict) => { if (verdict === 'ok' || verdict === 'partial' || verdict === 'fail') t[verdict]++; };
  for (const c of siteData.cases) {
    const o = c.runs.find((r) => r.condition === 'opus-direct');
    const s = c.runs.find((r) => r.condition === c.recommended);
    all.n++;
    if (c.recommended === 'opus-direct') keptN++; else hd.n++;
    if (!o || !s) continue;
    all.opusUsd += o.usd; all.pickUsd += s.usd; tally(all, s.verdict);
    if (o.verdict === 'ok') all.opusOk++;
    if (c.recommended !== 'opus-direct') { hd.opusUsd += o.usd; hd.pickUsd += s.usd; tally(hd, s.verdict); }
  }
  const bulk = siteData.bulk;
  if (bulk && Array.isArray(bulk.cases) && bulk.cases.length) {
    for (const r of bulk.cases) {
      all.n++; all.opusUsd += r.opusUsd; all.pickUsd += r.pickUsd; tally(all, r.verdict); all.opusOk++;
      if (r.lane !== 'opus-direct') { hd.n++; hd.opusUsd += r.opusUsd; hd.pickUsd += r.pickUsd; tally(hd, r.verdict); }
      else keptN++;
    }
  } else if (bulk && bulk.totals && bulk.totals.n) {
    const bt = bulk.totals;
    all.n += bt.n; all.opusUsd += bt.opusUsd; all.pickUsd += bt.pickUsd;
    all.ok += bt.ok || 0; all.partial += bt.partial || 0; all.fail += bt.fail || 0; all.opusOk += bt.n;
  }
  const pct = all.opusUsd > 0 ? Math.round(all.pickUsd / all.opusUsd * 100) : 0;
  return {
    n: all.n, opusUsd: round(all.opusUsd), pickUsd: round(all.pickUsd), pct, savedPct: 100 - pct,
    ok: all.ok, partial: all.partial, fail: all.fail, opusOk: all.opusOk,
    handed: { n: hd.n, opusUsd: round(hd.opusUsd), pickUsd: round(hd.pickUsd), savedPct: savedOf(hd.opusUsd, hd.pickUsd), ok: hd.ok, partial: hd.partial, fail: hd.fail },
    kept: { n: keptN },
  };
}

/**
 * Compute every generated file in memory.
 * Returns { files: Map<absolute path, content>, summary }.
 */
export function generate({ repoRoot = DEFAULT_REPO_ROOT, evalsDir = join(repoRoot, 'evals') } = {}) {
  const corpus = loadCorpus(evalsDir);
  validateCorpus(corpus);
  const summary = buildSummary(corpus);
  const files = new Map();

  const siteData = {
    conditions: corpus.conditions,
    rounds: corpus.rounds,
    cases: corpus.index.cases.map((id) => corpus.byFile[id]),
  };
  const livePath = join(evalsDir, 'live.json');
  if (existsSync(livePath)) siteData.live = readJson(livePath);
  const bulkPath = join(evalsDir, 'bulk.json');
  if (existsSync(bulkPath)) siteData.bulk = readJson(bulkPath);
  const bulkNotesPath = join(evalsDir, 'bulk-notes.json');
  if (siteData.bulk && existsSync(bulkNotesPath)) siteData.bulk.notes = readJson(bulkNotesPath);
  files.set(join(repoRoot, 'site', 'proof', 'data.json'), serializeSite(siteData));
  // The home page banner needs five totals, not the whole 480 KB data.json.
  files.set(join(repoRoot, 'site', 'proof', 'banner.json'), serializePretty(buildBanner(siteData)));
  files.set(join(evalsDir, 'summary.json'), serializePretty(summary));
  files.set(join(evalsDir, 'SUMMARY.md'), buildSummaryMd(summary, corpus.conditions));

  for (const t of README_TARGETS) {
    const path = join(repoRoot, t.file);
    if (!existsSync(path)) continue;
    const block = buildEvidenceBlock(summary, corpus.conditions, t.lang);
    if (privacyRe().test(block)) throw new Error(`evals: privacy check failed in the ${t.file} evidence block`);
    const next = applyEvidenceBlock(readFileSync(path, 'utf8'), block, t.anchor);
    files.set(path, next);
  }

  for (const [path, content] of files) {
    if (path.endsWith('README.md') || path.endsWith('README.ko.md')) continue;
    if (privacyRe().test(content)) throw new Error(`evals: privacy check failed in generated ${path}`);
  }
  return { files, summary };
}

/** Paths whose on-disk content differs from the generated content. */
export function staleFiles(options) {
  const { files } = generate(options);
  const stale = [];
  for (const [path, content] of files) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== content) stale.push(path);
  }
  return stale;
}

export function writeAll(options) {
  const { files, summary } = generate(options);
  const written = [];
  for (const [path, content] of files) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(path);
  }
  return { written, summary };
}

function main(argv) {
  const check = argv.includes('--check');
  try {
    if (check) {
      const stale = staleFiles();
      if (stale.length) {
        console.error('evals: generated files are stale, run `npm run evals:build`:');
        for (const f of stale) console.error(`  ${f}`);
        return 1;
      }
      console.log('evals: generated files are up to date');
      return 0;
    }
    const { written, summary } = writeAll();
    console.log(`evals: ${summary.cases} cases, ${summary.runs} runs; ${written.length} file(s) updated`);
    for (const f of written) console.log(`  ${f}`);
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
