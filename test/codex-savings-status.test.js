import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexDelegationStatus, recordCodexDelegation, bindCodexSubagent, closeStaleCodexRoutes } from '../src/codex/ledger.js';
import { codexDelegationDiagnostics } from '../src/codex/delegation-diagnostics.js';
import { codexDocumentContext, convertCodexDocument } from '../src/codex/doc2md.js';
import { codexDocumentTotals } from '../src/codex/doc2md-ledger.js';
import { formatCodexPanel, panelCellWidth } from '../src/codex/panel.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-saving-status-'));
  const home = join(dir, 'home'); mkdirSync(home);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, home };
}

test('delegation status counts alternative tiers as one offer and separates pending, bound and settled', (t) => {
  const f = fixture(t), now = Date.now();
  const a = 'aaaaaaaaaaaaaaaa', b = 'bbbbbbbbbbbbbbbb';
  for (const [id, to] of [[a, 'small'], [b, 'medium']]) recordCodexDelegation({ id, to, offerId: 'one', via: 'prompt', at: now - 1000, parentSessionId: 'p' }, f);
  assert.deepEqual(codexDelegationStatus({ ...f, sessionId: 'p', now }), { offers: 1, bound: 0, settled: 0, pending: 1, unclaimed: 0 });
  assert.equal(codexDelegationStatus({ ...f, sessionId: 'other', now }).offers, 0);
  assert.equal(bindCodexSubagent({ session_id: 'p', agent_id: 'child', model: 'medium' }, { ...f, now }), b);
  assert.equal(codexDelegationStatus({ ...f, sessionId: 'p', now }).bound, 1);
  closeStaleCodexRoutes({ session_id: 'p' }, { ...f, now });
  writeFileSync(join(f.dir, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: { [b]: { complete: true } } }));
  assert.equal(codexDelegationStatus({ ...f, now }).settled, 1);
  recordCodexDelegation({ id: 'cccccccccccccccc', to: 'small', via: 'prompt', parentSessionId: 'p', at: now - 31 * 60000 }, f);
  assert.equal(codexDelegationStatus({ ...f, now }).unclaimed, 1);
});

test('delegation diagnostics inspect only local commands and never claim tools are available', (t) => {
  const f = fixture(t), calls = [];
  writeFileSync(join(f.home, 'config.toml'), '[agents]\nenabled = false\n');
  const report = codexDelegationDiagnostics({ ...f, model: 'parent', exec: (_bin, args) => {
    calls.push(args.join(' '));
    if (args[0] === '--version') return 'codex-cli test';
    if (args[0] === 'features') return 'multi_agent stable true\nmulti_agent_v2 stable false\n';
    return JSON.stringify({ models: [{ slug: 'parent', multi_agent_version: 'v2', secret: 'never-print' }] });
  } });
  assert.deepEqual(calls, ['--version', 'features list', 'debug models --bundled']);
  assert.equal(report.configuredDisabled, true);
  assert.match(report.tools, /unverified/);
  assert.ok(report.warnings.some((x) => /compatibility clue/.test(x)));
  assert.doesNotMatch(JSON.stringify(report), /never-print/);
});

test('document hooks use current rollout identity and conversion records Codex prices, never default config', (t) => {
  const f = fixture(t), transcript = join(f.dir, 'rollout.jsonl');
  writeFileSync(transcript, [
    { type: 'session_meta', payload: { id: 'p', model_provider: 'gateway' } },
    { type: 'turn_context', payload: { model: 'parent' } },
  ].map(JSON.stringify).join('\n'));
  const identity = codexDocumentContext({ session_id: 'p', transcript_path: transcript });
  assert.deepEqual(identity, { model: 'parent', provider: 'gateway' });
  assert.deepEqual(codexDocumentContext({ session_id: 'other', transcript_path: transcript }), {});
  const source = join(f.dir, 'deck.pptx'), cacheFile = join(f.dir, 'deck.md');
  writeFileSync(source, 'source'); writeFileSync(cacheFile, '# Title\n');
  const result = convertCodexDocument(source, { ...f, ...identity,
    prices: { provider: 'gateway', checkedAt: Date.now(), prices: { parent: { input: 0.00001 } } },
    convert: () => ({ ok: true, cacheFile, meta: { size: 6, markupBytes: 4000, markdownBytes: 8, savedUsd: 999 } }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.meta.codexSaving.usd > 0);
  assert.equal(result.meta.codexSaving.model, 'parent');
  assert.equal(result.meta.savedUsd, undefined);
  assert.equal(codexDocumentTotals(f).savings.priced, 1);
});

test('both savings remain before preferences, with explicit unknowns and bounded wrapping', () => {
  for (const columns of [40, 100, 250]) {
    const text = formatCodexPanel({ root: '/p', labelMode: 'text', delegate: true,
      documents: { docs: 2, scope: 'codex-total', byExt: [], savings: { priced: 1, total: 1.2, unpriced: 1 } },
      routingSaved: { runs: 0, priced: 0, pricesAvailable: true }, delegation: { offers: 2, pending: 1, unclaimed: 1, settled: 0, bound: 0 },
    }, { columns, rows: 100, compact: true, color: false });
    assert.match(text, /Doc2md saved/);
    assert.match(text, /Routing saved/);
    assert.ok(text.indexOf('Routing saved') < text.indexOf('Harness'));
    assert.match(text, /unclaimed/);
    assert.ok(text.split('\n').every((line) => panelCellWidth(line) <= columns));
  }
});
