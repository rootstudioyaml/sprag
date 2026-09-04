/**
 * Update notification: a cached answer the render path reads, a version chip
 * that changes weight when there is something to do, and a dismissal that
 * survives until the next release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isNewer,
  updateStatus,
  dismissUpdate,
  updateStatePath,
  upgradeCommand,
  maybeSpawnUpdateCheck,
} from '../src/update-check.js';
import { formatReport, formatNoSession } from '../src/formatters/statusline.js';

function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-update-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeState(state) {
  const p = updateStatePath();
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(state));
}

function baseData(overrides = {}) {
  return {
    summary: { hitRate: 0.97 },
    ttl: { total: 10, pct1h: 1 },
    cost: { savings: 12 },
    options: { days: 1, windowLabel: '1d', version: '3.24.0' },
    lastActivity: Date.now(),
    contextWindow: null,
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    ...overrides,
  };
}

test('version comparison ranks releases and keeps pre-releases behind', () => {
  assert.equal(isNewer('3.25.0', '3.24.0'), true);
  assert.equal(isNewer('3.24.1', '3.24.0'), true);
  assert.equal(isNewer('4.0.0', '3.99.99'), true);
  assert.equal(isNewer('3.24.0', '3.24.0'), false);
  assert.equal(isNewer('3.23.9', '3.24.0'), false);
  // Never nudge anyone onto a pre-release of a version they already have.
  assert.equal(isNewer('3.25.0-beta.1', '3.25.0'), false);
  assert.equal(isNewer('3.25.0', '3.25.0-beta.1'), true);
  // Garbage in the cache file must read as "nothing to do", not as an update.
  assert.equal(isNewer('not-a-version', '3.24.0'), false);
});

test('no cache file means no update chip and no crash', async (t) => {
  isolated(t);
  const s = updateStatus('3.24.0');
  assert.equal(s.available, false);
  assert.equal(s.latest, null);
  assert.equal(s.stale, true); // never checked → due for a background check
});

test('a newer cached version surfaces as available', async (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.25.0' });
  const s = updateStatus('3.24.0');
  assert.equal(s.available, true);
  assert.equal(s.latest, '3.25.0');
  assert.equal(s.stale, false);
});

test('dismissing silences the session-start offer for that version only', async (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.25.0' });
  dismissUpdate('3.25.0');
  const dismissed = updateStatus('3.24.0');
  assert.equal(dismissed.available, true, 'the chip keeps showing — only the question is muted');
  assert.equal(dismissed.dismissed, true);

  // A later release must ask again: "no" applied to 3.25.0, not to upgrading.
  writeState({ ...JSON.parse(readFileSync(updateStatePath(), 'utf8')), latest: '3.26.0' });
  const next = updateStatus('3.24.0');
  assert.equal(next.dismissed, false);
});

test('env opt-out disables the check entirely', async (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.25.0' });
  process.env.CTS_NO_UPDATE_CHECK = '1';
  t.after(() => { delete process.env.CTS_NO_UPDATE_CHECK; });
  const s = updateStatus('3.24.0');
  assert.equal(s.available, false);
  assert.equal(maybeSpawnUpdateCheck('3.24.0'), false, 'no background process either');
});

test('a stale cache is stamped before the child spawns, so an offline machine backs off', async (t) => {
  isolated(t);
  writeState({ checkedAt: 1, latest: '3.24.0' }); // ancient
  assert.equal(updateStatus('3.24.0').stale, true);
  maybeSpawnUpdateCheck('3.24.0');
  assert.equal(updateStatus('3.24.0').stale, false, 'the attempt itself refreshes the timestamp');
});

test('statusline shows the plain version when up to date, at the tail', async (t) => {
  isolated(t);
  const out = formatReport(baseData({ update: { available: false, latest: '3.24.0' } }), {
    color: false, mode: 'icon',
  });
  assert.match(out, /v3\.24\.0/);
  assert.ok(out.indexOf('v3.24.0') > out.indexOf('%'), 'identity context belongs at the tail');
  assert.ok(!out.includes('⬆'));
});

test('an available update leads with ⬆ and names both versions', async (t) => {
  isolated(t);
  const out = formatReport(baseData({ update: { available: true, latest: '3.25.0' } }), {
    color: false, mode: 'icon', verbose: true,
  });
  assert.match(out, /⬆ Update v3\.24\.0 → 3\.25\.0/);
  assert.ok(out.indexOf('⬆') < out.indexOf('Cache hit'), 'actionable chips lead');
});

test('the version segment honors the --segments whitelist', async (t) => {
  isolated(t);
  const out = formatReport(baseData({ update: { available: true, latest: '3.25.0' } }), {
    color: false, mode: 'icon', segments: ['hit'],
  });
  assert.ok(!out.includes('3.25.0'));
});

test('the no-session line still carries the version and the upgrade nudge', async (t) => {
  isolated(t);
  const plain = formatNoSession({ version: '3.24.0', update: { available: false } }, { color: false });
  assert.match(plain, /v3\.24\.0/);
  const nudge = formatNoSession(
    { version: '3.24.0', update: { available: true, latest: '3.25.0' } },
    { color: false },
  );
  assert.match(nudge, /⬆ v3\.24\.0 → 3\.25\.0/);
  assert.ok(nudge.indexOf('⬆') < nudge.indexOf('no session data'));
});

test('the upgrade command matches how the copy was installed', () => {
  // Default install path (npm global) — the fallback every other manager
  // falls back to when the install root says nothing.
  assert.match(upgradeCommand(), /^(npm install -g|pnpm add -g|bun add -g|yarn global add) claude-token-saver@latest$/);
});
