/**
 * The contract of test/helpers/child-env.js, and the two guards that keep it.
 *
 * A test that spawns the real CLI inherits the shell that ran the suite unless
 * something stops it, and the variables this tool reads are exactly the ones
 * that change what the CLI prints. That is how five effort/ultracode tests came
 * to fail on a correct tree: an IntelliJ terminal exports
 * TERMINAL_EMULATOR=JetBrains-JediTerm, statusline-mode.js reads it in the
 * child, the labels step down to the narrow set, and assertions pinned to the
 * 🔬 chip see ▲ instead. The same shape cost a release once before, with
 * COLORTERM and the gauge tests (v3.50.0).
 *
 * Wording a rule in a comment would not have caught either one, so both halves
 * are machine-checked here: the scrub list has to cover every variable the
 * source actually reads, and no test may hand a child the ambient environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, SCRUBBED, NEVER_SCRUBBED } from './helpers/child-env.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

test('a leaking variable is dropped even when the ambient environment has it', () => {
  const restore = { ...process.env };
  process.env.TERMINAL_EMULATOR = 'JetBrains-JediTerm';
  process.env.SPRAG_ICON = 'force';
  process.env.COLORTERM = 'truecolor';
  process.env.CTS_LANG = 'ko';
  try {
    const env = childEnv({ HOME: '/tmp/sandbox' });
    for (const name of ['TERMINAL_EMULATOR', 'SPRAG_ICON', 'COLORTERM', 'CTS_LANG']) {
      assert.equal(env[name], undefined, `${name} must not reach the child`);
    }
    // And the variables a child needs to run at all are still there.
    assert.equal(env.PATH, process.env.PATH, 'PATH is not an input to this tool, so it stays');
  } finally {
    process.env = restore;
  }
});

test('HOME is required, mirrored to USERPROFILE, and overridable', () => {
  assert.throws(() => childEnv(), /HOME/);
  assert.throws(() => childEnv({ XDG_CONFIG_HOME: '/tmp/cfg' }), /HOME/);
  /* Without a stated HOME, POSIX homedir() answers from the passwd entry, so the
     child would read the real ~/.claude instead of the sandbox. Requiring it is
     what makes that impossible rather than merely discouraged. */
  const env = childEnv({ HOME: '/tmp/sandbox' });
  assert.equal(env.USERPROFILE, '/tmp/sandbox', 'Windows resolves the home through USERPROFILE');
  assert.equal(childEnv({ HOME: '/tmp/a', USERPROFILE: '/tmp/b' }).USERPROFILE, '/tmp/b');
});

test('overrides win, and undefined means "not set"', () => {
  const env = childEnv({ HOME: '/tmp/sandbox', CTS_LANG: 'en', PATH: undefined });
  assert.equal(env.CTS_LANG, 'en', 'a case may add back what it is about');
  assert.equal('PATH' in env, false, 'undefined removes rather than sets the string "undefined"');
});

test('no spawned child can wait on a terminal, unless the case says so', () => {
  assert.equal(childEnv({ HOME: '/tmp/sandbox' }).CTS_NO_INPUT, '1');
  assert.equal(childEnv({ HOME: '/tmp/sandbox', CTS_NO_INPUT: undefined }).CTS_NO_INPUT, undefined);
});

/** Every `env.NAME` and `env['NAME']` read, in .js, .cjs and .mjs alike. */
const ENV_READ = /(?:process\.)?env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g;

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(js|cjs|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test('the scrub list covers every variable the source reads', () => {
  const known = new Set([...SCRUBBED, ...NEVER_SCRUBBED]);
  const missing = new Map();
  for (const file of ['src', 'bin', 'scripts'].flatMap((d) => sourceFiles(join(ROOT, d)))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ENV_READ)) {
      const name = match[1] || match[2];
      if (!known.has(name)) missing.set(name, file.slice(ROOT.length));
    }
  }
  /* A read that nobody scrubs is a variable the developer's shell decides, and
     the failure it causes lands in an unrelated test with a puzzling diff. The
     fix is one line in SCRUBBED, or a line in NEVER_SCRUBBED saying why the
     child needs it. */
  assert.deepEqual([...missing], [], 'add each name to SCRUBBED (or NEVER_SCRUBBED, with the reason)');
});

test('no test hands a child the ambient environment', () => {
  /* Built rather than written out, because this file would otherwise match its
     own guard. Keep the two halves separate if this line is ever edited. */
  const SPREAD = '...' + 'process.env';
  const offenders = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js') && f !== 'child-env.test.js')
    .filter((f) => readFileSync(join(TEST_DIR, f), 'utf8').includes(SPREAD));
  assert.deepEqual(offenders, [], 'spawn with childEnv({ HOME, ... }) from test/helpers/child-env.js');
});
