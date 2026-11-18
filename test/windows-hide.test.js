import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * 2026-11-18: Windows users saw a terminal window flash up and close at
 * irregular 20, 30 and 60 minute intervals. The background work sprag starts
 * (route-scan --refresh, team sync, budget refreshes) runs in a detached child,
 * and on Windows a detached child has no console. Any console program it runs
 * without windowsHide gets a brand-new console window of its own: cowork-sync
 * ran `git` up to five times per Cowork folder on every rescan, and the
 * gateway apiKeyHelper ran through cmd.exe on every team sync.
 *
 * Every child_process call in src/ therefore passes windowsHide: true. The flag
 * is a no-op on macOS and Linux, and with inherited stdio it only hides GUI
 * windows, so interactive commands keep their terminal.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FNS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync', 'exec', 'fork'];

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(c?js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** The text from `open` (an index just past an opening bracket) to its matching close. */
function balanced(src, open, [l, r]) {
  let i = open;
  let depth = 1;
  while (i < src.length && depth) {
    const c = src[i++];
    if (c === l) depth++;
    else if (c === r) depth--;
  }
  return src.slice(open, i);
}

/** Local names bound to child_process functions, and namespace names for `cp.spawn(`. */
function childProcessNames(src) {
  const names = new Set();
  const spaces = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (FNS.includes(orig)) names.add(alias || orig);
    }
  }
  for (const m of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*require\(['"](?:node:)?child_process['"]\)/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s*:\s*/);
      if (FNS.includes(orig)) names.add(alias || orig);
    }
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](?:node:)?child_process['"]/g)) spaces.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*require\(['"](?:node:)?child_process['"]\)/g)) spaces.add(m[1]);
  return { names: [...names], spaces: [...spaces] };
}

/** Whether `ident` is declared in the file as an object literal that sets windowsHide. */
function objectSetsHide(src, ident) {
  const decl = new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*\\{`).exec(src);
  return !!decl && /windowsHide\s*:\s*true/.test(balanced(src, decl.index + decl[0].length, ['{', '}']));
}

/** 1-based lines of child_process calls in `src` that do not pass windowsHide: true. */
function missingLines(src) {
  if (!/child_process/.test(src)) return [];
  const { names, spaces } = childProcessNames(src);
  const alts = [
    ...names.map((n) => `(?<![\\w.])${n}`),
    ...spaces.flatMap((s) => FNS.map((fn) => `(?<![\\w.])${s}\\.${fn}`)),
  ];
  if (alts.length === 0) return [];
  const missing = [];
  for (const m of src.matchAll(new RegExp(`(?:${alts.join('|')})\\(`, 'g'))) {
    const call = balanced(src, m.index + m[0].length, ['(', ')']);
    if (/windowsHide\s*:\s*true/.test(call)) continue;
    // `{ ...opts }` spreads a named options object: drop the dots so `opts` is read as a name.
    const idents = [...call.replace(/\.\.\./g, ' ').matchAll(/(?<![\w.'"])([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
    if (idents.some((id) => objectSetsHide(src, id))) continue;
    missing.push(src.slice(0, m.index).split('\n').length);
  }
  return missing;
}

test('every child_process call in src/ hides its console window on Windows', () => {
  const missing = sourceFiles(SRC).flatMap((file) =>
    missingLines(readFileSync(file, 'utf8')).map((line) => `${relative(SRC, file)}:${line}`));
  assert.deepEqual(missing, [], `add windowsHide: true to: ${missing.join(', ')}`);
});

test('the scan catches a call without the flag and follows an options variable', () => {
  const aliased = "import { execFileSync as run } from 'node:child_process';\nrun('git', ['status'], { stdio: 'ignore' });\n";
  const viaVar = "import { spawnSync } from 'node:child_process';\nconst opts = { encoding: 'utf8', windowsHide: true };\nspawnSync('/bin/sh', ['-c', 'x'], opts);\n";
  const namespaced = "import * as cp from 'node:child_process';\ncp.spawn('node', [], { detached: true });\n";
  const regexExec = "import { exec } from 'node:child_process';\nconst m = /a/.exec('a');\n";
  assert.deepEqual(missingLines(aliased), [2], 'an aliased import without the flag is caught');
  assert.deepEqual(missingLines(viaVar), [], 'an options object declared with the flag passes');
  assert.deepEqual(missingLines(namespaced), [2], 'a namespace call without the flag is caught');
  assert.deepEqual(missingLines(regexExec), [], 'RegExp#exec is not a child_process call');
  const spread = "import { spawnSync } from 'node:child_process';\nconst opts = { windowsHide: true };\nspawnSync('x', { ...opts, shell: true });\n";
  assert.deepEqual(missingLines(spread), [], 'a spread options object with the flag passes');
});
