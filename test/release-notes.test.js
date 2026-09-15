/**
 * CHANGELOG extraction for release notes.
 *
 * The release body is what the session-start upgrade offer reads back, so a
 * section pulled with the wrong boundaries either drops the release's own items
 * or carries the previous release's. Both are silent: the offer just shows the
 * wrong three lines.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sectionFor } from '../src/changelog.js';
import { releaseHighlights } from '../src/update-check.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHANGELOG = [
  '# Changelog',
  '',
  '## All releases',
  '',
  '### v2.0.0 (2026-01-02)',
  '- second thing.',
  '- another second thing.',
  '',
  '### v1.9.0 (2026-01-01)',
  '- first thing.',
  '',
].join('\n');

test('a section stops at the next version heading', () => {
  assert.deepEqual(sectionFor(CHANGELOG, '2.0.0').split('\n'), [
    '- second thing.',
    '- another second thing.',
  ]);
  assert.deepEqual(sectionFor(CHANGELOG, '1.9.0'), '- first thing.');
});

test('a version that is not in the changelog returns null, not the wrong section', () => {
  // Publishing the previous release's notes under a new tag is worse than
  // refusing: the user reads about changes that are not in what they installed.
  assert.equal(sectionFor(CHANGELOG, '3.0.0'), null);
  assert.equal(sectionFor(CHANGELOG, '2.0'), null, 'a partial version must not match');
});

test('patch versions do not collide with their minor', () => {
  const log = ['### v3.42.7 (d)', '- patch.', '', '### v3.42.0 (d)', '- minor.', ''].join('\n');
  assert.equal(sectionFor(log, '3.42.7'), '- patch.');
  assert.equal(sectionFor(log, '3.42.0'), '- minor.');
});

test('the real changelog yields a body the upgrade offer can use', () => {
  // End to end on committed data: the section for the current version has to
  // produce the lines a user would actually be shown.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const body = sectionFor(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), pkg.version);
  assert.ok(body, `CHANGELOG.md must carry a section for the shipped version (${pkg.version})`);
  const shown = releaseHighlights(body);
  assert.ok(shown.length > 0, 'the section must yield at least one bullet');
  assert.ok(shown.length <= 3, 'and at most three are shown');
  for (const line of shown) {
    assert.ok(line.length <= 115, `a shown line must fit one row: ${line}`);
  }
});
