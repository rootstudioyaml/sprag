import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordCodexDocument, codexDocumentTotals } from '../src/codex-doc2md-ledger.js';
import { convertCodexDocument } from '../src/codex-doc2md.js';

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
  assert.deepEqual(codexDocumentTotals(opts), { docs: 3, scope: 'codex-total', byExt: [{ ext: 'xlsx', docs: 2 }, { ext: 'pdf', docs: 1 }] });
  assert.equal(codexDocumentTotals({ ...opts, home: join(dir, 'other') }).docs, 0);
  const records = join(dir, 'codex-doc2md', readdirSync(join(dir, 'codex-doc2md'))[0]);
  for (const name of readdirSync(records)) assert.doesNotMatch(readFileSync(join(records, name), 'utf8'), /999|usd|source"|a.pdf|b.xlsx/);
  writeFileSync(join(records, '0'.repeat(64) + '.json'), 'broken');
  assert.equal(codexDocumentTotals(opts).docs, 3);
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
