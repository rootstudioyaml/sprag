#!/usr/bin/env node
// Publishes the SAME tree under the legacy name `claude-token-saver`, so
// installs of the old name keep receiving updates. The canonical package is
// `sprag-cli` (this repo's package.json); run `npm publish` for that first,
// then `npm run publish:legacy`. The version published here is deprecated in the
// same run, so the old name keeps pointing at `sprag-cli`.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';

// The wording 3.44.0 and later carry on npm; it names `claude-token-saver
// upgrade`, which moves an install to sprag-cli since 3.45.0. Versions up to
// 3.43.0 carry a shorter one with the uninstall step only.
const LEGACY_DEPRECATION = 'renamed to sprag-cli - same tool, same releases. Run: claude-token-saver upgrade (moves you to sprag-cli), or: npm uninstall -g claude-token-saver && npm i -g sprag-cli';

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
// npm deprecates versions, not names: a version published after the name was
// deprecated arrives unmarked, and `npm i claude-token-saver` then installs it
// without a word about `sprag-cli`. 3.50.0 and 3.55.0 went out that way. The
// message holds `&&`, so it goes as an argument rather than through a shell,
// and from the same directory as the publish so both authenticate alike.
const spec = `${pkg.name}@${pkg.version}`;
try {
  execFileSync('npm', ['deprecate', spec, LEGACY_DEPRECATION], { cwd: dir, stdio: 'inherit' });
} catch {
  console.error(
    `\n${spec} is published but NOT deprecated. Run this until it succeeds:\n`
    + `  npm deprecate ${spec} ${JSON.stringify(LEGACY_DEPRECATION)}`,
  );
  process.exitCode = 1;
}
rmSync(dir, { recursive: true, force: true });
