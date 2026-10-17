/**
 * bin/cli.js wiring for `sprag team`. The command is dispatched through a
 * string import, so this reads the source the way deploy-order.test.js does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = readFileSync(join(ROOT, 'bin', 'cli.js'), 'utf8');

test('team is a known subcommand and dispatches to commands/team.js', () => {
  const set = CLI.match(/const KNOWN_SUBCOMMANDS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(set, 'KNOWN_SUBCOMMANDS found');
  assert.match(set[1], /'team'/);
  assert.match(CLI, /args\[0\] === 'team'[\s\S]{0,120}commands\/team\.js/);
});

test('team command module exports run', async () => {
  const mod = await import('../src/commands/team.js');
  assert.equal(typeof mod.run, 'function');
});
