#!/usr/bin/env node

/**
 * npm `postinstall` entry point: runs `sprag install` for a global install and
 * says why it did not for anything else. See src/postinstall.js.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { postinstallDecision } from '../src/postinstall.js';

const decision = postinstallDecision(process.env);
if (!decision.run) {
  console.log(`sprag: setup skipped (${decision.reason}). Run \`sprag install\` to register the hooks and the statusline.`);
  process.exit(0);
}
const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
spawnSync(process.execPath, [cli, 'install'], { stdio: 'inherit' });
// A failed setup must not fail the package install: the CLI is still usable
// and `sprag install` can be run again by hand.
process.exit(0);
