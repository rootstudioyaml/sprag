import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport, formatNoSession } from '../src/formatters/statusline.js';
import { resolveLabelMode } from '../src/statusline-mode.js';
import { readTeamChip, saveTeamState } from '../src/team-sync.js';

const base = () => ({
  summary: { hitRate: 0.9 }, ttl: { total: 100, pct1h: 1 }, cost: { savings: 1500 },
  options: { days: 1, windowLabel: '1d', version: '3.0.0' }, lastActivity: Date.now(), delegationSaved: 0,
});
const line = (team) => formatReport({ ...base(), team }, { color: false, timer: false, mode: 'icon' });
const chip = (team) => line(team).split(' · ').find((p) => p.includes('member-'));
const standing = (extra = {}) => ({ grade: 'fox', fetchedAt: Date.now() - 60_000, ...extra });
// A joined Pro machine in the acmeco organization, the common case.
const pro = (extra = {}) => ({ label: 'member-1a2b3c4d', org: 'acmeco', plan: 'pro', ...extra });

test('joined with a standing: plan, member label, organization, rank, emoji and name (ko and en)', () => {
  assert.equal(chip(pro({ lang: 'ko', standing: standing() })), 'Pro member-1a2b3c4d acmeco 🦊 여우');
  assert.equal(chip(pro({ lang: 'en', standing: standing() })), 'Pro member-1a2b3c4d acmeco 🦊 Fox');
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 🦊 여우');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1a2b3c4d acmeco overall score #3 of 12 🦊 Fox');
  // The plan leads whatever it is called; an Enterprise team says so.
  assert.equal(chip(pro({ plan: 'enterprise', lang: 'en', standing: standing({ rank: 1, ranked: 4 }) })), 'Enterprise member-1a2b3c4d acmeco overall score #1 of 4 🦊 Fox');
  // a ghost has no rank, and a rank past the count is ignored
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ grade: 'ghost', rank: null, ranked: 12 }) })), 'Pro member-1a2b3c4d acmeco 👻 유령');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ rank: 13, ranked: 12 }) })), 'Pro member-1a2b3c4d acmeco 🦊 Fox');
  // without a plan or an organization (an older team.json) the chip still renders
  assert.equal(chip({ label: 'member-1a2b3c4d', lang: 'en', standing: standing() }), 'member-1a2b3c4d 🦊 Fox');
});

test('IntelliJ (narrow) and text mode drop the animal emoji but keep the name and rank', () => {
  const team = pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) });
  // IntelliJ's terminal resolves to narrow: its font has no animal emoji.
  const { mode } = resolveLabelMode({ hasFlag: (f) => f === '--icon', env: { TERMINAL_EMULATOR: 'JetBrains-JediTerm' } });
  assert.equal(mode, 'narrow');
  for (const m of [mode, 'text']) {
    const out = formatReport({ ...base(), team }, { color: false, timer: false, mode: m, segments: ['team'] });
    assert.equal(out.trim(), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 여우', m);
    const idle = formatNoSession({ team }, { color: false, mode: m });
    assert.match(idle, /Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 여우/, m);
    assert.doesNotMatch(idle, /🦊/, m);
  }
  // Outside IntelliJ the icon line keeps the emoji, on the idle line too.
  assert.match(formatNoSession({ team }, { color: false, mode: 'icon' }), /Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 🦊 여우/);
});

test('chip sits right before the version chip', () => {
  const parts = line(pro({ lang: 'en', standing: standing() })).split(' · ');
  assert.match(parts[parts.length - 2], /member-1a2b3c4d/);
  assert.match(parts[parts.length - 1], /v3\.0\.0/);
});

test('without a standing, with a stale one, or with an unknown grade: plan, member label and organization only', () => {
  assert.equal(chip(pro({ lang: 'en', standing: null })), 'Pro member-1a2b3c4d acmeco');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ fetchedAt: Date.now() - 25 * 3600_000 }) })), 'Pro member-1a2b3c4d acmeco');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ grade: 'sphinx' }) })), 'Pro member-1a2b3c4d acmeco');
});

test('not joined: no chip', () => {
  assert.equal(chip(null), undefined);
  assert.equal(chip(undefined), undefined);
});

test('--segments team renders the chip alone', () => {
  const out = formatReport({ ...base(), team: pro({ lang: 'en', standing: standing() }) }, { color: false, timer: false, mode: 'icon', segments: ['team'] });
  assert.equal(out.trim(), 'Pro member-1a2b3c4d acmeco 🦊 Fox');
});

test('readTeamChip: joined, left and never joined; reads only and creates nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-chip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readTeamChip({ dir }), null);
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1a2b3c4d', orgName: 'acmeco', plan: 'pro', standing: { grade: 'owl', rank: 2, ranked: 7, fetchedAt: 5 } }, dir);
  const joined = readTeamChip({ dir });
  assert.equal(joined.label, 'member-1a2b3c4d');
  assert.equal(joined.org, 'acmeco');
  assert.equal(joined.plan, 'pro');
  assert.equal(joined.team, null);
  assert.deepEqual(joined.standing, { grade: 'owl', rank: 2, ranked: 7, teamRank: null, teamRanked: null, fetchedAt: 5 });
  // The team name and the rank within it come along when stored.
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1a2b3c4d', teamName: 'platform', standing: { grade: 'owl', rank: 2, ranked: 7, teamRank: 1, teamRanked: 3, fetchedAt: 5 } }, dir);
  assert.equal(readTeamChip({ dir }).team, 'platform');
  assert.deepEqual(readTeamChip({ dir }).standing, { grade: 'owl', rank: 2, ranked: 7, teamRank: 1, teamRanked: 3, fetchedAt: 5 });
  // Without an organization name the team name stands in, and no plan reads as none.
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1a2b3c4d', teamName: 'platform' }, dir);
  assert.equal(readTeamChip({ dir }).org, 'platform');
  assert.equal(readTeamChip({ dir }).plan, null);
  // No display name and no member-id file: nothing to show, and no file appears.
  saveTeamState({ memberKey: 'spk_x' }, dir);
  assert.equal(readTeamChip({ dir }), null);
  assert.deepEqual(readdirSync(dir), ['team.json']);
  writeFileSync(join(dir, 'member-id'), 'member-abcdef01\n');
  assert.equal(readTeamChip({ dir }).label, 'member-abcdef01');
  saveTeamState({ left: true, displayName: 'member-1a2b3c4d' }, dir);
  assert.equal(readTeamChip({ dir }), null);
});

test('the rank within the team rides behind the organization rank, only when the team is a strict part of it', () => {
  const inTeam = standing({ rank: 3, ranked: 12, teamRank: 1, teamRanked: 4 });
  assert.equal(chip(pro({ team: 'DEV-OPS', lang: 'ko', standing: inTeam })), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위, DEV-OPS 팀 4명 중 1위 🦊 여우');
  assert.equal(chip(pro({ team: 'DEV-OPS', lang: 'en', standing: inTeam })), 'Pro member-1a2b3c4d acmeco overall score #3 of 12, team DEV-OPS #1 of 4 🦊 Fox');
  // One team in the organization: the two ranks are the same number, said once.
  assert.equal(chip(pro({ team: 'DEV-OPS', lang: 'ko', standing: standing({ rank: 3, ranked: 12, teamRank: 3, teamRanked: 12 }) })), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 🦊 여우');
  // No team name, or an older server without the figures: the organization rank alone.
  assert.equal(chip(pro({ lang: 'ko', standing: inTeam })), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 🦊 여우');
  assert.equal(chip(pro({ team: 'DEV-OPS', lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1a2b3c4d acmeco 종합 점수 12명 중 3위 🦊 여우');
});
