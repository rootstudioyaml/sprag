import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { makeHome, writeSession } from './helpers/statusline-home.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');

/**
 * `sprag install --dry-run` once ran the real install: the flag does not exist,
 * nothing said so, and settings.json was rewritten. A first word that is not a
 * command fell into the 30-day report the same way. These tests run the real CLI
 * in a sandbox HOME, because the guard sits in bin/cli.js, which executes on load
 * and cannot be imported.
 *
 * spawnSync rather than execFileSync: the warning case exits 0 and execFileSync
 * hands back stdout only, so its stderr would be lost.
 */
function sprag(home, args, { input = '' } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: home.project,
    env: childEnv({
      HOME: home.dir,
      XDG_CONFIG_HOME: join(home.dir, 'cfg'),
      APPDATA: join(home.dir, 'cfg'),
      NO_COLOR: '1',
      CTS_LANG: 'en',
      CTS_NO_UPDATE_CHECK: '1',
    }),
    input,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function withHome(fn) {
  const home = makeHome('sprag-unk-');
  try { return fn(home); } finally { home.cleanup(); }
}

test('an unknown first word is rejected instead of running the report', () => {
  withHome((home) => {
    const r = sprag(home, ['bogus']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^Unknown command: bogus$/m);
    assert.match(r.stderr, /Run `sprag --help` for the list of commands\./);
    // The report prints "Scanning session files..." on stderr before it reads
    // anything; its absence is what shows the scan never started.
    assert.doesNotMatch(r.stderr, /Scanning/);
    assert.equal(r.stdout, '');
  });
});

test('an unknown flag on install is rejected before anything is written', () => {
  withHome((home) => {
    const r = sprag(home, ['install', '--dry-run']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^Unknown option: --dry-run$/m);
    assert.ok(!existsSync(join(home.dir, '.claude', 'settings.json')), 'settings.json must not be created');
    assert.deepEqual(readdirSync(join(home.dir, '.claude')), ['projects'], 'nothing else may appear under ~/.claude');
  });
});

test('an unknown flag on uninstall is rejected, and a flag that belongs to install is not accepted there', () => {
  withHome((home) => {
    for (const flag of ['--dry-run', '--force']) {
      const r = sprag(home, ['uninstall', flag]);
      assert.equal(r.code, 2, flag);
      assert.match(r.stderr, new RegExp(`^Unknown option: ${flag}$`, 'm'));
    }
    assert.equal(sprag(home, ['install', '--purge']).code, 2);
  });
});

test('an unknown flag on the report is rejected, whichever spelling the known flags use', () => {
  withHome((home) => {
    writeSession(home, { sessionId: 'unk-1' });
    for (const argv of [
      ['--bogus'],
      ['--days', '3', '--bogus'],
      ['--days=3', '--no-color', '--bogus'],
      ['-x'],
    ]) {
      const r = sprag(home, argv);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.stderr, /^Unknown option: /m);
      assert.doesNotMatch(r.stderr, /Scanning/, `${argv.join(' ')} must stop before the scan`);
    }
  });
});

test('the statusline warns about an unknown flag and still renders, so the line never goes blank', () => {
  withHome((home) => {
    const r = sprag(home, ['--statusline', '--bogus'], { input: '{}' });
    assert.equal(r.code, 0);
    assert.ok(r.stdout.trim().length > 0, 'the statusline must still print its line');
    assert.match(r.stderr, /Unknown option: --bogus/);
  });
});

test('a normal report call, with the value in either spelling, still exits 0', () => {
  withHome((home) => {
    writeSession(home, { sessionId: 'ok-1' });
    for (const argv of [
      ['--days', '3', '--no-color'],
      ['--days=3', '--no-color'],
      ['-d', '3', '--format', 'json'],
      ['--format=csv', '--hours', '48'],
      ['--version', '--exclude-session', '--looks-like-a-flag'],
    ]) {
      const r = sprag(home, argv);
      assert.equal(r.code, 0, `${argv.join(' ')}\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Unknown/, argv.join(' '));
    }
  });
});

test('uninstall --purge is a known spelling', () => {
  withHome((home) => {
    const r = sprag(home, ['uninstall', '--purge']);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /Unknown/);
  });
});

test('a hook call that names an unknown subcommand stays silent', () => {
  withHome((home) => {
    for (const argv of [['--hook', 'bogus'], ['bogus', '--hook']]) {
      const r = sprag(home, argv);
      assert.equal(r.code, 0, argv.join(' '));
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    }
  });
});

test('--help still prints usage when it is mixed with an unknown flag', () => {
  withHome((home) => {
    const r = sprag(home, ['--help', '--bogus']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage:/);
  });
});

/*
 * The flag lists in bin/cli.js repeat what the code reads, which is the shape
 * that drifts: add `hasFlag('--new')` and the guard starts rejecting it, drop a
 * read and the guard starts accepting a flag that does nothing. This pins the
 * lists to the source in both directions.
 */
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const READS = /(?:hasFlag|getArg|numArg)\(\s*'(-[^']+)'/g;
const namesRead = (src) => [...src.matchAll(READS)].map((m) => m[1]);

function listedFlags(kind) {
  // Each entry's lists hold only quoted names, so the first closing brace ends it.
  const block = read('bin/cli.js').match(new RegExp(`\\n  ${kind}: \\{([\\s\\S]*?)\\}`));
  assert.ok(block, `FLAG_SPECS.${kind} not found`);
  return new Set([...block[1].matchAll(/'(-[^']+)'/g)].map((m) => m[1]));
}

test('every flag the default path reads is listed, and every listed flag is read', () => {
  const report = listedFlags('report');
  const cli = read('bin/cli.js');
  // The flag lists themselves contain quoted names but no hasFlag/getArg calls,
  // so scanning the whole file reads only real call sites. The Codex branch and
  // the other subcommands' dispatch read no flags of their own here.
  const reads = new Set([...namesRead(cli), ...namesRead(read('src/statusline-mode.js'))]);
  // hook.cjs reads --threshold from process.argv, not through hasFlag/getArg.
  reads.add('--threshold');
  for (const name of reads) assert.ok(report.has(name), `${name} is read but missing from FLAG_SPECS.report`);
  for (const name of report) assert.ok(reads.has(name), `${name} is listed in FLAG_SPECS.report but nothing reads it`);
});

test('install and uninstall list exactly the flags their commands read, plus the global help flags', () => {
  const globalOnly = new Set(['--help', '-h']);
  const install = listedFlags('install');
  const uninstall = listedFlags('uninstall');
  const installReads = new Set(namesRead(read('src/commands/install.js')));
  const uninstallReads = new Set(namesRead(read('src/commands/uninstall.js')));
  for (const name of installReads) assert.ok(install.has(name), `${name} is read by install but not listed`);
  for (const name of install) assert.ok(installReads.has(name) || globalOnly.has(name), `${name} is listed for install but never read`);
  for (const name of uninstallReads) assert.ok(uninstall.has(name), `${name} is read by uninstall but not listed`);
  // --yes and --no-input are documented no-ops for uninstall: it never asks.
  const noOps = new Set(['--yes', '--no-input']);
  for (const name of uninstall) {
    assert.ok(uninstallReads.has(name) || globalOnly.has(name) || noOps.has(name), `${name} is listed for uninstall but never read`);
  }
});
