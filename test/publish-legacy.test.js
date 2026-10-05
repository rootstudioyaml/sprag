/**
 * publish-legacy — the deprecation that follows the publish, pinned.
 *
 * `scripts/publish-legacy.mjs` publishes this tree under the old name
 * `claude-token-saver`. npm deprecates versions, not names, so a version
 * published after the name was deprecated arrives unmarked: `npm i
 * claude-token-saver` installs it and says nothing about `sprag-cli`.
 *
 * 3.50.0 and 3.55.0 went out that way while the 126 versions before them
 * carried the notice. Nothing failed, and the registry kept serving the latest
 * version of a renamed package as though it were current, to several hundred
 * installs a week.
 *
 * publish-legacy.mjs publishes to npm on import, so it cannot be executed here;
 * reading it is the test, as in deploy-order.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'scripts', 'publish-legacy.mjs'), 'utf8');
const LINES = SRC.split('\n');

/** Index of the first line matching `re`, or -1. Comments are excluded so that
 *  prose describing the rule cannot satisfy the rule. */
function lineOf(re) {
  return LINES.findIndex((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && re.test(l));
}

const PUBLISH = /execSync\(\s*'npm publish'/;
const DEPRECATE = /\(\s*'npm',\s*\[\s*'deprecate'/;

test('the publish is followed by a deprecation', () => {
  const publish = lineOf(PUBLISH);
  const deprecate = lineOf(DEPRECATE);
  assert.ok(publish > 0, 'publish-legacy.mjs no longer publishes at all');
  assert.ok(
    deprecate > 0,
    'publish-legacy.mjs publishes without deprecating, so the new version of the old name '
    + 'installs with no pointer to sprag-cli.',
  );
  assert.ok(
    publish < deprecate,
    `the deprecation at line ${deprecate + 1} runs before the publish at line ${publish + 1}; `
    + 'the version does not exist yet, so there is nothing for it to mark.',
  );
});

test('the deprecation names the version just published, under the legacy name', () => {
  const rename = lineOf(/pkg\.name = 'claude-token-saver'/);
  const spec = lineOf(/const spec = `\$\{pkg\.name\}@\$\{pkg\.version\}`/);
  assert.ok(rename > 0, 'the staged manifest is no longer renamed to claude-token-saver');
  assert.ok(
    spec > rename,
    'the spec must be built after the rename, or the deprecation lands on sprag-cli itself.',
  );
  const call = LINES[lineOf(DEPRECATE)];
  assert.ok(call.includes('spec'), 'the deprecation no longer targets the published version');
  assert.ok(call.includes('LEGACY_DEPRECATION'), 'the deprecation no longer sends the shared message');
});

test('the message reaches npm as an argument, not through a shell', () => {
  // The message holds `&&`. In a shell string everything after it would run as
  // a second command on the machine doing the release.
  const call = LINES[lineOf(DEPRECATE)];
  assert.ok(
    /execFileSync\(/.test(call),
    'the deprecation is not an execFileSync call, so its message is exposed to shell parsing.',
  );
});

test('the message tells a legacy install how to move', () => {
  const literal = SRC.match(/const LEGACY_DEPRECATION = '([^']+)';/);
  assert.ok(literal, 'LEGACY_DEPRECATION is no longer a single-quoted literal this test can read');
  const message = literal[1];
  assert.ok(message.includes('sprag-cli'), 'the message does not name the package to move to');
  assert.ok(
    message.includes('npm uninstall -g claude-token-saver'),
    'the message drops the uninstall step; both names ship the same binaries, so installing '
    + 'sprag-cli beside the old package leaves the old one in place.',
  );
});

test('a failed deprecation fails the run and prints the command to rerun', () => {
  const deprecate = lineOf(DEPRECATE);
  const exit = lineOf(/process\.exitCode = 1/);
  const hint = lineOf(/npm deprecate \$\{spec\}/);
  assert.ok(
    exit > deprecate,
    'a failed deprecation no longer fails the run, so a live, unmarked version passes for a clean publish.',
  );
  assert.ok(hint > deprecate, 'a failed deprecation no longer prints the command that repairs it');
});
