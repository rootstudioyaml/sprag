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
  releaseHighlights,
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
  // The repo's canonical name is sprag-cli; a copy installed under the
  // legacy name would report claude-token-saver here instead.
  assert.match(upgradeCommand(), /^(npm install -g|pnpm add -g|bun add -g|yarn global add) (sprag-cli|claude-token-saver)@latest$/);
});

test('the registry check always asks about the canonical package name', async (t) => {
  isolated(t);
  const { refreshUpdateState, CANONICAL_PACKAGE_NAME, INSTALLED_UNDER_LEGACY_NAME } =
    await import('../src/update-check.js');
  const prevFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    // The registry answers with a version; the releases API answers with notes.
    return String(url).includes('registry.npmjs.org')
      ? { ok: true, status: 200, json: async () => ({ version: '9.9.9' }) }
      : { ok: true, status: 200, json: async () => ({ body: '- Something new.' }) };
  };
  t.after(() => { globalThis.fetch = prevFetch; });
  const r = await refreshUpdateState('3.43.0');
  assert.equal(r.ok, true);
  assert.equal(r.latest, '9.9.9');
  assert.equal(CANONICAL_PACKAGE_NAME, 'sprag-cli');
  // A legacy copy must keep hearing about releases that only ship under the new
  // name, so the registry URL is the canonical one no matter which name is
  // installed. The second request reads what that version adds — the registry
  // carries no changelog, so the notes have to come from the repository.
  assert.deepEqual(urls, [
    'https://registry.npmjs.org/sprag-cli/latest',
    'https://api.github.com/repos/rootstudioyaml/sprag/releases/tags/v9.9.9',
  ]);
  // This repo is the canonical package, so the legacy flag is off here.
  assert.equal(INSTALLED_UNDER_LEGACY_NAME, false);
});

test('the notes request is skipped when there is no upgrade to describe', async (t) => {
  isolated(t);
  const { refreshUpdateState } = await import('../src/update-check.js');
  const prevFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ version: '3.43.0' }) };
  };
  t.after(() => { globalThis.fetch = prevFetch; });
  // Already current: nothing to sell, so nothing to fetch.
  await refreshUpdateState('3.43.0');
  assert.deepEqual(urls, ['https://registry.npmjs.org/sprag-cli/latest']);
});

test('a failed notes request still records the new version', async (t) => {
  isolated(t);
  const { refreshUpdateState, updateStatus } = await import('../src/update-check.js');
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('registry.npmjs.org')
    ? { ok: true, status: 200, json: async () => ({ version: '9.9.9' }) }
    : { ok: false, status: 404, json: async () => ({}) });
  t.after(() => { globalThis.fetch = prevFetch; });
  // Rate limits, an unreleased tag, a release written as prose: none of these
  // may cost the user the notice itself.
  const r = await refreshUpdateState('3.43.0');
  assert.equal(r.ok, true);
  assert.equal(r.latest, '9.9.9');
  const st = updateStatus('3.43.0');
  assert.equal(st.available, true, 'the upgrade is still offered');
  assert.deepEqual(st.highlights, [], 'with no notes attached');
});

test('the upgrade command targets the installed package name', () => {
  const cmd = upgradeCommand();
  assert.match(cmd, /sprag-cli@latest$/);
  assert.doesNotMatch(cmd, /uninstall/); // canonical copy: plain upgrade
});

test('release highlights keep the change and drop the reasoning after it', () => {
  // Release notes lead with what changed and then explain why, often for
  // several sentences. A one-line notice has room for the first part only, and
  // cutting at a character count lands mid-clause — which reads as a broken
  // string rather than a short one.
  const body = [
    '## Fixes',
    '',
    '- **Bash writes are checked.** The PostToolUse matcher named only Write|Edit,',
    '  so a heredoc slipped past it. Widened, and `install` migrates machines that',
    '  already had the narrow one.',
    '- `korean-lint: off` opts a file out.',
    '',
    'Some prose that is not an item at all.',
  ].join('\n');
  const out = releaseHighlights(body);
  assert.deepEqual(out, ['Bash writes are checked.', 'korean-lint: off opts a file out.']);
});

test('highlights strip the markup a terminal line cannot render', () => {
  const body = [
    '- **bold** and *italic* and `code` all read as plain text.',
    '- A [labelled link](https://example.com/very/long) keeps its label.',
  ].join('\n');
  assert.deepEqual(releaseHighlights(body), [
    'bold and italic and code all read as plain text.',
    'A labelled link keeps its label.',
  ]);
});

test('a first sentence that is itself a paragraph is cut at a word boundary', () => {
  const long = `- ${'word '.repeat(60)}end.`;
  const [item] = releaseHighlights(long);
  assert.ok(item.length <= 115, `got ${item.length} chars`);
  assert.match(item, /…$/, 'an ellipsis says it was cut');
  assert.doesNotMatch(item, /wor…$/, 'the cut lands between words, not inside one');
});

test('a release body with no list yields nothing rather than prose fragments', () => {
  // v3.42.6 was written as a paragraph. Nothing there is an item, so the notice
  // falls back to naming the version — which is still worth saying.
  const body = 'The npm page now carries the Korean README inline, behind a collapsible section.';
  assert.deepEqual(releaseHighlights(body), []);
  assert.deepEqual(releaseHighlights(''), []);
  assert.deepEqual(releaseHighlights(null), []);
});

test('at most three highlights survive, so the notice stays one screen', () => {
  const body = ['- one.', '- two.', '- three.', '- four.', '- five.'].join('\n');
  assert.deepEqual(releaseHighlights(body), ['one.', 'two.', 'three.']);
});

test('cached highlights are shown only for the version they describe', async (t) => {
  isolated(t);
  const notes = ['Bash writes are checked.'];
  writeState({ checkedAt: Date.now(), latest: '3.25.0', current: '3.24.0', highlights: notes, highlightsFor: '3.25.0' });
  assert.deepEqual(updateStatus('3.24.0').highlights, notes, 'matching version carries its notes');

  // A cache written for an earlier release must not be used to sell this one.
  writeState({ checkedAt: Date.now(), latest: '3.26.0', current: '3.24.0', highlights: notes, highlightsFor: '3.25.0' });
  assert.deepEqual(updateStatus('3.24.0').highlights, [], 'stale notes are withheld');

  writeState({ checkedAt: Date.now(), latest: '3.25.0', current: '3.24.0' });
  assert.deepEqual(updateStatus('3.24.0').highlights, [], 'no notes is an empty list, not undefined');
});
