/**
 * package files — every shipped code file must be reachable from an entry point.
 *
 * package.json `files` ships all of `src/`, so a helper dropped there is
 * published whether or not anything loads it. `src/changelog.js` was exactly
 * that: release tooling imported only by scripts/ and test/, neither of which is
 * shipped, so it sat in the tarball as dead code. Nothing fails when that
 * happens, so the test walks the real tarball contents (`npm pack --dry-run`)
 * from the entry points and names every code file the walk never reaches.
 *
 * Edges are found textually: any string literal ending in a code extension that
 * resolves, relative to the importing file, to another shipped file. That covers
 * import/require/dynamic import and bare names joined onto __dirname.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const toRel = (abs) => relative(ROOT, abs).split(sep).join(posix.sep);

function shippedFiles() {
  // npm on Windows is npm.cmd, which spawnSync cannot execute without a shell.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' });
  assert.equal(r.status, 0, `npm pack --dry-run failed: ${r.error || ''} ${r.stderr}`);
  return JSON.parse(r.stdout)[0].files.map((f) => f.path);
}

test('every shipped code file is reachable from a bin, postinstall or mod entry', () => {
  const shipped = new Set(shippedFiles());
  const code = [...shipped].filter((p) => /\.(js|cjs|mjs|ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const roots = new Set();
  for (const b of Object.values(pkg.bin || {})) roots.add(b.replace(/^\.\//, ''));
  for (const p of shipped) if ((pkg.scripts?.postinstall || '').includes(p)) roots.add(p);
  for (const p of shipped) {
    if (!/^mod\/[^/]+\/hooks\/hooks\.json$/.test(p)) continue;
    const hooks = JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
    for (const m of hooks.modules || []) roots.add(toRel(resolve(ROOT, dirname(p), m)));
  }

  // Extra edges the textual scan cannot see. Empty on purpose: add one here, with
  // a comment on how it is loaded, only for a loader this test cannot follow.
  const extraEdges = {};

  const literal = /(['"`])([^'"`\n]*?\.(?:js|cjs|mjs|ts|tsx))\1/g;
  const edges = (file) => {
    const out = new Set(extraEdges[file] || []);
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of text.matchAll(literal)) {
      if (m[2].includes('${')) continue;
      const target = toRel(resolve(ROOT, dirname(file), m[2]));
      if (shipped.has(target)) out.add(target);
    }
    return out;
  };

  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop();
    if (reached.has(f) || !shipped.has(f)) continue;
    reached.add(f);
    if (code.includes(f)) for (const t of edges(f)) queue.push(t);
  }

  const unreachable = code.filter((f) => !reached.has(f)).sort();
  assert.deepEqual(unreachable, [],
    `shipped code nothing in the package loads: ${unreachable.join(', ')}. A file like this is ` +
    'either release tooling that belongs under scripts/, or a module whose loader this test cannot ' +
    'see; in the second case add the edge explicitly in this test with a comment saying how it is loaded.');
});
