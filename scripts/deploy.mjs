#!/usr/bin/env node
/**
 * deploy — run the release from the keyword, with nothing left to confirm.
 *
 * docs/RELEASING.md is the procedure a person follows; this is the same
 * procedure with the steps wired together, so that the bot's deploy keyword is
 * the whole instruction. There is no approval prompt on purpose: the approval is
 * the keyword, and a release that stops halfway to ask something is the failure
 * mode this replaces.
 *
 * What it will not do is decide anything. The version comes from the newest
 * CHANGELOG heading, the body comes from the committed draft, and a draft that
 * is missing or still carries its REVIEW line stops the run before anything is
 * published.
 * Steps 1 and 2 of the procedure stay a person's work.
 *
 *   npm run deploy            # release whatever the changelog's newest entry is
 *   npm run deploy -- 3.46.0  # or name the version
 *   npm run deploy -- --dry-run
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFT_MARKER, needsReview } from '../src/changelog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const asked = args.find((a) => /^\d+\.\d+\.\d+/.test(a)) || null;

function stop(msg, detail) {
  console.error(`deploy: ${msg}`);
  if (detail) console.error(String(detail).trim().split('\n').map((l) => `  ${l}`).join('\n'));
  process.exit(1);
}

/** Run a command, streaming it, and stop the release where it fails. */
function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun && !opts.evenInDryRun) return '';
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    env: opts.env || process.env,
  });
  if (r.status !== 0) stop(`\`${cmd} ${cmdArgs.join(' ')}\` failed (${r.status}).`, r.stdout);
  return String(r.stdout || '');
}

function capture(cmd, cmdArgs, env) {
  // Network reads (npm view) hang silently on a stalled registry; bound them.
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', env: env || process.env, timeout: 60_000 });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

// npm reads the registry token from .npmrc, which refers to NPM_TOKEN; a shell
// that never exported it publishes with an empty credential and reads as an
// expired login. The value is in .env, so take it from there when it is absent.
function npmEnv() {
  if (process.env.NPM_TOKEN) return process.env;
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return process.env;
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('NPM_TOKEN='));
  if (!line) return process.env;
  return { ...process.env, NPM_TOKEN: line.slice('NPM_TOKEN='.length).trim() };
}

// --- preflight --------------------------------------------------------------
// The pull comes first, and that ordering is the whole point of this block.
// Everything below decides what to release by reading CHANGELOG.md off the disk,
// so reading it before the pull decides against a stale checkout. That is not a
// loud failure: the release this clone has already shipped is what it finds, its
// tag is present and npm already serves it, so the run skips the publish and
// reports the old version as though there had been nothing new to do. The bot
// hits this every time someone pushes a release from somewhere else — the answer
// is always "already released", and the release sits on origin untouched.
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (branch !== 'main') stop(`on branch ${branch}; releases go out from main.`);
const dirty = capture('git', ['status', '--porcelain']).out;
if (dirty) stop('the working tree has uncommitted changes.', dirty);
// Tags carry the release history this run compares against, and a clone that
// fetched none of them reads every version as unreleased.
run('git', ['pull', '--ff-only', '--tags', 'origin', 'main'], { evenInDryRun: true });

// --- what is being released -------------------------------------------------
// Read after the pull, never before: these two files are what the pull updates.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const newest = (changelog.match(/^###\s+v(\d+\.\d+\.\d+)/m) || [])[1];
if (!newest && !asked) stop('no "### vX.Y.Z" heading found in CHANGELOG.md.');
const version = asked || newest;
const tag = `v${version}`;
const draftPath = join(ROOT, 'docs', 'releases', `${tag}.md`);

if (!existsSync(draftPath)) {
  stop(`no notes draft at docs/releases/${tag}.md.`,
    `Write the changelog entry, then: node scripts/release-notes.mjs ${version}`);
}
// The marker is imported rather than spelled out here. Both gates carried the
// string separately once, and renaming it in one place left this one grepping for
// text that no longer existed — which does not fail loudly, it passes and ships
// an unreviewed draft as the release.
if (needsReview(readFileSync(draftPath, 'utf8'))) {
  stop(`the draft docs/releases/${tag}.md has not been reviewed.`,
    `Fill both halves and delete the REVIEW line: ${DRAFT_MARKER}`);
}

const alreadyTagged = capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).ok;
const onNpm = capture('npm', ['view', `sprag-cli@${version}`, 'version']).out === version;
console.log(`deploy: ${tag} — tag ${alreadyTagged ? 'exists' : 'missing'}, npm ${onNpm ? 'has it' : 'does not have it'}.`);
if (onNpm) {
  // Say which of the two this is, because they look identical from the outside
  // and only one of them is a no-op worth reporting as such.
  console.log(alreadyTagged
    ? `deploy: ${tag} is already published; re-publishing its release notes and nothing else.`
    : `deploy: npm already serves ${version}; only the tag and release notes are left.`);
}
if (dryRun) console.log('deploy: dry run; nothing below is executed.');

// --- steps 3 and 4 ----------------------------------------------------------
// A version already on npm is the "released without notes" case: the tag and the
// package are correct, and only the release body is missing, so publishing the
// notes is the whole remaining job.
if (!onNpm) {
  run('npm', ['test']);
  run('node', ['scripts/verify-cli.mjs']);
  if (pkg.version !== version) run('npm', ['version', version]);
  run('npm', ['publish'], { env: npmEnv() });
  run('git', ['push', 'origin', 'main', '--follow-tags']);
}

// --- steps 5 and 6 ----------------------------------------------------------
run('node', ['scripts/release-notes.mjs', version, '--publish']);

if (!dryRun) {
  const shown = capture('node', ['-e',
    `import('./src/update-check.js').then(async m => console.log((await m.fetchHighlights('${version}')).join('\\n')))`]);
  const lines = shown.out.split('\n').filter(Boolean);
  if (!lines.length) {
    stop('the published release yields no highlights, so the upgrade offer will show a bare version number.',
      `Check https://github.com/rootstudioyaml/sprag/releases/tag/${tag}`);
  }
  console.log(`\ndeploy: what an upgrading user will be shown for ${tag}:`);
  for (const l of lines) console.log(`  ${l}`);
}

// The local copy is what the next session runs, so it follows the release
// rather than lagging a version behind it.
//
// Pinned to the version just published, not `@latest`. `npm publish` returns
// before the registry serves the new version everywhere, and in that window
// `@latest` still resolves to the previous release — on v3.49.0 this reinstalled
// 3.48.0 and reported success, leaving the local copy a version behind the tag
// that had just been pushed. The wait below covers the same window: the install
// would fail outright against a registry that has not caught up yet.
if (!dryRun) {
  const DELAY_MS = 15_000;
  const ATTEMPTS = 8;
  for (let i = 1; ; i++) {
    if (capture('npm', ['view', `sprag-cli@${version}`, 'version'], npmEnv()).out === version) break;
    if (i === ATTEMPTS) {
      stop(`the registry still does not serve ${version} after ${(ATTEMPTS * DELAY_MS) / 1000}s.`,
        `The publish itself succeeded. Install the local copy once it propagates:\n  npm install -g sprag-cli@${version}`);
    }
    console.log(`deploy: waiting for the registry to serve ${version} (${i}/${ATTEMPTS})...`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, DELAY_MS);
  }
}
run('npm', ['install', '-g', `sprag-cli@${version}`], { env: npmEnv() });

console.log(onNpm
  ? `\ndeploy: ${tag} was already on npm — release notes republished, nothing else changed.`
  : `\ndeploy: ${tag} is out — npm, tag, and release notes.`);
