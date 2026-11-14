import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import {
  generate, staleFiles, writeAll, applyEvidenceBlock, serializeSite, buildBanner, EVIDENCE_START, EVIDENCE_END,
} from '../scripts/evals/build.mjs';
import { formatProof, run as runProof } from '../src/commands/proof.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');

/** A throwaway repo root holding a copy of the real corpus and READMEs. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-evals-'));
  cpSync(join(ROOT, 'evals'), join(dir, 'evals'), { recursive: true });
  for (const f of ['README.md', 'README.ko.md']) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

const readCase = (dir, id) => JSON.parse(readFileSync(join(dir, 'evals', 'cases', `${id}.json`), 'utf8'));
const writeCase = (dir, id, c) => writeFileSync(join(dir, 'evals', 'cases', `${id}.json`), JSON.stringify(c, null, 2) + '\n');

function withTemp(fn) {
  const dir = tempRepo();
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('committed evals output is up to date', () => {
  assert.deepEqual(staleFiles(), []);
});

test('build is deterministic and idempotent', () => {
  withTemp((dir) => {
    const first = writeAll({ repoRoot: dir });
    assert.ok(first.summary.cases > 0);
    assert.deepEqual(staleFiles({ repoRoot: dir }), []);
    assert.deepEqual(writeAll({ repoRoot: dir }).written, []);
  });
});

test('summary counts runs plus repeats and picks the recommended run', () => {
  const { summary } = generate();
  assert.equal(summary.items.length, summary.cases);
  assert.ok(summary.runs >= summary.cases);
  const item = summary.items[0];
  assert.ok(Number.isFinite(item.savingsPct));
  assert.equal(item.savingsPct, Math.round((1 - item.recommendedUsd / item.baselineUsd) * 1000) / 10);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(JSON.stringify(summary)), 'no wall-clock timestamp');
});

test('site serializer keeps whole-number floats where the data is a float', () => {
  const out = serializeSite({ a: [{ savingsPct: 0, trace: [{ t: 2, tok: 5 }] }], e: [], o: {} });
  assert.match(out, /"savingsPct": 0\.0/);
  assert.match(out, /\n   \{"t":2\.0,"tok":5\}\n  \]/);
  assert.match(out, /"e": \[\]/);
  assert.ok(out.endsWith('}\n'));
});

test('editing a case makes the check stale', () => {
  withTemp((dir) => {
    const c = readCase(dir, '0');
    c.lesson.en += ' Edited.';
    writeCase(dir, '0', c);
    const stale = staleFiles({ repoRoot: dir });
    assert.ok(stale.some((f) => f.endsWith('data.json')));
  });
});

test('unknown condition is rejected with the case id', () => {
  withTemp((dir) => {
    const c = readCase(dir, '0');
    c.runs[0].condition = 'nope-high';
    writeCase(dir, '0', c);
    assert.throws(() => generate({ repoRoot: dir }), /case 0: .*nope-high/);
  });
});

test('unknown round, story and verdict are rejected', () => {
  for (const [mutate, pattern] of [
    [(c) => { c.round = 'r99'; }, /round "r99"/],
    [(c) => { c.story = 'vibes'; }, /story "vibes"/],
    [(c) => { c.runs[0].verdict = 'great'; }, /verdict "great"/],
    [(c) => { c.baseline = {}; c.runs.forEach((r) => { delete r.role; }); }, /baseline/],
  ]) {
    withTemp((dir) => {
      const c = readCase(dir, '44');
      mutate(c);
      writeCase(dir, '44', c);
      assert.throws(() => generate({ repoRoot: dir }), pattern);
    });
  }
});

test('missing required field is rejected', () => {
  withTemp((dir) => {
    const c = readCase(dir, '0');
    delete c.truth;
    writeCase(dir, '0', c);
    assert.throws(() => generate({ repoRoot: dir }), /case 0: missing required field "truth"/);
  });
});

test('duplicated id in the index is rejected', () => {
  withTemp((dir) => {
    const path = join(dir, 'evals', 'index.json');
    const index = JSON.parse(readFileSync(path, 'utf8'));
    index.cases.push(index.cases[0]);
    writeFileSync(path, JSON.stringify(index));
    assert.throws(() => generate({ repoRoot: dir }), /listed more than once/);
  });
});

test('a case file the index does not list is rejected', () => {
  withTemp((dir) => {
    const path = join(dir, 'evals', 'index.json');
    const index = JSON.parse(readFileSync(path, 'utf8'));
    const dropped = index.cases.pop();
    writeFileSync(path, JSON.stringify(index));
    assert.throws(() => generate({ repoRoot: dir }), new RegExp(`case ${dropped}: has a case file but index.json does not list it`));
  });
});

test('an index entry without a case file is rejected', () => {
  withTemp((dir) => {
    const path = join(dir, 'evals', 'index.json');
    const index = JSON.parse(readFileSync(path, 'utf8'));
    index.cases.push('9999');
    writeFileSync(path, JSON.stringify(index));
    assert.throws(() => generate({ repoRoot: dir }), /case 9999: listed in index.json but/);
  });
});

test('a local path in a case is rejected by the privacy check', () => {
  withTemp((dir) => {
    const c = readCase(dir, '0');
    c.runs[0].excerpt = 'ran in /Users/someone/x';
    writeCase(dir, '0', c);
    assert.throws(() => generate({ repoRoot: dir }), /privacy check failed in case 0/);
  });
});

test('an email address in a case is rejected by the privacy check', () => {
  withTemp((dir) => {
    const c = readCase(dir, '0');
    c.truth.en = 'mail me at someone@example.com';
    writeCase(dir, '0', c);
    assert.throws(() => generate({ repoRoot: dir }), /privacy check failed/);
  });
});

test('evidence block is inserted once before the anchor and then replaced in place', () => {
  const text = 'intro\n\n## Next\n\nbody\n';
  const once = applyEvidenceBlock(text, 'ONE', '## Next');
  assert.equal(once, `intro\n\n${EVIDENCE_START}\nONE\n${EVIDENCE_END}\n\n## Next\n\nbody\n`);
  assert.equal(applyEvidenceBlock(once, 'TWO', '## Next'), once.replace('ONE', 'TWO'));
  assert.throws(() => applyEvidenceBlock('no heading', 'X', '## Next'), /no "## Next" heading/);
});

test('both READMEs carry the generated block', () => {
  for (const f of ['README.md', 'README.ko.md']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    assert.equal(text.split(EVIDENCE_START).length, 2, `${f} has one start marker`);
    assert.equal(text.split(EVIDENCE_END).length, 2, `${f} has one end marker`);
  }
});

test('sprag proof prints the table and --json prints the summary', () => {
  const home = mkdtempSync(join(tmpdir(), 'sprag-proof-home-'));
  try {
    const env = childEnv({ HOME: home, XDG_CONFIG_HOME: join(home, 'cfg'), NO_COLOR: '1', SPRAG_LANG: 'en' });
    const opts = { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
    const out = execFileSync(process.execPath, [CLI, 'proof'], opts);
    const { summary } = generate();
    assert.ok(out.includes(`${summary.cases} replayed delegations`));
    assert.ok(out.includes(summary.items[0].title.en));
    assert.ok(out.includes('https://sprag.io/proof/'));
    const json = execFileSync(process.execPath, [CLI, 'proof', '--json'], opts);
    assert.deepEqual(JSON.parse(json), summary);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('formatProof renders titles in the requested language', () => {
  const { summary } = generate();
  assert.ok(formatProof(summary, 'en').includes(summary.items[0].title.en));
  assert.ok(formatProof(summary, 'ko').includes(summary.items[0].title.ko));
});

test('sprag proof with no summary file prints one line and does not throw', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await runProof({ args: ['proof'], hasFlag: () => false, summaryPath: join(tmpdir(), 'sprag-no-such-summary.json') });
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('https://sprag.io/proof/'));
});

const bannerCase = (recommended, opus, pick, pickVerdict = 'ok', opusVerdict = 'ok') => ({
  recommended,
  runs: [{ condition: 'opus-direct', usd: opus, verdict: opusVerdict }, { condition: recommended, usd: pick, verdict: pickVerdict }],
});

test('buildBanner splits the jobs sprag handed off from the ones it kept on the main model', () => {
  const b = buildBanner({
    cases: [bannerCase('haiku-low', 10, 2), bannerCase('sonnet-high', 10, 5, 'partial'), bannerCase('opus-direct', 10, 10)],
    bulk: {
      totals: { n: 99, ok: 99, partial: 0, fail: 0, pickUsd: 1, opusUsd: 1 },
      cases: [
        { lane: 'opus-direct', verdict: 'ok', pickUsd: 4, opusUsd: 4 },
        { lane: 'sonnet-high', verdict: 'fail', pickUsd: 3, opusUsd: 6 },
        { lane: 'haiku-low', verdict: 'ok', pickUsd: 1, opusUsd: 2 },
      ],
    },
  });
  assert.deepEqual(Object.keys(b), ['n', 'opusUsd', 'pickUsd', 'pct', 'savedPct', 'ok', 'partial', 'fail', 'opusOk', 'handed', 'kept']);
  assert.deepEqual(b, {
    n: 6, opusUsd: 42, pickUsd: 25, pct: 60, savedPct: 40, ok: 4, partial: 1, fail: 1, opusOk: 6,
    handed: { n: 4, opusUsd: 28, pickUsd: 11, savedPct: 61, ok: 2, partial: 1, fail: 1 },
    kept: { n: 2 },
  });
  assert.deepEqual(Object.keys(b.handed), ['n', 'opusUsd', 'pickUsd', 'savedPct', 'ok', 'partial', 'fail']);
});

test('buildBanner without bulk rows adds the bulk totals to the overall numbers only', () => {
  const b = buildBanner({
    cases: [bannerCase('haiku-low', 10, 2), bannerCase('opus-direct', 10, 10)],
    bulk: { totals: { n: 5, ok: 3, partial: 1, fail: 1, pickUsd: 8, opusUsd: 20 } },
  });
  assert.equal(b.n, 7);
  assert.equal(b.opusUsd, 40);
  assert.equal(b.pickUsd, 20);
  assert.equal(b.pct, 50);
  assert.equal(b.savedPct, 50);
  assert.deepEqual([b.ok, b.partial, b.fail, b.opusOk], [5, 1, 1, 7]);
  assert.deepEqual(b.handed, { n: 1, opusUsd: 10, pickUsd: 2, savedPct: 80, ok: 1, partial: 0, fail: 0 });
  assert.deepEqual(b.kept, { n: 1 });
});

test('the committed banner.json is what buildBanner makes from the committed data.json', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'site', 'proof', 'data.json'), 'utf8'));
  const committed = JSON.parse(readFileSync(join(ROOT, 'site', 'proof', 'banner.json'), 'utf8'));
  assert.deepEqual(buildBanner(data), committed);
  assert.equal(committed.handed.n + committed.kept.n, committed.n);
});

test('live.json carries savedCostUsd between costRuns and savedUsd', () => {
  const live = JSON.parse(readFileSync(join(ROOT, 'evals', 'live.json'), 'utf8'));
  const keys = Object.keys(live);
  assert.deepEqual(keys.slice(keys.indexOf('costUsd')), ['costUsd', 'costRuns', 'savedCostUsd', 'savedUsd']);
  assert.ok(live.savedCostUsd > 0 && live.savedCostUsd <= live.savedUsd);
});
