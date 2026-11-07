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
// The single-line layout keeps the chip; the multi-line layout gives the team a line of its own.
const single = (team, opts = {}) => formatReport({ ...base(), team }, { color: false, timer: false, mode: 'icon', singleLine: true, ...opts });
const chip = (team) => single(team).split(' · ').find((p) => p.includes('member-'));
const multi = (team, opts = {}) => formatReport({ ...base(), team }, { color: false, timer: false, mode: 'icon', ...opts }).split('\n');
const standing = (extra = {}) => ({ grade: 'fox', fetchedAt: Date.now() - 60_000, ...extra });
// A joined Pro machine in the amazon organization, team AWS-FSI: the common case.
const pro = (extra = {}) => ({ label: 'member-1e500474', org: 'amazon', team: 'AWS-FSI', plan: 'pro', ...extra });

test('chip (single-line layout): plan, member label, organization, rank, emoji and name (ko and en)', () => {
  assert.equal(chip(pro({ lang: 'ko', standing: standing() })), 'Pro member-1e500474 amazon 🦊 여우');
  assert.equal(chip(pro({ lang: 'en', standing: standing() })), 'Pro member-1e500474 amazon 🦊 Fox');
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위 🦊 여우');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1e500474 amazon overall score #3 of 12 🦊 Fox');
  // The plan leads whatever it is called; an Enterprise team says so.
  assert.equal(chip(pro({ plan: 'enterprise', lang: 'en', standing: standing({ rank: 1, ranked: 4 }) })), 'Enterprise member-1e500474 amazon overall score #1 of 4 🦊 Fox');
  // a ghost has no rank, and a rank past the count is ignored
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ grade: 'ghost', rank: null, ranked: 12 }) })), 'Pro member-1e500474 amazon 👻 유령');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ rank: 13, ranked: 12 }) })), 'Pro member-1e500474 amazon 🦊 Fox');
  // without a plan or an organization (an older team.json) the chip still renders
  assert.equal(chip({ label: 'member-1e500474', lang: 'en', standing: standing() }), 'member-1e500474 🦊 Fox');
});

test('chip: the rank within the team rides behind the organization rank, only when the team is a strict part of it', () => {
  const inTeam = standing({ rank: 3, ranked: 12, teamRank: 1, teamRanked: 4 });
  assert.equal(chip(pro({ lang: 'ko', standing: inTeam })), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위, AWS-FSI 팀 4명 중 1위 🦊 여우');
  assert.equal(chip(pro({ lang: 'en', standing: inTeam })), 'Pro member-1e500474 amazon overall score #3 of 12, team AWS-FSI #1 of 4 🦊 Fox');
  // One team in the organization: the two ranks are the same number, said once.
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12, teamRank: 3, teamRanked: 12 }) })), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위 🦊 여우');
  // No team name, or an older server without the figures: the organization rank alone.
  assert.equal(chip(pro({ team: null, lang: 'ko', standing: inTeam })), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위 🦊 여우');
  assert.equal(chip(pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) })), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위 🦊 여우');
});

test('multi-line layout: the team gets a line of its own, last of the headlines, and the chip steps aside', () => {
  const team = pro({ lang: 'ko', standing: standing({ rank: 4, ranked: 13, teamRank: 1, teamRanked: 4 }) });
  const lines = multi(team);
  // No figures from the server: the percentile and the people to pass are read off the rank.
  assert.equal(lines[0], '👥 Pro · amazon · AWS-FSI · member-1e500474  |  종합 점수 13명 중 4위, 팀 4명 중 1위 🦊 여우 · 1위까지 3명 · 지금 75%, 2%p 더 오르면 🐆 치타 (1명 앞지르기)');
  assert.doesNotMatch(lines[lines.length - 1], /member-/, 'the chip line no longer carries the team');
  assert.doesNotMatch(lines[lines.length - 1], /· {2}·|· $|^ ·/, 'and leaves no empty slot behind');
  // With the server's distance to the next species, and in English.
  const next = pro({ lang: 'en', standing: standing({ rank: 3, ranked: 12, teamRank: 1, teamRanked: 4, scorePct: 0.75, next: { grade: 'cheetah', pass: 2, needDlg: false } }) });
  assert.equal(multi(next)[0], '👥 Pro · amazon · AWS-FSI · member-1e500474  |  overall score #3 of 12, team #1 of 4 🦊 Fox · 2 to pass for #1 · now 75%, 2 pts more for 🐆 Cheetah (pass 2)');
  // The crown (a cheetah at 100%: only the delegation rule separates it from the wolf), someone alone, and a ghost.
  assert.match(multi(pro({ lang: 'ko', standing: standing({ grade: 'cheetah', rank: 1, ranked: 12, crown: true }) }))[0], /종합 점수 12명 중 1위 🐆 치타 · 👑 회사 1위 · 지금 100%, 위임 비율 회사 중앙값 이상이면 🐺 늑대$/);
  assert.match(multi(pro({ lang: 'ko', standing: standing({ grade: 'cat', rank: 1, ranked: 1 }) }))[0], /member-1e500474  \|  종합 점수 1명 중 1위 🐱 고양이 · 지금 50%, 혼자라 고정 · 동료가 참여하면 순위 시작$/);
  assert.match(multi(pro({ lang: 'ko', standing: standing({ grade: 'ghost', rank: null, ranked: 12 }) }))[0], /member-1e500474  \|  👻 유령 · 이 기간 업로드 없음$/);
  // No standing yet: the identity alone, still on its own line.
  assert.equal(multi(pro({ lang: 'ko', standing: null }))[0], '👥 Pro · amazon · AWS-FSI · member-1e500474');
  // Text mode: no glyph, no emoji.
  assert.equal(multi(team, { mode: 'text' })[0], 'Pro · amazon · AWS-FSI · member-1e500474  |  종합 점수 13명 중 4위, 팀 4명 중 1위 여우 · 1위까지 3명 · 지금 75%, 2%p 더 오르면 치타 (1명 앞지르기)');
  // It sits after the savings lines when there are any.
  const totals = { week: 0, month: 0, total: 3.2, spent: 0, spentMissing: 0, pairs: [], since: null };
  const withSavings = formatReport({ ...base(), delegationSaved: 3.2, delegationTotals: totals, team }, { color: false, timer: false, mode: 'icon' }).split('\n');
  assert.match(withSavings[0], /^🔀 Routing saved/);
  assert.match(withSavings[1], /^👥 Pro · amazon/);
  // `--segments` without team draws neither the line nor the chip.
  assert.doesNotMatch(formatReport({ ...base(), team }, { color: false, timer: false, mode: 'icon', segments: ['saved'] }), /member-/);
});

test('IntelliJ (narrow) and text mode drop the animal emoji but keep the name and rank', () => {
  const team = pro({ lang: 'ko', standing: standing({ rank: 3, ranked: 12 }) });
  // IntelliJ's terminal resolves to narrow: its font has no animal emoji.
  const { mode } = resolveLabelMode({ hasFlag: (f) => f === '--icon', env: { TERMINAL_EMULATOR: 'JetBrains-JediTerm' } });
  assert.equal(mode, 'narrow');
  for (const m of [mode, 'text']) {
    const out = formatReport({ ...base(), team }, { color: false, timer: false, mode: m, segments: ['team'], singleLine: true });
    assert.equal(out.trim(), 'Pro member-1e500474 amazon 종합 점수 12명 중 3위 여우', m);
    const idle = formatNoSession({ team }, { color: false, mode: m });
    assert.match(idle, /Pro member-1e500474 amazon 종합 점수 12명 중 3위 여우/, m);
    assert.doesNotMatch(idle, /🦊/, m);
  }
  // Outside IntelliJ the icon line keeps the emoji, on the idle line too.
  assert.match(formatNoSession({ team }, { color: false, mode: 'icon' }), /Pro member-1e500474 amazon 종합 점수 12명 중 3위 🦊 여우/);
});

test('chip sits right before the version chip', () => {
  const parts = single(pro({ lang: 'en', standing: standing() })).split(' · ');
  assert.match(parts[parts.length - 2], /member-1e500474/);
  assert.match(parts[parts.length - 1], /v3\.0\.0/);
});

test('without a standing, with a stale one, or with an unknown grade: plan, member label and organization only', () => {
  assert.equal(chip(pro({ lang: 'en', standing: null })), 'Pro member-1e500474 amazon');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ fetchedAt: Date.now() - 25 * 3600_000 }) })), 'Pro member-1e500474 amazon');
  assert.equal(chip(pro({ lang: 'en', standing: standing({ grade: 'sphinx' }) })), 'Pro member-1e500474 amazon');
});

test('not joined: no chip and no line', () => {
  assert.equal(chip(null), undefined);
  assert.equal(chip(undefined), undefined);
  assert.doesNotMatch(formatReport({ ...base(), team: null }, { color: false, timer: false, mode: 'icon' }), /👥|member-/);
});

test('--segments team renders the chip alone on the single-line layout', () => {
  const out = formatReport({ ...base(), team: pro({ lang: 'en', standing: standing() }) }, { color: false, timer: false, mode: 'icon', segments: ['team'], singleLine: true });
  assert.equal(out.trim(), 'Pro member-1e500474 amazon 🦊 Fox');
});

test('readTeamChip: joined, left and never joined; reads only and creates nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-chip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readTeamChip({ dir }), null);
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1e500474', orgName: 'amazon', plan: 'pro', standing: { grade: 'owl', rank: 2, ranked: 7, fetchedAt: 5 } }, dir);
  const joined = readTeamChip({ dir });
  assert.equal(joined.label, 'member-1e500474');
  assert.equal(joined.org, 'amazon');
  assert.equal(joined.plan, 'pro');
  assert.equal(joined.team, null);
  assert.deepEqual(joined.standing, { grade: 'owl', rank: 2, ranked: 7, teamRank: null, teamRanked: null, crown: false, next: null, idle: null, medianDlg: null, fetchedAt: 5 });
  // The team name, the rank within it and the feedback fields come along when stored.
  saveTeamState({ memberKey: 'spk_x', displayName: 'member-1e500474', teamName: 'platform', standing: { grade: 'owl', rank: 2, ranked: 7, teamRank: 1, teamRanked: 3, crown: false, next: { grade: 'husky', pass: 1, needDlg: false }, idle: false, medianDlg: 0.28, fetchedAt: 5 } }, dir);
  assert.equal(readTeamChip({ dir }).team, 'platform');
  assert.deepEqual(readTeamChip({ dir }).standing, { grade: 'owl', rank: 2, ranked: 7, teamRank: 1, teamRanked: 3, crown: false, next: { grade: 'husky', pass: 1, needDlg: false }, idle: false, medianDlg: 0.28, fetchedAt: 5 });
  // No display name and no member-id file: nothing to show, and no file appears.
  saveTeamState({ memberKey: 'spk_x' }, dir);
  assert.equal(readTeamChip({ dir }), null);
  assert.deepEqual(readdirSync(dir), ['team.json']);
  writeFileSync(join(dir, 'member-id'), 'member-abcdef01\n');
  assert.equal(readTeamChip({ dir }).label, 'member-abcdef01');
  saveTeamState({ left: true, displayName: 'member-1e500474' }, dir);
  assert.equal(readTeamChip({ dir }), null);
});
