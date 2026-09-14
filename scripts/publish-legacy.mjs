#!/usr/bin/env node
// Publishes the SAME tree under the legacy name `claude-token-saver`, so
// installs of the old name keep receiving updates. The canonical package is
// `sprag-cli` (this repo's package.json); run `npm publish` for that first,
// then `npm run publish:legacy`.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'cts-legacy-'));
for (const f of [...pkg.files, 'package.json']) cpSync(join(root, f), join(dir, f), { recursive: true });
pkg.name = 'claude-token-saver';
// The staging tree carries only `files` — no scripts/ — so lifecycle hooks that
// call into scripts/ would crash here. They already ran for the real package,
// and the staged copy is byte-identical, so drop them.
delete pkg.scripts?.prepublishOnly;
delete pkg.scripts?.prepare;
pkg.description = 'Legacy name of sprag-cli (Sprag) - same tool, kept publishing so existing installs stay current. Prefer: npm i -g sprag-cli';
writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
// npm's package page prints `npm i claude-token-saver` from the manifest name,
// which no banner can change; the README banner is what tells readers of the
// legacy page to install `sprag-cli` instead.
const legacyBanner = [
  '> **`claude-token-saver` is the old package name.**',
  '> Install `sprag-cli` instead — same tool, same binaries, same releases:',
  '> `npm i -g sprag-cli`',
  '> (switching needs a swap: `npm uninstall -g claude-token-saver && npm i -g sprag-cli`)',
  '',
  '',
].join('\n');
const legacyReadme = join(dir, 'README.md');
writeFileSync(legacyReadme, legacyBanner + readFileSync(legacyReadme, 'utf8'));
execSync('npm publish', { cwd: dir, stdio: 'inherit' });
rmSync(dir, { recursive: true, force: true });
