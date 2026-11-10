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
// Some tests run the CLI against the real ~/.claude/projects. The request store
// (src/request-store.js) would then write sidecars for the developer's own large
// transcripts into the real data directory, so it is off for the run;
// test/request-store.test.js turns it back on inside a temp data directory.
const env = { ...process.env, SPRAG_NO_REQUEST_STORE: '1' };
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
