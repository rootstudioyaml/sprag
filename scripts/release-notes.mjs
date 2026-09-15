#!/usr/bin/env node
/**
 * release-notes — extract one version's CHANGELOG section, and publish it as
 * that tag's GitHub release.
 *
 * Why this exists: the session-start upgrade offer reads the release body for
 * the version it is offering, so a release with no body leaves the user with
 * two version numbers and no reason to upgrade. Tagging and publishing were
 * manual, and the release itself was the step that got forgotten — v3.45.0
 * shipped with a tag and no notes at all.
 *
 * Two steps, deliberately separate. The CHANGELOG is written in Korean and
 * English mixed, while releases on a public repo have been English, so the
 * extracted text is a draft a person edits before it goes out. `--publish`
 * refuses to run on a file that still carries the untranslated marker.
 *
 *   node scripts/release-notes.mjs 3.46.0            # extract to a draft file
 *   node scripts/release-notes.mjs 3.46.0 --publish  # create/update the release
 *
 * Drafts live in docs/releases/ and are committed, for three reasons. A draft in
 * a temp directory is gone after a reboot, taking the translation with it. It
 * also cannot be reviewed: what a release will tell every user is worth a second
 * pair of eyes before it goes out, and a file outside the repository never
 * reaches a diff. And os.tmpdir() is not /tmp on macOS, so "edit the draft" and
 * "publish the draft" quietly referred to two different files — which is exactly
 * the mistake that produced a release attempt against untranslated text.
 *
 * The GitHub token comes from GITHUB_TOKEN or GH_TOKEN, and falls back to the
 * login `gh` holds when that one turns out to be read-only here: a fine-grained
 * token can read this repository and still lack `Contents: write`, which only
 * the release call needs. Creating a release is a write, which corporate
 * networks may block; the script tells that apart from a refused token rather
 * than reporting one as the other.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionFor } from '../src/changelog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_SLUG = 'rootstudioyaml/sprag';
const TODO = '<!-- TRANSLATE: review this draft before publishing -->';

function usage(msg) {
  if (msg) console.error(`release-notes: ${msg}`);
  console.error('usage: node scripts/release-notes.mjs <version> [--publish] [--force] [--file <path>]');
  process.exit(1);
}

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('-'));
if (!version) usage('a version is required');
if (!/^\d+\.\d+\.\d+/.test(version)) usage(`"${version}" does not look like a version`);
const publish = args.includes('--publish');
const force = args.includes('--force');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const DRAFT_DIR = join(ROOT, 'docs', 'releases');
const draftPath = fileArg || join(DRAFT_DIR, `v${version}.md`);
/** Path as the user would type it, so messages match what they see in git. */
const shown = (p) => (p.startsWith(ROOT) ? relative(ROOT, p) : p);

if (!publish) {
  const body = sectionFor(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!body) {
    console.error(`release-notes: CHANGELOG.md has no "### v${version}" section.`);
    console.error('  Add the section first — the release notes are the changelog, not a separate text.');
    process.exit(1);
  }
  // A draft that has already been translated must not be silently replaced with
  // the raw extraction. Re-running this after translating is an easy mistake —
  // it is the same command — and the work it discards is the work that matters.
  if (!force && existsSync(draftPath) && !readFileSync(draftPath, 'utf8').includes(TODO)) {
    console.error(`release-notes: ${shown(draftPath)} exists and carries no TRANSLATE marker,`);
    console.error('  so it has been translated already. Re-extracting would discard that.');
    console.error('  Publish it as it stands:');
    console.error(`    node scripts/release-notes.mjs ${version} --publish`);
    console.error('  Or start over deliberately: delete the file first, or pass --force.');
    process.exit(1);
  }
  mkdirSync(DRAFT_DIR, { recursive: true });
  writeFileSync(draftPath, `${TODO}\n\n${body}\n`);
  const korean = (body.match(/[가-힣]/g) || []).length;
  const bullets = body.split('\n').filter((l) => /^\s*[-*+]\s/.test(l));
  console.log(`draft: ${shown(draftPath)}`);
  console.log(`  ${bullets.length} bullet(s), ${korean} Korean character(s)`);
  if (korean > 0) {
    console.log('  Korean text is present. Past releases on this repo are English, so');
    console.log('  translate before publishing.');
  }
  // The upgrade offer reads this body back and shows the first sentence of the
  // first three bullets. Which three that is depends on the order they appear
  // in, so a body that opens with the details of one area spends all three
  // lines there and never mentions the rest of the release.
  console.log('');
  console.log('  The session-start upgrade offer shows the FIRST SENTENCE of the FIRST THREE');
  console.log('  bullets, so those three lines are what most users will ever read of this');
  console.log('  release. Open the body with one bullet per area of the release, each a');
  console.log('  complete sentence, and put the per-area detail in sections below them.');
  if (bullets.length) {
    console.log('');
    console.log('  As written, the offer would show:');
    for (const b of bullets.slice(0, 3)) {
      const plain = b.replace(/^\s*[-*+]\s+/, '')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]*)\*\*/g, '$1')
        .replace(/\*([^*]*)\*/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      const first = plain.split(/(?<=[.。])\s+/)[0] || plain;
      console.log(`    · ${first.length > 110 ? `${first.slice(0, 107)}…` : first}`);
    }
  }
  console.log('');
  console.log(`  then: node scripts/release-notes.mjs ${version} --publish`);
  process.exit(0);
}

// --- publish ---------------------------------------------------------------
if (!existsSync(draftPath)) {
  usage(`no draft at ${shown(draftPath)} — run without --publish first`);
}
const draft = readFileSync(draftPath, 'utf8');
if (draft.includes(TODO)) {
  console.error('release-notes: the draft still carries the TRANSLATE marker.');
  console.error(`  Edit ${shown(draftPath)}, remove that line, then publish.`);
  process.exit(1);
}
/**
 * The token `gh` holds, read with the environment ones removed so that `gh`
 * answers with its stored login rather than echoing back the variable that just
 * failed. A machine without `gh`, or without a login, simply has no second
 * candidate.
 */
function ghCliToken() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const r = spawnSync('gh', ['auth', 'token'], { env, encoding: 'utf8' });
  const out = r.status === 0 ? String(r.stdout || '').trim() : '';
  return out || null;
}

// Two candidates, because a fine-grained token that reads this repository fine
// can still lack `Contents: write`, and the release is the one call that needs
// it. The environment token is tried first (it is what the procedure exports),
// and a 403 from GitHub itself moves on to the login `gh` already has.
const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const candidates = [
  { token: envToken, source: process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'GH_TOKEN' },
  { token: ghCliToken(), source: 'gh auth token' },
].filter((c, i, all) => c.token && all.findIndex((o) => o.token === c.token) === i);
if (!candidates.length) usage('GITHUB_TOKEN or GH_TOKEN is required to publish (or a logged-in `gh`)');
let active = 0;

const api = `https://api.github.com/repos/${REPO_SLUG}/releases`;
const headers = () => ({
  authorization: `Bearer ${candidates[active].token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
});
const tag = `v${version}`;

/** Explain the failure and stop. Blocked writes are the common case here. */
function fail(status, detail) {
  console.error(`release-notes: could not publish (${status}).`);
  // A network that intercepts api.github.com answers with its own block page
  // rather than an API error, so the response is HTML where JSON belongs. That
  // is a policy answer, not a bad token, and saying so is the difference
  // between a two-minute fix and an hour spent on credentials.
  // A 403 carrying a GitHub JSON error is GitHub itself refusing: a fine-grained
  // token without `Contents: write` on this repository answers exactly that way.
  // Reading it as a blocked write sends the reader to the wrong network.
  const text = String(detail || '');
  let apiMessage = '';
  try { apiMessage = JSON.parse(text).message || ''; } catch { apiMessage = ''; }
  const blocked = !apiMessage && (/^<|doctype|site-block/i.test(text) ||
    [302, 307, 403].includes(Number(status)));
  if (apiMessage) {
    console.error(`  GitHub answered: ${apiMessage}`);
    if (Number(status) === 403) {
      console.error('  A token is present and readable, so this is permission rather than network:');
      console.error(`  grant the token \`Contents: write\` on ${REPO_SLUG}, or paste the draft into the form:`);
      console.error(`    https://github.com/${REPO_SLUG}/releases/new?tag=${tag}`);
      console.error(`  The draft is at ${shown(draftPath)}.`);
    }
  } else if (blocked) {
    console.error('  This looks like the network refusing the write rather than GitHub refusing it:');
    console.error('  some corporate networks allow reads to api.github.com and block writes.');
    console.error('  Publish from a network that allows them, or paste the draft into the form:');
    console.error(`    https://github.com/${REPO_SLUG}/releases/new?tag=${tag}`);
    console.error(`  The draft is at ${shown(draftPath)}.`);
  } else if (String(detail || '').trim()) {
    console.error(`  ${String(detail).slice(0, 300)}`);
  }
  process.exit(1);
}

/** True for GitHub's own 403, which is a permission answer the next token may pass. */
function refusedByGitHub(status, text) {
  if (Number(status) !== 403) return false;
  try { return Boolean(JSON.parse(text).message); } catch { return false; }
}

/** fetch + parse, with the block page and a dead network turned into `fail`. */
async function call(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: headers() });
  } catch (e) {
    fail('request failed', e && e.message);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok && refusedByGitHub(res.status, text) && active + 1 < candidates.length) {
    active += 1;
    console.error(`release-notes: ${candidates[active - 1].source} may not write releases; trying ${candidates[active].source}.`);
    return call(url, init);
  }
  if (!res.ok) fail(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    // 200 with a non-JSON body is the block page answering on GitHub's behalf.
    fail(`${res.status}, non-JSON response`, text);
  }
  return null;
}

// An existing release is updated rather than duplicated: re-running this after
// a correction must not leave two releases on one tag. A 404 here is the normal
// case (no release yet), so it is not routed through `fail`.
let existing = null;
try {
  const probe = await fetch(`${api}/tags/${tag}`, { headers: headers() });
  if (probe.ok) {
    const body = await probe.text();
    try { existing = JSON.parse(body); } catch { fail(`${probe.status}, non-JSON response`, body); }
  }
} catch (e) {
  fail('request failed', e && e.message);
}

const out = await call(existing ? `${api}/${existing.id}` : api, {
  method: existing ? 'PATCH' : 'POST',
  body: JSON.stringify({ tag_name: tag, name: tag, body: draft.trim() }),
});
console.log(`${existing ? 'updated' : 'created'}: ${out.html_url}`);
