/**
 * Sprag's requests trust the OS certificate store when Node can merge it, so a
 * corporate proxy root installed only in the Keychain or the Windows store no
 * longer breaks the update check, preset sync and team sync.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySystemCA, nodeLoadsSystemCA } from '../src/system-ca.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function fakeTls({ def = ['A'], sys = ['B'], throwOn } = {}) {
  const calls = { set: null, reads: [] };
  return {
    calls,
    getCACertificates(kind) {
      calls.reads.push(kind);
      if (throwOn === kind) throw new Error(`no ${kind} store`);
      return kind === 'system' ? sys : def;
    },
    setDefaultCACertificates(list) {
      if (throwOn === 'set') throw new Error('rejected');
      calls.set = list;
    },
  };
}

const run = (tls, env = {}, execArgv = []) => applySystemCA({ tls, env, execArgv });

test('system roots are appended after the current default list', () => {
  const tls = fakeTls({ def: ['A', 'B'], sys: ['B', 'C'] });
  assert.equal(run(tls), 'applied');
  assert.deepEqual(tls.calls.set, ['A', 'B', 'C']);
});

test('the same root with CRLF or trailing whitespace counts once', () => {
  const tls = fakeTls({ def: ['-----X-----\n'], sys: ['-----X-----\r\n', 'Y', 'Y'] });
  assert.equal(run(tls), 'applied');
  assert.deepEqual(tls.calls.set, ['-----X-----\n', 'Y']);
});

test('nothing is set when the system store adds no new root', () => {
  const tls = fakeTls({ def: ['A', 'B'], sys: ['B'] });
  assert.equal(run(tls), 'unchanged');
  assert.equal(tls.calls.set, null);
});

test('SPRAG_SYSTEM_CA=0 and the legacy CTS_ name turn it off before any read', () => {
  for (const env of [{ SPRAG_SYSTEM_CA: '0' }, { CTS_SYSTEM_CA: '0' }]) {
    const tls = fakeTls();
    assert.equal(run(tls, env), 'off');
    assert.deepEqual(tls.calls.reads, []);
  }
});

test('Node that already loaded the store is not asked again', () => {
  assert.equal(nodeLoadsSystemCA({ env: { NODE_USE_SYSTEM_CA: '1' }, execArgv: [] }), true);
  assert.equal(nodeLoadsSystemCA({ env: {}, execArgv: ['--use-system-ca'] }), true);
  assert.equal(nodeLoadsSystemCA({ env: { NODE_OPTIONS: '--max-old-space-size=4096 --use-system-ca' }, execArgv: [] }), true);
  assert.equal(nodeLoadsSystemCA({ env: { NODE_OPTIONS: '--use-system-ca-x' }, execArgv: [] }), false);
  assert.equal(nodeLoadsSystemCA({ env: { NODE_USE_SYSTEM_CA: '0' }, execArgv: [] }), false);
  const tls = fakeTls();
  assert.equal(run(tls, { NODE_USE_SYSTEM_CA: '1' }), 'native');
  assert.deepEqual(tls.calls.reads, []);
});

test('older Node without either API keeps its bundled list', () => {
  assert.equal(run({ getCACertificates: () => [] }), 'unsupported');
  assert.equal(run({ setDefaultCACertificates() {} }), 'unsupported');
});

test('a failed read or set leaves the default list alone', () => {
  for (const throwOn of ['system', 'default', 'set']) {
    const tls = fakeTls({ throwOn });
    assert.equal(run(tls), 'error');
    assert.equal(tls.calls.set, null);
  }
});

test('the running Node merges without losing the bundled roots', async (t) => {
  const tls = await import('node:tls');
  if (typeof tls.setDefaultCACertificates !== 'function') return t.skip('this Node has no setDefaultCACertificates');
  const before = tls.getCACertificates('default').length;
  const result = run(tls);
  assert.ok(['applied', 'unchanged'].includes(result), result);
  assert.ok(tls.getCACertificates('default').length >= before);
});

test('every fetch in src asks for the system store first', () => {
  const files = readdirSync(ROOT + 'src', { recursive: true }).filter((f) => /\.c?js$/.test(f));
  const withFetch = [];
  for (const file of files) {
    const src = readFileSync(join(ROOT, 'src', file), 'utf8');
    const fetches = (src.match(/\bawait fetch\(/g) || []).length;
    if (!fetches) continue;
    withFetch.push(file);
    const trusts = (src.match(/^\s+trustSystemCA\(\);$/gm) || []).length;
    assert.equal(trusts, fetches, `src/${file}: ${fetches} fetch calls, ${trusts} trustSystemCA() calls`);
  }
  assert.ok(withFetch.length >= 3, `found fetch in ${withFetch.join(', ')}`);
});
