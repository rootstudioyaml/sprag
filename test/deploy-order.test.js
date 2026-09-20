/**
 * deploy — the order of its preflight, pinned.
 *
 * `scripts/deploy.mjs` decides which version to release by reading CHANGELOG.md
 * off the disk. Reading it before `git pull` decides against whatever this clone
 * happens to hold, and a clone that is behind origin holds the release it has
 * already shipped. Nothing about that fails: the tag is present, npm already
 * serves that version, the publish is skipped, and the run reports the old
 * version as though there had been nothing new to release.
 *
 * That is how the Slack bot answered every deploy request with "already
 * released" while the release it was asked for sat on origin, untouched. The
 * bot's clone is long-lived and the pushes come from elsewhere, so it was behind
 * almost every time.
 *
 * The regression is invisible from the outside — a successful-looking run with
 * the wrong version in it — so the order is asserted on the source rather than
 * left to a reviewer to notice. deploy.mjs publishes to npm on import, so it
 * cannot be executed here; reading it is the test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'scripts', 'deploy.mjs'), 'utf8');

/** Index of the first line matching `re`, or -1. Comments are excluded so that
 *  prose describing the rule cannot satisfy the rule. */
function lineOf(re) {
  const lines = SRC.split('\n');
  return lines.findIndex((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && re.test(l));
}

test('the pull runs before the changelog is read', () => {
  const pull = lineOf(/run\(\s*'git'.*'pull'/);
  const changelog = lineOf(/readFileSync\([^)]*'CHANGELOG\.md'/);
  assert.ok(pull > 0, 'deploy.mjs no longer pulls origin/main at all');
  assert.ok(changelog > 0, 'deploy.mjs no longer reads CHANGELOG.md');
  assert.ok(
    pull < changelog,
    `CHANGELOG.md is read at line ${changelog + 1}, before the pull at line ${pull + 1}. `
    + 'A clone that is behind origin then releases the version it already shipped '
    + 'and reports it as nothing to do.',
  );
});

test('package.json is read after the pull too', () => {
  const pull = lineOf(/run\(\s*'git'.*'pull'/);
  const pkg = lineOf(/readFileSync\([^)]*'package\.json'/);
  assert.ok(
    pull < pkg,
    'package.json is read before the pull, so `npm version` compares against a stale version.',
  );
});

test('the pull brings tags with it', () => {
  const lines = SRC.split('\n');
  const pull = lines.find((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /run\(\s*'git'.*'pull'/.test(l));
  assert.ok(
    pull.includes("'--tags'"),
    'the pull does not fetch tags, so a clone missing them reads released versions as unreleased.',
  );
  assert.ok(
    pull.includes("'--ff-only'"),
    'the pull is no longer --ff-only; a merge commit would put unreviewed work in the release.',
  );
});

test('the dirty check still guards the pull', () => {
  const dirty = lineOf(/git', \['status', '--porcelain'\]/);
  const pull = lineOf(/run\(\s*'git'.*'pull'/);
  assert.ok(
    dirty > 0 && dirty < pull,
    'the working-tree check must precede the pull, or the pull fails on local edits '
    + 'with a message about rebasing rather than about uncommitted work.',
  );
});
