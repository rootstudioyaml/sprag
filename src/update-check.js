/**
 * update-check — "is there a newer sprag?", answered without ever
 * blocking a render.
 *
 * The statusline command runs every ~300ms, so a network call on that path is
 * out of the question. We use the same shape sindresorhus/update-notifier
 * settled on: the foreground only ever READS a cached answer, and when that
 * answer is older than the check interval it spawns a detached, unref'd child
 * that refreshes the cache for the *next* render. Nothing awaits the network.
 *
 * State lives next to the other user-data files:
 *   { checkedAt: <ms>, latest: "3.25.0", current: "3.24.0",
 *     dismissedVersion: "3.25.0"|undefined,
 *     highlights: ["…", "…"]|undefined, highlightsFor: "3.25.0"|undefined }
 *
 * `highlights` is what the new version actually adds, read from the GitHub
 * release for that tag. A bare "v3.24 → v3.25 is available" gives the user
 * nothing to weigh: the answer to "should I upgrade" is in what changed, and
 * asking them to go find that themselves is how an upgrade notice becomes
 * something to dismiss. The release body is fetched on the same detached,
 * once-a-day pass as the version check, and its absence never blocks the
 * notice — a version number alone is still worth saying.
 *
 * Opt out with CTS_NO_UPDATE_CHECK=1 or NO_UPDATE_NOTIFIER (the de-facto
 * standard env var — anyone who set it for other CLIs meant us too).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

// This copy may be installed under the canonical name or under the legacy one.
// Releases go out under the canonical name, so that is the entry the registry
// check consults either way — a legacy copy must keep hearing about new
// versions even after the legacy name stops receiving publishes.
import { createRequire } from 'node:module';
const PKG_NAME = createRequire(import.meta.url)('../package.json').name;
const CANONICAL_NAME = 'sprag-cli';
const LEGACY_NAME = 'claude-token-saver';
const IS_LEGACY = PKG_NAME === LEGACY_NAME;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — the registry is not a health endpoint
const FETCH_TIMEOUT_MS = 5000;

export function updateStatePath() {
  return join(userDataDir(), 'update-check.json');
}

export function updateCheckDisabled() {
  return process.env.CTS_NO_UPDATE_CHECK === '1' || !!process.env.NO_UPDATE_NOTIFIER;
}

export function readUpdateState() {
  try {
    const s = JSON.parse(readFileSync(updateStatePath(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeUpdateState(next) {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(updateStatePath(), JSON.stringify(next, null, 2) + '\n');
}

/**
 * Compare two semver-ish strings. Returns true when `a` is strictly newer than
 * `b`. Pre-release tags (`3.25.0-beta.1`) are treated as older than the plain
 * release, which is what we want: we never nudge anyone onto a pre-release.
 */
export function isNewer(a, b) {
  const parse = (v) => {
    const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!m) return null;
    return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || null };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
  }
  if (pa.pre && !pb.pre) return false; // 3.25.0-beta < 3.25.0
  if (!pa.pre && pb.pre) return true;
  return false;
}

/**
 * The read-only accessor every render path uses.
 *
 * @returns {{current: string, latest: string|null, available: boolean, dismissed: boolean, stale: boolean}}
 */
export function updateStatus(currentVersion) {
  if (updateCheckDisabled()) {
    return { current: currentVersion, latest: null, available: false, dismissed: false, stale: false };
  }
  const s = readUpdateState();
  const latest = typeof s.latest === 'string' ? s.latest : null;
  const available = !!latest && isNewer(latest, currentVersion);
  const age = Date.now() - (Number(s.checkedAt) || 0);
  return {
    current: currentVersion,
    latest,
    available,
    // A version the user already declined stays out of the statusline and out
    // of the session briefing until a newer one ships — otherwise "no thanks"
    // means "ask me again in five minutes", forever.
    dismissed: available && s.dismissedVersion === latest,
    stale: age >= CHECK_INTERVAL_MS,
    // Only when they describe THIS version. A cache written for an earlier
    // release would otherwise sell the wrong upgrade.
    highlights: Array.isArray(s.highlights) && s.highlightsFor === latest ? s.highlights : [],
  };
}

/**
 * Fire the background refresh when the cached answer has aged out. Returns
 * immediately in every case; the child is detached and unref'd so it cannot
 * hold the statusline process open.
 */
export function maybeSpawnUpdateCheck(currentVersion) {
  if (updateCheckDisabled()) return false;
  const { stale } = updateStatus(currentVersion);
  if (!stale) return false;
  // Stamp the attempt before spawning. Without this, an offline machine
  // re-spawns a doomed child on every single statusline render — several per
  // second — because the cache never gets a fresh timestamp.
  try {
    writeUpdateState({ ...readUpdateState(), checkedAt: Date.now(), current: currentVersion });
  } catch (e) {
    debug('update-check:stamp', e);
    return false;
  }
  try {
    spawn(process.execPath, [cliEntryPath(), 'update-check', '--refresh', '--quiet'], {
      detached: true,
      stdio: 'ignore',
      // Without this Windows flashes a console window, and this one
      // re-spawns from the statusline — several times a minute.
      windowsHide: true,
    }).unref();
    return true;
  } catch (e) {
    debug('update-check:spawn', e);
    return false;
  }
}

/** Path to this package's CLI entry point (bin/cli.js). */
export function cliEntryPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
}

// Release notes come from the repository's own releases, because the registry
// does not carry them: `/latest` answers with package metadata and no changelog
// of any kind. Unauthenticated reads are allowed at 60/hour, and this runs once
// a day behind the same interval as the version check, so the budget is ample.
const RELEASES_API = 'https://api.github.com/repos/rootstudioyaml/sprag/releases/tags';
const MAX_HIGHLIGHTS = 3;
const MAX_HIGHLIGHT_LEN = 110;

/**
 * The headline items of a release body, as short single lines.
 *
 * Release notes are written for people reading a web page: headings, prose
 * paragraphs, links, and bold runs. A session-start notice has one line per
 * item and no room for any of that, so this keeps only what reads as an item
 * of a list and strips it to plain text. Anything that survives is a sentence
 * the user can judge an upgrade by; anything that does not is left behind
 * rather than truncated into nonsense.
 *
 * @param {string} body - the release body as published
 * @returns {string[]} at most MAX_HIGHLIGHTS lines, or [] when nothing fits
 */
export function releaseHighlights(body) {
  const text = String(body || '');
  if (!text.trim()) return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Bullets only. A heading names a section, and a prose paragraph in a
    // release body is usually the rationale rather than the change itself.
    const m = /^[-*+]\s+(.*)$/.exec(line);
    if (!m) continue;
    // Markup goes first, so the sentence split below sees the text a reader
    // would: `**Bash writes are checked.**` is one sentence, not a bold run.
    // One exception has to be caught before that: a stop followed straight by a
    // code span (`…checked.\`install\` migrates…`) is a sentence boundary, and
    // stripping the backtick first leaves a lowercase letter the split ignores.
    // A space there is what the author meant, and it costs nothing if not.
    let item = m[1]
      .replace(/([.。])(`)/g, '$1 $2')
      .replace(/`([^`]*)`/g, '$1')            // code spans read fine as plain text
      .replace(/\*\*([^*]*)\*\*/g, '$1')      // bold
      .replace(/\*([^*]*)\*/g, '$1')          // italics
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their label
      .replace(/\s+/g, ' ')
      .trim();
    if (!item) continue;
    // Release notes lead with the change and follow with the reasoning, often
    // for several sentences. The first sentence is the change, so that is what
    // a one-line notice keeps — cutting at a character count instead lands
    // mid-clause and reads as a broken string rather than a short one.
    //
    // The break does not require a space after the stop: "…checked.The matcher…"
    // is a typo a release body can carry, and requiring one there merged the two
    // sentences into a single over-long line. A capital letter or a Hangul
    // syllable directly after the stop is enough to say a new sentence started;
    // a digit is not, so "0.5s" and "v3.45.0" stay intact.
    //
    // Abbreviations are excluded by name. "Fixed e.g. the matcher" would
    // otherwise end after two words, which is worse than a long line: it reads
    // as a complete thought and is not one. This list covers what actually turns
    // up in release prose rather than trying to be exhaustive.
    // `etc.` is deliberately absent: it ends a sentence as often as it continues
    // one, so either choice is wrong half the time and the wrong one here merges
    // two sentences rather than truncating one. Merging is the milder failure,
    // and the length cap below bounds it.
    const ABBREV = /\b(?:e\.g|i\.e|vs|cf|Dr|Mr|Ms|St|approx|no)\.$/i;
    const parts = item.split(/(?<=[.。])(?:\s+|(?=[A-Z가-힣]))/);
    let first = parts[0];
    for (let k = 1; k < parts.length && ABBREV.test(first); k += 1) {
      // The stop belonged to an abbreviation, so the sentence continues.
      first = `${first} ${parts[k]}`;
    }
    item = first || item;
    // Some first sentences are themselves a paragraph. Those get cut, but at a
    // word boundary and with the ellipsis that says so.
    if (item.length > MAX_HIGHLIGHT_LEN) {
      const cut = item.slice(0, MAX_HIGHLIGHT_LEN);
      const space = cut.lastIndexOf(' ');
      item = (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:—\-]$/, '').trim() + '…';
    }
    out.push(item);
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

/**
 * Fetch the highlights for one version. Returns [] on any failure: the notice
 * is worth showing with a bare version number, so a missing release, a rate
 * limit, or an offline machine must not cost the user the notice itself.
 */
export async function fetchHighlights(version, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${RELEASES_API}/v${version}`, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`releases responded ${res.status}`);
    const body = await res.json();
    return releaseHighlights(body && body.body);
  } catch (e) {
    debug('update-check:highlights', e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Actually hit the registry and persist the answer. Only the detached child
 * and the explicit `update-check --refresh` command call this.
 */
export async function refreshUpdateState(currentVersion) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // The `latest` dist-tag endpoint returns a few hundred bytes, unlike the
    // full packument which is megabytes for a package with this many releases.
    const res = await fetch(`https://registry.npmjs.org/${CANONICAL_NAME}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    const body = await res.json();
    const latest = typeof body.version === 'string' ? body.version : null;
    if (!latest) throw new Error('registry response carried no version');
    const prev = readUpdateState();
    const next = { ...prev, checkedAt: Date.now(), latest, current: currentVersion };
    // A newly published version clears an older dismissal: the user declined
    // 3.25.0, not "all future upgrades".
    if (prev.dismissedVersion && isNewer(latest, prev.dismissedVersion)) {
      delete next.dismissedVersion;
    }
    // What the new version adds, so the notice can answer "why would I".
    // Only worth a second request when there is actually an upgrade to describe,
    // and only when we do not already hold the notes for that exact version.
    if (isNewer(latest, currentVersion) && prev.highlightsFor !== latest) {
      const highlights = await fetchHighlights(latest);
      if (highlights.length) {
        next.highlights = highlights;
        next.highlightsFor = latest;
      } else {
        // Drop notes belonging to an older version rather than showing them
        // against this one.
        delete next.highlights;
        delete next.highlightsFor;
      }
    }
    writeUpdateState(next);
    return { ok: true, latest };
  } catch (e) {
    debug('update-check:refresh', e);
    // Keep the timestamp fresh even on failure so an offline machine backs off
    // for the full interval instead of retrying on every render.
    try {
      writeUpdateState({ ...readUpdateState(), checkedAt: Date.now(), current: currentVersion });
    } catch (e2) {
      debug('update-check:refresh-stamp', e2);
    }
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Record that the user said "not now" for this exact version. */
export function dismissUpdate(version) {
  const s = readUpdateState();
  writeUpdateState({ ...s, dismissedVersion: version });
}

/**
 * How this copy was installed, and therefore what command upgrades it.
 * Best-effort: the install root is the only reliable signal we have, and when
 * it tells us nothing we fall back to the npm global install, which is how the
 * overwhelming majority of copies got here.
 */
export function upgradeCommand() {
  const here = dirname(fileURLToPath(import.meta.url));
  // A legacy copy upgrades by moving to the canonical name. Installing the new
  // name alone would leave two copies fighting over the same `sprag` binary,
  // so the old one comes off first.
  if (IS_LEGACY) {
    if (here.includes('/pnpm/')) return `pnpm remove -g ${LEGACY_NAME} && pnpm add -g ${CANONICAL_NAME}@latest`;
    if (here.includes('/.bun/')) return `bun remove -g ${LEGACY_NAME} && bun add -g ${CANONICAL_NAME}@latest`;
    if (here.includes('/.yarn/')) return `yarn global remove ${LEGACY_NAME} && yarn global add ${CANONICAL_NAME}@latest`;
    return `npm uninstall -g ${LEGACY_NAME} && npm install -g ${CANONICAL_NAME}@latest`;
  }
  if (here.includes('/pnpm/')) return `pnpm add -g ${PKG_NAME}@latest`;
  if (here.includes('/.bun/')) return `bun add -g ${PKG_NAME}@latest`;
  if (here.includes('/.yarn/')) return `yarn global add ${PKG_NAME}@latest`;
  return `npm install -g ${PKG_NAME}@latest`;
}

export const UPDATE_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
export const PACKAGE_NAME = PKG_NAME;
export const CANONICAL_PACKAGE_NAME = CANONICAL_NAME;
/** True when this copy was installed under the legacy package name. */
export const INSTALLED_UNDER_LEGACY_NAME = IS_LEGACY;
