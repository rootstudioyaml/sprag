// The npm postinstall step sets Claude Code up only for an install that asked
// for it (2026-10-01 review, D3), and the converter's own installs are bounded
// (D4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postinstallDecision } from '../src/postinstall.js';
import { childEnv } from './helpers/child-env.js';

const ENTRY = fileURLToPath(new URL('../bin/postinstall.js', import.meta.url));
const npm = (extra) => ({ npm_config_user_agent: 'npm/11.6.0 node/v24.0.0 darwin arm64', ...extra });

test('npm runs the setup for a global install only', () => {
  assert.equal(postinstallDecision(npm({ npm_config_global: 'true' })).run, true);
  // A project dependency, the npx cache, `npm install` in a checkout.
  assert.equal(postinstallDecision(npm({})).run, false);
  assert.equal(postinstallDecision(npm({ npm_config_global: '' })).run, false);
  assert.equal(postinstallDecision(npm({ npm_config_global: 'false' })).run, false);
});

test('CI never runs the setup, global or not', () => {
  for (const CI of ['true', '1', 'yes']) {
    assert.equal(postinstallDecision(npm({ npm_config_global: 'true', CI })).run, false, `CI=${CI}`);
  }
  for (const CI of ['', '0', 'false']) {
    assert.equal(postinstallDecision(npm({ npm_config_global: 'true', CI })).run, true, `CI=${JSON.stringify(CI)}`);
  }
});

test('a package manager that does not report its scope keeps the old behaviour', () => {
  assert.equal(postinstallDecision({ npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v24.0.0' }).run, true);
  assert.equal(postinstallDecision({ npm_config_user_agent: 'bun/1.2.0' }).run, true);
  assert.equal(postinstallDecision({}).run, true);
});

test('SPRAG_POSTINSTALL overrides both ways', () => {
  assert.equal(postinstallDecision(npm({ CI: 'true', SPRAG_POSTINSTALL: '1' })).run, true);
  assert.equal(postinstallDecision(npm({ npm_config_global: 'true', SPRAG_POSTINSTALL: '0' })).run, false);
});

test('package.json runs the gated entry, and a skipped install touches nothing', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.postinstall, 'node bin/postinstall.js || true');
  assert.ok(pkg.files.includes('bin/'), 'the entry ships with the package');

  const home = mkdtempSync(join(tmpdir(), 'cts-postinstall-'));
  try {
    const out = execFileSync(process.execPath, [ENTRY], {
      env: childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'cfg'), APPDATA: join(home, 'cfg'),
        npm_config_user_agent: 'npm/11.6.0 node/v24.0.0', npm_config_global: '' }),
      encoding: 'utf8',
    });
    assert.match(out, /setup skipped \(not a global install\)\. Run `sprag install`/);
    assert.equal(existsSync(join(home, '.claude')), false, 'no settings were written');
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the converter installs are bounded and run no install scripts', () => {
  const require = createRequire(import.meta.url);
  const doc2md = require('../src/doc2md.cjs');
  const fig = require('../src/fig2md.cjs');
  for (const spec of [doc2md.MARKITDOWN_SPEC, ...doc2md.EDIT_LIBS]) {
    assert.match(spec, />=\d[\d.]*,<\d[\d.]*$/, `no upper bound: ${spec}`);
  }
  assert.ok(fig.FIG_INSTALL_ARGS.includes('--ignore-scripts'));
  assert.equal(fig.FIG_INSTALL_ARGS.at(-1), fig.FIG_PARSER_SPEC);
});
