import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';

test('instruction comparison fails instead of skipping missing, empty, or divergent files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-instructions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  const script = join(root, 'test', 'agents-md.test.js');
  copyFileSync(new URL('./agents-md.test.js', import.meta.url), script);
  const run = () => spawnSync(process.execPath, ['--test', script], {
    cwd: root, env: childEnv({ HOME: root, NODE_TEST_CONTEXT: undefined }), encoding: 'utf8', timeout: 10000,
  });
  const instructions = '# Reader\n\n## Project\nRun tests.\n';
  writeFileSync(join(root, 'CLAUDE.md'), instructions);
  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout + missing.stderr, /AGENTS.md is required/);
  for (const text of ['', '# Title only\n', '# Reader\n\n## Project\nSkip tests.\n']) {
    writeFileSync(join(root, 'AGENTS.md'), text);
    assert.notEqual(run().status, 0);
  }
  writeFileSync(join(root, 'AGENTS.md'), instructions.replace('# Reader', '# Another reader'));
  const equal = run();
  assert.equal(equal.status, 0, equal.stdout + equal.stderr);
});
