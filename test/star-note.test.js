/**
 * The one-time star chip: shown for 24 hours once routing + doc2md savings
 * first reach $10, never again, and never when CTS_NO_NOTE=1.
 *
 * Why it needs pinning: the chip is an ask, so the failure modes are all
 * annoying ones — repeating after the window, showing below the threshold, or
 * ignoring the opt-out. State lives in first-run.json under a temp
 * XDG_CONFIG_HOME so no test touches the real user directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStarChip, STAR_URL } from '../src/star-note.js';
import { firstRunStatePath } from '../src/first-run-note.js';
import { formatReport } from '../src/formatters/statusline.js';

const HOUR = 3600 * 1000;

function isolate(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-star-'));
  const saved = { xdg: process.env.XDG_CONFIG_HOME, note: process.env.CTS_NO_NOTE };
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.CTS_NO_NOTE;
  t.after(() => {
    for (const [k, v] of [['XDG_CONFIG_HOME', saved.xdg], ['CTS_NO_NOTE', saved.note]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
}

const stored = () => (existsSync(firstRunStatePath()) ? JSON.parse(readFileSync(firstRunStatePath(), 'utf8')) : {});

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d', version: '3.59.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 0,
    ...extra,
  };
}

test('below the threshold nothing shows and nothing is recorded', (t) => {
  isolate(t);
  assert.equal(readStarChip({ now: 1_000_000, savedUsd: 9.99 }), null);
  assert.equal('star' in stored(), false);
});

test('crossing $10 shows for 24h, then never again', (t) => {
  isolate(t);
  const now = 1_700_000_000_000;
  assert.deepEqual(readStarChip({ now, savedUsd: 12 }), { usd: 12, shownAt: now });
  assert.equal(stored().star, now);
  assert.deepEqual(readStarChip({ now: now + 23 * HOUR, savedUsd: 12 }), { usd: 12, shownAt: now });
  assert.equal(readStarChip({ now: now + 25 * HOUR, savedUsd: 12 }), null);
  assert.equal(readStarChip({ now: now + 26 * HOUR, savedUsd: 500 }), null);
});

test('CTS_NO_NOTE=1 suppresses it and writes nothing', (t) => {
  isolate(t);
  process.env.CTS_NO_NOTE = '1';
  assert.equal(readStarChip({ now: 1_000_000, savedUsd: 100 }), null);
  assert.equal('star' in stored(), false);
});

test('the formatter draws the chip from data.star only', () => {
  const opts = { color: false, timer: false };
  const chip = `⭐ $12.0 saved · star ${STAR_URL}`;
  assert.equal(STAR_URL, 'github.com/rootstudioyaml/sprag');
  const withStar = formatReport(data({ star: { usd: 12, shownAt: Date.now() } }), { ...opts, mode: 'icon' });
  assert.ok(withStar.includes(chip), withStar);
  assert.ok(!formatReport(data({ star: null }), { ...opts, mode: 'icon' }).includes('⭐'));
  const only = formatReport(data({ star: { usd: 12, shownAt: Date.now() } }), { ...opts, mode: 'icon', segments: ['star'] });
  assert.equal(only, chip);
  const text = formatReport(data({ star: { usd: 12, shownAt: Date.now() } }), { ...opts, segments: ['star'] });
  assert.equal(text, `$12.0 saved · star ${STAR_URL}`);
});
