#!/usr/bin/env node
// Runs `node --test` over test/*.test.js only. A bare `node --test` walks the whole tree, including
// handoff/, where eval replays keep git worktrees of older commits with their own copies of the suite.
// Listing the files here works on every Node in the CI matrix: Node 20 has no glob support in --test,
// and Windows shells do not expand globs. Extra arguments (`npm test -- --test-concurrency=4`) pass through.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../test/', import.meta.url));
const files = readdirSync(dir).filter((f) => /\.test\.[cm]?js$/.test(f)).sort().map((f) => join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
