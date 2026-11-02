/**
 * Monthly reset offer: at every fresh session until answered, only when the
 * saved counters were not reset since the 1st and there is something to reset.
 * A reset (yes) or `sprag saved keep` (no) is the answer. HOME and
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

const { monthlyResetOffer, monthlyResetStatePath, offersOnSessionSource, declineMonthlyReset } = await import('../src/monthly-reset-offer.js');
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
  assert.match(out, /^✇ \[sprag monthly-reset\]/);
  assert.match(out, /routing saved \$3\.00, Doc2md saved \$1\.00/);
  assert.match(out, /sprag saved reset all/);
});

test('an unanswered offer comes back at the next session, and printing writes no state', () => {
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
  assert.equal(existsSync(monthlyResetStatePath(DIR)), false);
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW + DAY }));
});

test('a decline silences the rest of the month', () => {
  assert.equal(declineMonthlyReset({ dir: DIR, now: NOW }), '2026-10');
  const state = JSON.parse(readFileSync(monthlyResetStatePath(DIR), 'utf8'));
  assert.deepEqual(state, { version: 2, month: '2026-10', declinedAt: NOW });
  assert.equal(monthlyResetOffer({ dir: DIR, now: NOW + DAY }), null);
});

test('a reset is the yes answer and silences the offer', () => {
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
  resetSaved(['routing', 'doc2md'], { dir: DIR, now: NOW + 1000 });
  assert.equal(monthlyResetOffer({ dir: DIR, now: NOW + DAY }), null);
});

test('offers again in the month after a decline', () => {
  declineMonthlyReset({ dir: DIR, now: NOW });
  const next = monthlyResetOffer({ dir: DIR, now: NEXT_MONTH, lang: 'en' });
  assert.ok(next);
  assert.match(next, /since November 1/);
});

test('a v1 state file (offeredAt only) is not an answer', () => {
  // v3.91 to v3.93 wrote this the moment the offer printed, answered or not.
  writeFileSync(monthlyResetStatePath(DIR), JSON.stringify({ version: 1, month: '2026-10', offeredAt: NOW - DAY }));
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
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
  assert.match(ko, /^✇ \[sprag monthly-reset\] 10월 1일 이후 절감 집계를 초기화한 적이 없습니다\./);
  assert.match(ko, /라우팅 절감 \$3\.00, Doc2md 절감 \$1\.00\./);
  assert.match(ko, /`sprag saved undo` 로 되돌릴 수 있습니다/);
  assert.match(ko, /새 세션을 열 때마다 이 안내가 다시 나옵니다/);
  assert.match(ko, /^  sprag saved keep$/m);
  const en = monthlyResetOffer({ dir: DIR, now: NOW, lang: 'en' });
  assert.match(en, /not been reset since October 1\./);
  assert.match(en, /Tell the user this and ask whether to reset/);
  assert.match(en, /comes back at every new session/);
  assert.match(en, /^  sprag saved keep$/m);
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

test('never throws: an unreadable state location still offers', () => {
  // A directory where the state file should be makes the read fail.
  mkdirSync(monthlyResetStatePath(DIR), { recursive: true });
  assert.doesNotThrow(() => monthlyResetOffer({ dir: DIR, now: NOW }));
  assert.ok(monthlyResetOffer({ dir: DIR, now: NOW }));
  rmSync(monthlyResetStatePath(DIR), { recursive: true, force: true });
});

test('the offer rides a fresh session start only', () => {
  // SessionStart also fires on resume, clear and compact; asking right after an
  // auto-compact would interrupt work in progress.
  assert.equal(offersOnSessionSource('startup', 'cli'), true);
  assert.equal(offersOnSessionSource(undefined, 'cli'), true);
  assert.equal(offersOnSessionSource('startup', null), true);
  assert.equal(offersOnSessionSource('startup', 'claude-vscode'), true);
  for (const source of ['resume', 'clear', 'compact']) assert.equal(offersOnSessionSource(source, 'cli'), false, source);
});

test('SDK sessions never get the offer: unattended batch jobs would get it at every run', () => {
  for (const entrypoint of ['sdk-cli', 'sdk-ts', 'sdk-py']) {
    assert.equal(offersOnSessionSource('startup', entrypoint), false, entrypoint);
    assert.equal(offersOnSessionSource(undefined, entrypoint), false, entrypoint);
  }
});
