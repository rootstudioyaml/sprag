import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const home = mkdtempSync(join(tmpdir(), 'cts-state-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');

const { writeStateFile, corruptCopyPath } = await import('../src/state-file.js');
const rules = await import('../src/model-rules.js');
const ledger = await import('../src/savings-ledger.js');
const seed = await import('../src/seed-rules.js');
const config = await import('../src/config.js');

after(() => rmSync(home, { recursive: true, force: true }));

test('a state file is replaced whole, and no temp file is left beside it', () => {
  const dir = join(home, 'plain', 'nested');
  const file = join(dir, 'state.json');
  writeStateFile(file, '{"a":1}\n');
  writeStateFile(file, '{"a":2}\n');
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}\n');
  assert.deepEqual(readdirSync(dir), ['state.json']);
});

test('a file that does not parse is copied aside once before it is replaced', () => {
  const dir = join(home, 'broken');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');
  writeFileSync(file, '{"events":{"run-1":{"usd":41.5'); // cut off mid-write
  writeStateFile(file, '{"events":{}}\n');
  assert.equal(readFileSync(corruptCopyPath(file), 'utf8'), '{"events":{"run-1":{"usd":41.5');
  assert.equal(readFileSync(file, 'utf8'), '{"events":{}}\n');

  // A later corruption does not take the slot: the first copy is the one with history in it.
  writeFileSync(file, 'garbage');
  writeStateFile(file, '{}\n');
  assert.equal(readFileSync(corruptCopyPath(file), 'utf8'), '{"events":{"run-1":{"usd":41.5');

  // Empty and valid files are nothing to keep.
  const clean = join(dir, 'clean.json');
  writeFileSync(clean, '');
  writeStateFile(clean, '{}\n');
  writeStateFile(clean, '{"b":1}\n');
  assert.equal(existsSync(corruptCopyPath(clean)), false);
});

test('every owned state file keeps its unreadable predecessor', () => {
  const dataDir = join(home, 'config', 'claude-token-saver');
  mkdirSync(dataDir, { recursive: true });
  const cases = [
    [rules.modelRulesPath(), () => rules.saveModelRules({ rules: [] })],
    [ledger.ledgerPath(), () => ledger.recordDelegationEvents([{ key: '/p/s/subagents/agent-a.jsonl', ts: 1, usd: 0.5 }])],
    [seed.seedStatePath(), () => seed.saveSeedState({ decided: {} })],
    [config.configPath(), () => config.saveConfig({ statusline: {} })],
  ];
  for (const [file, save] of cases) {
    writeFileSync(file, '{"lifetime": 123.4, "cut off');
    save();
    assert.equal(readFileSync(corruptCopyPath(file), 'utf8'), '{"lifetime": 123.4, "cut off', file);
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')), file);
  }
  assert.deepEqual(readdirSync(dataDir).filter((n) => n.endsWith('.tmp')), []);
});
