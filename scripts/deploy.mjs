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
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', env: env || process.env });
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

// --- what is being released -------------------------------------------------
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

// --- preflight --------------------------------------------------------------
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (branch !== 'main') stop(`on branch ${branch}; releases go out from main.`);
const dirty = capture('git', ['status', '--porcelain']).out;
if (dirty) stop('the working tree has uncommitted changes.', dirty);
run('git', ['pull', '--ff-only', 'origin', 'main'], { evenInDryRun: true });

const alreadyTagged = capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).ok;
const onNpm = capture('npm', ['view', `sprag-cli@${version}`, 'version']).out === version;
console.log(`deploy: ${tag} — tag ${alreadyTagged ? 'exists' : 'missing'}, npm ${onNpm ? 'has it' : 'does not have it'}.`);
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
run('npm', ['install', '-g', 'sprag-cli@latest'], { env: npmEnv() });

console.log(`\ndeploy: ${tag} is out — npm, tag, and release notes.`);
