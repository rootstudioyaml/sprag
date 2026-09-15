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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sectionFor, DRAFT_MARKER, needsReview } from '../src/changelog.js';
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

test('the shipped version has a committed release-notes draft, and it is translated', () => {
  // The upgrade offer reads the published release, and the draft is what gets
  // published. Keeping it in the repo is what makes it reviewable — and what
  // lets this test check, before the tag goes out, that it is not still the
  // untranslated extraction.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const draft = join(ROOT, 'docs', 'releases', `v${pkg.version}.md`);
  assert.ok(existsSync(draft), `docs/releases/v${pkg.version}.md must exist for the shipped version`);
  const body = readFileSync(draft, 'utf8');
  assert.doesNotMatch(body, /REVIEW:/, 'the draft must be reviewed before release');
  // Both halves have to yield something, because the notice reads whichever one
  // matches the reader. A draft with an empty English half would show Korean
  // users their lines and English users nothing.
  for (const lang of ['en', 'ko']) {
    const shown = releaseHighlights(body, lang);
    assert.ok(shown.length > 0, `${lang}: the draft must yield at least one bullet`);
    for (const line of shown) {
      assert.ok(line.length <= 115, `${lang}: a shown line must fit one row: ${line}`);
    }
  }
});

// --- the review gate --------------------------------------------------------
// Two scripts refuse to publish an unreviewed draft, and they used to carry the
// marker string separately. Renaming it in one left the other grepping for text
// that no longer existed, and that failure is silent in the dangerous direction:
// a gate looking for an absent string does not error, it passes.

test('needsReview blocks a fresh draft and clears a reviewed one', () => {
  assert.equal(needsReview(`${DRAFT_MARKER}\n\n- a thing.\n`), true);
  assert.equal(needsReview('- a thing.\n'), false);
  assert.equal(needsReview(''), false);
  assert.equal(needsReview(undefined), false);
});

test('needsReview keys on the marker opening, not its wording', () => {
  // The instruction after `<!-- REVIEW:` is prose for a human. Editing it must
  // not disarm the gate, which is what matching the whole line would do.
  assert.equal(needsReview('<!-- REVIEW: anything at all -->\n'), true);
  assert.equal(needsReview('<!-- REVIEW: 한국어로 적어도 -->\n'), true);
});

test('both publish paths gate through the shared marker', () => {
  // Source-level, because the alternative is a gate that agrees today and drifts
  // the next time one of the two files is edited.
  for (const rel of ['scripts/release-notes.mjs', 'scripts/deploy.mjs']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /from '\.\.\/src\/changelog\.js'/,
      `${rel} must import the marker rather than spell it out`);
    assert.match(src, /needsReview\(/, `${rel} must gate through needsReview`);
    assert.doesNotMatch(src, /'<!-- (REVIEW|TRANSLATE)/,
      `${rel} must not carry its own copy of the marker`);
  }
});

test('the marker names REVIEW, which is what the docs tell the reader to delete', () => {
  // The docs say "delete the REVIEW line". If the marker were renamed without
  // the docs, the instruction would name a line that is not in the file.
  assert.match(DRAFT_MARKER, /^<!-- REVIEW:/);
  const doc = readFileSync(join(ROOT, 'docs', 'RELEASING.md'), 'utf8');
  assert.doesNotMatch(doc, /TRANSLATE/, 'RELEASING.md still names the old marker');
});
