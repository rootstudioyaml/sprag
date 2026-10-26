import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport } from '../src/formatters/statusline.js';
import { readTeamChip, saveTeamState } from '../src/team-sync.js';

const base = () => ({
  summary: { hitRate: 0.9 }, ttl: { total: 100, pct1h: 1 }, cost: { savings: 1500 },
  options: { days: 1, windowLabel: '1d', version: '3.0.0' }, lastActivity: Date.now(), delegationSaved: 0,
});
const line = (team) => formatReport({ ...base(), team }, { color: false, timer: false, mode: 'icon' });
const chip = (team) => line(team).split(' · ').find((p) => p.includes('member-'));
const standing = (extra = {}) => ({ grade: 'fox', fetchedAt: Date.now() - 60_000, ...extra });

test('joined with a standing: member label, emoji, name (ko and en)', () => {
  assert.equal(chip({ label: 'member-1e500474', lang: 'ko', standing: standing() }), 'member-1e500474 🦊 여우');
  assert.equal(chip({ label: 'member-1e500474', lang: 'en', standing: standing() }), 'member-1e500474 🦊 Fox');
});

test('chip sits right before the version chip', () => {
  const parts = line({ label: 'member-1e500474', lang: 'en', standing: standing() }).split(' · ');
  assert.match(parts[parts.length - 2], /member-1e500474/);
  assert.match(parts[parts.length - 1], /v3\.0\.0/);
});

test('without a standing, with a stale one, or with an unknown grade: member label only', () => {
  assert.equal(chip({ label: 'member-1e500474', lang: 'en', standing: null }), 'member-1e500474');
  assert.equal(chip({ label: 'member-1e500474', lang: 'en', standing: standing({ fetchedAt: Date.now() - 25 * 3600_000 }) }), 'member-1e500474');
  assert.equal(chip({ label: 'member-1e500474', lang: 'en', standing: standing({ grade: 'sphinx' }) }), 'member-1e500474');
});

test('not joined: no chip', () => {
  assert.equal(chip(null), undefined);
  assert.equal(chip(undefined), undefined);
});

test('--segments team renders the chip alone', () => {
  const out = formatReport({ ...base(), team: { label: 'member-1e500474', lang: 'en', standing: standing() } }, { color: false, timer: false, mode: 'icon', segments: ['team'] });
  assert.equal(out.trim(), 'member-1e500474 🦊 Fox');
});

test('readTeamChip: joined, left and never joined; reads only and creates nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-chip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readTeamChip({ dir }), null);
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1e500474', standing: { grade: 'owl', fetchedAt: 5 } }, dir);
  const joined = readTeamChip({ dir });
  assert.equal(joined.label, 'member-1e500474');
  assert.deepEqual(joined.standing, { grade: 'owl', fetchedAt: 5 });
  // No display name and no member-id file: nothing to show, and no file appears.
  saveTeamState({ memberKey: 'spk_x' }, dir);
  assert.equal(readTeamChip({ dir }), null);
  assert.deepEqual(readdirSync(dir), ['team.json']);
  writeFileSync(join(dir, 'member-id'), 'member-abcdef01\n');
  assert.equal(readTeamChip({ dir }).label, 'member-abcdef01');
  saveTeamState({ left: true, displayName: 'member-1e500474' }, dir);
  assert.equal(readTeamChip({ dir }), null);
});
