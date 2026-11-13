// Diagnostics for models that stay 'unknown': explainUnresolved, the parser's
// model:unresolved entry, and the slimmer price:unpriced message for unknown.

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-unresolved-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const { explainUnresolved, resolveModelAlias, saveProfileMap, resetModelAliasCache } = await import('../src/model-alias.js');
const { diagPath, readDiag, _resetDiagForTest } = await import('../src/diag-log.js');
const { userDataDir } = await import('../src/paths.js');
const { parseSessionFile } = await import('../src/parser.js');
const { sessionCost } = await import('../src/claude-price.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const BASE = 'https://litellm.example.com';
const ENV = { ANTHROPIC_BASE_URL: BASE };
const DAY = 86400000;
const NOW = Date.parse('2026-11-10T00:00:00Z');
const ACCOUNT = '123456789012';
const ARN = (pid) => `converse/arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:application-inference-profile/${pid}`;
const dir = userDataDir();

function join_team() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'team.json'), JSON.stringify({ memberKey: 'spk_secret' }));
}

beforeEach(() => {
  rmSync(join(dir, 'team.json'), { force: true });
  rmSync(diagPath(dir), { force: true });
  rmSync(join(dir, 'profile-map.json'), { force: true });
  resetModelAliasCache();
  _resetDiagForTest();
});

const gateway = (over = {}) => ({
  base: BASE, fetchedAt: new Date(NOW - DAY).toISOString(), aliases: { other: 'claude-opus-5' }, skipped: [], ...over,
});

test('explainUnresolved: empty and not-learned with no gateway table', () => {
  assert.equal(explainUnresolved('', { env: ENV, now: NOW }), 'empty gw=none');
  assert.equal(explainUnresolved(ARN('abc123'), { env: ENV, now: NOW }), 'not-learned gw=none');
  assert.equal(resolveModelAlias(ARN('abc123'), { env: ENV }), 'unknown');
});

test('explainUnresolved: other reasons follow resolveModelAlias order', () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: null, learned: { noRole: {}, roleNoAlias: { role: 'haiku' } }, learnedAt: null, scannedSessions: 0 });
  assert.equal(explainUnresolved('converse/arn:aws:bedrock:x:y:something-else/', { env: {}, now: NOW }), 'no-profile-id gw=none');
  assert.equal(explainUnresolved(ARN('noRole'), { env: {}, now: NOW }), 'learned-no-role gw=none');
  assert.equal(explainUnresolved(ARN('roleNoAlias'), { env: {}, now: NOW }), 'role-no-alias gw=none');
});

test('explainUnresolved: gateway table states', () => {
  const save = (gw) => saveProfileMap({ version: 1, modelAliases: {}, gateway: gw, learned: {}, learnedAt: null, scannedSessions: 0 });
  save(gateway({ base: 'https://other.example.com' }));
  assert.equal(explainUnresolved(ARN('p1'), { env: ENV, now: NOW }), 'not-learned gw=base-mismatch');
  save(gateway({ fetchedAt: new Date(NOW - 20 * DAY).toISOString() }));
  assert.equal(explainUnresolved(ARN('p1'), { env: ENV, now: NOW }), 'not-learned gw=stale-20d');
  save(gateway());
  assert.equal(explainUnresolved(ARN('p1'), { env: ENV, now: NOW }), 'not-learned gw=no-key');
});

test('explainUnresolved: null when the model resolves', () => {
  saveProfileMap({ version: 1, modelAliases: { 'house-*': 'claude-opus-5' }, gateway: gateway({ aliases: { 'prod-large': 'claude-opus-5' } }), learned: {}, learnedAt: null, scannedSessions: 0 });
  assert.equal(explainUnresolved('claude-opus-5', { env: ENV, now: NOW }), null);
  assert.equal(explainUnresolved('house-fast', { env: ENV, now: NOW }), null);
  assert.equal(explainUnresolved('prod-large', { env: ENV, now: NOW }), null);
  assert.equal(explainUnresolved(ARN('x') .replace('application-inference-profile/x', 'foundation-model/anthropic.claude-haiku-4-5'), { env: ENV, now: NOW }), null);
});

function transcript(file, rows) {
  const lines = rows.map(([id, model, usage]) => JSON.stringify({
    type: 'assistant', sessionId: 's1', requestId: id, timestamp: '2026-11-10T00:00:00Z',
    message: { id: `m-${id}`, model, usage },
  }));
  writeFileSync(file, lines.join('\n') + '\n');
}

test('parseSessionFile logs model:unresolved with the account id masked and a bucketed count', async () => {
  join_team();
  const file = join(home, 'a.jsonl');
  const used = { input_tokens: 10, output_tokens: 5 };
  transcript(file, [
    ['r1', ARN('opaqueid'), used],
    ['r2', ARN('opaqueid'), used],
    ['r3', ARN('zerotok'), { input_tokens: 0, output_tokens: 0 }], // no tokens: not logged
    ['r4', 'claude-opus-5', used],
  ]);
  await parseSessionFile(file, { store: false });
  const entries = readDiag({ dir }).filter((e) => e.scope === 'model:unresolved');
  assert.equal(entries.length, 1);
  assert.match(entries[0].msg, /^raw=converse\/arn:aws:bedrock:ap-northeast-2:<acct>:application-inference-profile\/opaqueid why=not-learned gw=none reqs=2-9/);
  assert.ok(!entries[0].msg.includes(ACCOUNT));
});

test('parseSessionFile logs nothing when diagnostics are inactive', async () => {
  const file = join(home, 'b.jsonl');
  transcript(file, [['r1', ARN('opaqueid'), { input_tokens: 10, output_tokens: 5 }]]);
  await parseSessionFile(file, { store: false });
  assert.deepEqual(readDiag({ dir }), []);
});

test('noteUnpriced: an unknown model logs tokens bucket and caller, without a known list', () => {
  join_team();
  saveProfileMap({ version: 1, modelAliases: {}, gateway: gateway({ aliases: {}, prices: { 'claude-opus-5': { input: 1e-6, output: 2e-6 } } }), learned: {}, learnedAt: null, scannedSessions: 0 });
  const totals = { input: 600, cacheCreation: 300, cacheRead: 200, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
  assert.equal(sessionCost(totals, 'unknown', { env: ENV, now: NOW, at: NOW }), null);
  const entries = readDiag({ dir }).filter((e) => e.scope === 'price:unpriced');
  assert.equal(entries.length, 1);
  assert.match(entries[0].msg, /^model=unknown tokens=<100k via=(\?|src\/\S+:\d+)/);
  assert.ok(!entries[0].msg.includes('known='));
  assert.ok(!entries[0].msg.includes('reason='));
});
