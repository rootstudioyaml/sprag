/**
 * Monthly reset offer: once per calendar month, only when the saved counters
 * were not reset since the 1st and there is something to reset. HOME and
 * XDG_CONFIG_HOME point into a temp directory before any path is resolved (the
 * ledgers are read from the resolved user data dir), so real data is untouched.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-monthly-reset-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });

const { monthlyResetOffer, monthlyResetStatePath, offersOnSessionSource } = await import('../src/monthly-reset-offer.js');
const { resetSaved, resetPath } = await import('../src/saved-reset.cjs');

const DAY = 86400000;
// Mid-month local noon, so "the 1st" and "last month" are unambiguous.
const NOW = new Date(2026, 9, 15, 12).getTime();
const MONTH_START = new Date(2026, 9, 1).getTime();
const NEXT_MONTH = new Date(2026, 10, 3, 12).getTime();

function seedLedgers({ routing = 3, doc = 1 } = {}) {
  writeFileSync(join(DIR, 'delegation-ledger.json'), JSON.stringify({ version: 2, events: routing
    ? { 'a/subagents/r1': { ts: NOW - 5 * DAY, usd: routing, from: 'claude-opus-5', to: 'claude-haiku-5' } }
    : {} }));
  writeFileSync(join(DIR, 'doc2md-ledger.json'), JSON.stringify({ version: 1, events: doc
    ? { 'x.pdf': { ts: NOW - 5 * DAY, usd: doc, ext: '.pdf', tokens: 10, baseline: 20 } }
    : {} }));
}

beforeEach(() => {
  rmSync(resetPath(DIR), { force: true });
  rmSync(monthlyResetStatePath(DIR), { force: true });
  seedLedgers();
});

test('offers when the ledgers have savings and no mark falls this month', () => {
  const out = monthlyResetOffer({ dir: DIR, now: NOW, lang: 'en' });
  assert.ok(out);
  assert.match(out, /^\[sprag monthly-reset\]/);
  assert.match(out, /routing saved \$3\.00, Doc2md saved \$1\.00/);
  assert.match(out, /sprag saved reset all/);
});

test('the offer is made once a month: state is written and the second call is null', () => {
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
  const state = JSON.parse(readFileSync(monthlyResetStatePath(DIR), 'utf8'));
  assert.deepEqual(state, { version: 1, month: '2026-10', offeredAt: NOW });
  assert.equal(monthlyResetOffer({ dir: DIR, now: NOW + DAY }), null);
});

test('offers again in the next month', () => {
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
  const next = monthlyResetOffer({ dir: DIR, now: NEXT_MONTH, lang: 'en' });
  assert.ok(next);
  assert.match(next, /since November 1/);
  assert.equal(JSON.parse(readFileSync(monthlyResetStatePath(DIR), 'utf8')).month, '2026-11');
});

test('null, and no state, when the routing counter was reset on or after the 1st', () => {
  resetSaved(['routing'], { dir: DIR, now: MONTH_START });
  assert.equal(monthlyResetOffer({ dir: DIR, now: NOW }), null);
  assert.equal(existsSync(monthlyResetStatePath(DIR)), false);
});

test('a mark from an earlier month still gets the offer', () => {
  resetSaved(['routing'], { dir: DIR, now: MONTH_START - 10 * DAY });
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
});

test('null, and no state, when both totals are zero', () => {
  seedLedgers({ routing: 0, doc: 0 });
  assert.equal(monthlyResetOffer({ dir: DIR, now: NOW }), null);
  assert.equal(existsSync(monthlyResetStatePath(DIR)), false);
});

test('Korean and English wording', () => {
  const ko = monthlyResetOffer({ dir: DIR, now: NOW, lang: 'ko' });
  assert.match(ko, /^\[sprag monthly-reset\] 10월 1일 이후 절감 집계를 초기화한 적이 없습니다\./);
  assert.match(ko, /라우팅 절감 \$3\.00, Doc2md 절감 \$1\.00\./);
  assert.match(ko, /`sprag saved undo` 로 되돌릴 수 있습니다/);
  assert.match(ko, /이번 달에는 다시 묻지 않습니다/);
  rmSync(monthlyResetStatePath(DIR), { force: true });
  const en = monthlyResetOffer({ dir: DIR, now: NOW, lang: 'en' });
  assert.match(en, /not been reset since October 1\./);
  assert.match(en, /Tell the user this and ask whether to reset/);
  assert.doesNotMatch(en, /[가-힣]/);
});

test('sinceText names the mark when there is one, install otherwise', () => {
  assert.match(monthlyResetOffer({ dir: DIR, now: NOW, lang: 'ko' }), /값은 설치 이후 누적입니다/);
  rmSync(monthlyResetStatePath(DIR), { force: true });
  assert.match(monthlyResetOffer({ dir: DIR, now: NOW, lang: 'en' }), /cumulative since install:/);
  rmSync(monthlyResetStatePath(DIR), { force: true });

  const mark = new Date(2026, 8, 9, 10).getTime();
  resetSaved(['routing'], { dir: DIR, now: mark });
  // The mark is in September, so the counters still span a month boundary.
  assert.match(monthlyResetOffer({ dir: DIR, now: NOW, lang: 'ko' }), /값은 9\/9부터 누적입니다/);
  rmSync(monthlyResetStatePath(DIR), { force: true });
  assert.match(monthlyResetOffer({ dir: DIR, now: NOW, lang: 'en' }), /cumulative since 9\/9:/);
});

test('never throws: an unwritable state location yields null', () => {
  // A directory where the state file should be makes the write fail.
  mkdirSync(monthlyResetStatePath(DIR), { recursive: true });
  assert.doesNotThrow(() => monthlyResetOffer({ dir: DIR, now: NOW }));
  rmSync(monthlyResetStatePath(DIR), { recursive: true, force: true });
});

test('the offer rides a fresh session start only', () => {
  // SessionStart also fires on resume, clear and compact; asking right after an
  // auto-compact would interrupt work and spend the month's one ask.
  assert.equal(offersOnSessionSource('startup'), true);
  assert.equal(offersOnSessionSource(undefined), true);
  for (const source of ['resume', 'clear', 'compact']) assert.equal(offersOnSessionSource(source), false, source);
});
