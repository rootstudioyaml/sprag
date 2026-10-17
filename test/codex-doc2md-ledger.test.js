import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordCodexDocument, codexDocumentTotals, estimateCodexDocument } from '../src/codex/doc2md-ledger.js';
import { convertCodexDocument } from '../src/codex/doc2md.js';
import { resetSaved, undoReset } from '../src/saved-reset.cjs';

test('Codex document totals deduplicate sources, isolate homes, and never import shared money or paths', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-doc-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const opts = { dir, home: join(dir, 'codex') };
  writeFileSync(join(dir, 'doc2md-ledger.json'), JSON.stringify({ version: 1, events: { old: { ext: '.pdf', usd: 999 } } }));
  assert.equal(codexDocumentTotals(opts).docs, 0);
  for (const name of ['a.pdf', 'b.xlsx', 'c.xlsx']) {
    const source = join(dir, name); writeFileSync(source, 'source');
    const result = { ok: true, meta: { size: 6, markdownBytes: 3, savedUsd: 999 } };
    recordCodexDocument(source, result, opts);
    recordCodexDocument(source, result, opts);
  }
  const { savings, ...counts } = codexDocumentTotals(opts);
  assert.deepEqual(counts, { docs: 3, scope: 'codex-total', since: null, byExt: [{ ext: 'xlsx', docs: 2 }, { ext: 'pdf', docs: 1 }] });
  assert.equal(savings.priced, 0);
  assert.equal(savings.unpriced, 3);
  assert.equal(codexDocumentTotals({ ...opts, home: join(dir, 'other') }).docs, 0);
  const records = join(dir, 'codex-doc2md', readdirSync(join(dir, 'codex-doc2md'))[0]);
  for (const name of readdirSync(records)) {
    // The fingerprint (hex) and timestamp can hold any run of digits, 999 included,
    // so they are checked by shape and the text check runs on the other fields.
    const { fingerprint, at, ...rest } = JSON.parse(readFileSync(join(records, name), 'utf8'));
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(at));
    assert.doesNotMatch(JSON.stringify(rest), /999|source"|a\.pdf|b\.xlsx/);
  }
  writeFileSync(join(records, '0'.repeat(64) + '.json'), 'broken');
  assert.equal(codexDocumentTotals(opts).docs, 3);
});

test('Office savings use Codex provider input prices with an explicit XML baseline and signed differences', () => {
  const meta = { markupBytes: 4000, markdownBytes: 400 };
  const opts = { model: 'parent', provider: 'gateway', prices: { provider: 'gateway', checkedAt: 123, prices: { parent: { input: 0.00001 } } } };
  const s = estimateCodexDocument('/test.pptx', meta, opts);
  assert.equal(s.baseline, 1000);
  assert.equal(s.tokens, 100);
  assert.equal(s.savedTokens, 900);
  assert.ok(Math.abs(s.usd - 0.009) < 1e-10);
  assert.equal(s.priceSource, 'litellm');
  assert.equal(s.method, 'office-xml-vs-markdown-bytes/4');
  assert.ok(estimateCodexDocument('/test.docx', { ...meta, markdownBytes: 8000 }, opts).usd < 0);
  assert.equal(estimateCodexDocument('/test.xlsx', meta, { ...opts, prices: null }).reason, 'unpriced-model');
  assert.equal(estimateCodexDocument('/test.xlsx', meta, { ...opts, provider: 'other' }).usd, null);
  for (const ext of ['pdf', 'fig', 'xls']) assert.equal(estimateCodexDocument(`/test.${ext}`, meta, opts).reason, 'no-comparable-baseline');
  for (const flag of ['clipped', 'truncated']) assert.equal(estimateCodexDocument('/test.pptx', { ...meta, [flag]: true }, opts).usd, null);
  assert.equal(estimateCodexDocument('/test.pptx', meta, {}).reason, 'unknown-model-provider');
  assert.equal(estimateCodexDocument('/test.pptx', { ...meta, markdownBytes: undefined }, opts).usd, null);
});

test('priced documents deduplicate, preserve price snapshots, and respect reset/undo without importing legacy money', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-doc-money-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const source = join(dir, 'deck.pptx');
  writeFileSync(source, 'source');
  const opts = { dir, home: join(dir, 'codex'), model: 'parent', provider: 'gateway', now: 10000,
    prices: { provider: 'gateway', checkedAt: 10000, prices: { parent: { input: 0.00001 } } } };
  const result = { ok: true, meta: { size: 6, markupBytes: 4000, markdownBytes: 400, savedUsd: 999 } };
  recordCodexDocument(source, result, opts);
  const initial = codexDocumentTotals(opts);
  recordCodexDocument(source, result, { ...opts, prices: null, now: 11000 });
  assert.deepEqual(codexDocumentTotals(opts), initial);
  recordCodexDocument(source, result, { ...opts, model: 'other', now: 12000 });
  assert.deepEqual(codexDocumentTotals(opts), initial);
  assert.equal(initial.docs, 1);
  assert.equal(initial.savings.priced, 1);
  resetSaved(['codex-docs'], { dir, now: 13000 });
  assert.equal(codexDocumentTotals(opts).docs, 0);
  undoReset({ dir });
  assert.deepEqual(codexDocumentTotals(opts), initial);
  const records = join(dir, 'codex-doc2md', readdirSync(join(dir, 'codex-doc2md'))[0]);
  writeFileSync(join(records, '0'.repeat(64) + '.json'), JSON.stringify({ version: 1, ext: 'pdf', savedUsd: 999 }));
  const mixed = codexDocumentTotals(opts);
  assert.equal(mixed.docs, 2);
  assert.equal(mixed.savings.unpriced, 1);
  assert.equal(mixed.savings.reasons['legacy-record'], 1);
  assert.equal(mixed.savings.total, initial.savings.total);
});

test('Codex cache view strips only the generated banner and preserves document content, without modifying the shared cache', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-doc-view-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const source = join(dir, 'book.pdf'), cacheFile = join(dir, 'book.md');
  writeFileSync(source, 'source');
  const original = '<!--\nsprag doc2md generated\n$999 savings\n-->\n# Invoice\nActual price: $10\n';
  writeFileSync(cacheFile, original);
  const convert = (_source, opts) => {
    assert.equal(opts.agent, 'codex');
    return { ok: true, cached: true, cacheFile, meta: { size: 6, markdownBytes: 30, savedUsd: 999, baselineTokens: 44000 } };
  };
  const opts = { convert, dir, home: dir };
  const out = convertCodexDocument(source, opts);
  assert.notEqual(out.cacheFile, cacheFile);
  assert.equal(out.meta.savedUsd, undefined);
  assert.match(readFileSync(out.cacheFile, 'utf8'), /Actual price: \$10/);
  assert.doesNotMatch(readFileSync(out.cacheFile, 'utf8'), /999|savings/);
  assert.equal(readFileSync(cacheFile, 'utf8'), original);
  convertCodexDocument(source, opts);
  assert.equal(codexDocumentTotals(opts).docs, 1);
});
