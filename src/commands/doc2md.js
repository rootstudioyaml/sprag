/**
 * Subcommand: doc2md — convert attached documents to Markdown before the
 * model reads them.
 *
 *   claude-token-saver doc2md              # status
 *   claude-token-saver doc2md on|off       # register / remove the Read hook
 *   claude-token-saver doc2md <file>       # convert one file by hand
 *   claude-token-saver doc2md --clean      # drop every cached conversion
 *   claude-token-saver doc2md --hook       # PreToolUse entry point
 */

import { createRequire } from 'node:module';
import { readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Whether the Read hook is actually in settings.json.
 *
 * Status output that reports only the converter is misleading: a working
 * converter with no hook, and a hook with no converter, both add up to
 * "nothing happens", and the user has no way to tell which half is missing.
 */
function hookRegistered() {
  try {
    const { homedir } = require('node:os');
    const settings = JSON.parse(
      require('node:fs').readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'),
    );
    return (settings?.hooks?.PreToolUse || []).some((m) =>
      (m.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('doc2md --hook')),
    );
  } catch {
    return false;
  }
}

export async function run({ args, hasFlag }) {
  const doc2md = require('../doc2md.cjs');
  const sub = args[1];

  // Hook path first and cheap: this runs on every Read of a matching file, so
  // nothing above it may cost a syscall.
  if (hasFlag?.('--hook') || sub === '--hook') {
    const { readStdinJson } = await import('../stdin-payload.js');
    const payload = readStdinJson();
    if (!payload) return;
    let out = null;
    try {
      out = doc2md.formatHookOutput(doc2md.decideForRead(payload));
    } catch {
      // A converter that throws must not take the Read down with it. Printing
      // nothing leaves Claude Code to run the tool call exactly as before.
      return;
    }
    if (out) console.log(out);
    return;
  }

  if (sub === 'install-converter') {
    const res = doc2md.installConverter({ onProgress: (m) => console.log(`  ${m}`) });
    if (res.ok) {
      console.log(`✓ converter ready: ${res.python}`);
      return;
    }
    console.error(`✗ ${res.reason}: ${res.detail}`);
    process.exitCode = 1;
    return;
  }

  if (sub === 'on') {
    const { installDoc2mdHook } = await import('../installer.js');
    const res = installDoc2mdHook();
    console.log(res.action === 'skipped'
      ? `✗ ${res.reason}`
      : `✓ Read hook ${res.action} (${res.path})`);
    // A registered hook with no converter behind it does nothing at all, and
    // says nothing about it either, which reads as a broken feature. Offer the
    // one command that closes the gap right where the gap is visible.
    const python = doc2md.findInterpreter();
    console.log(python
      ? `  converter: markitdown via ${python}`
      : `  converter: missing — run \`${doc2md.INSTALL_HINT}\` or the hook will do nothing`);
    return;
  }

  if (sub === 'off') {
    const { removeDoc2mdHook } = await import('../installer.js');
    const res = removeDoc2mdHook();
    console.log(res.action === 'skipped' ? `✗ ${res.reason}` : `✓ Read hook ${res.action}`);
    return;
  }

  if (hasFlag?.('--clean') || sub === '--clean') {
    const dir = doc2md.cacheDir();
    let removed = 0;
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        rmSync(join(dir, name), { force: true });
        removed += 1;
      }
    }
    console.log(`✓ removed ${removed} cached file(s) from ${dir}`);
    return;
  }

  // A path: convert it now and print where the result landed. This is the
  // diagnostic path — it reports the refusal reason instead of swallowing it,
  // which is how you find out that markitdown is missing rather than guessing.
  if (sub && !sub.startsWith('-')) {
    const result = doc2md.convert(sub);
    if (result.ok) {
      console.log(`✓ ${result.cached ? 'cached' : 'converted'}: ${result.cacheFile}`);
      if (result.meta?.note) console.log(`  ${result.meta.note}`);
      if (result.meta?.clipped) console.log('  결과가 상한을 넘어 뒷부분을 잘랐습니다.');
      console.log(`  ${statSync(result.cacheFile).size} bytes`);
      return;
    }
    console.error(`✗ ${result.reason}${result.detail ? `: ${result.detail}` : ''}`);
    if (result.reason === 'no-markitdown') console.error(`  ${doc2md.INSTALL_HINT}`);
    process.exitCode = 1;
    return;
  }

  const python = doc2md.findInterpreter();
  const dir = doc2md.cacheDir();
  const cached = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0;
  console.log('doc2md — attached documents are converted to Markdown before the model reads them.');
  console.log(`  formats:   ${doc2md.TARGET_EXTENSIONS.join(' ')}`);
  console.log(`  converter: ${python ? `markitdown via ${python}` : `not installed — ${doc2md.INSTALL_HINT}`}`);
  console.log(`  cache:     ${dir} (${cached} file(s))`);
  console.log(`  hook:      ${hookRegistered() ? 'registered on Read' : 'not registered'}`);
  console.log('');
  if (!python) console.log(`Install the converter: ${doc2md.INSTALL_HINT}`);
  console.log('Enable with: claude-token-saver doc2md on');
}
