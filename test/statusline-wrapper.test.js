/**
 * A statusLine entry that is a shell script calling this tool.
 *
 * `statusLine.command` of `bash ~/.claude/statusline.sh` looks like another
 * tool's slot to the installer, and "existing statusLine command (bash ...)"
 * tells the reader nothing about the script they wrote themselves around
 * `sprag --statusline`. The installer now looks inside: a script that names this
 * tool next to `--statusline` is reported as a wrapper, with the same outcome as
 * before (skipped, conflict, needs --force) and a reason that says what it is.
 *
 * HOME points into a temp directory before any path is resolved.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-statusline-wrapper-'));
const HOME = join(SANDBOX, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX, 'cfg');
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { installStatusline, isOurCommand } = await import('../src/installer.js');
const { loadConfig } = await import('../src/config.js');

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const SETTINGS = join(HOME, '.claude', 'settings.json');
const settings = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));
const SCRIPT = join(HOME, '.claude', 'statusline.sh');

function arrange(command, body) {
  if (body === null) rmSync(SCRIPT, { force: true });
  else writeFileSync(SCRIPT, body);
  writeFileSync(SETTINGS, JSON.stringify({ statusLine: { type: 'command', command, padding: 0 } }));
}

const DIRECT = '#!/bin/bash\ninput=$(cat)\necho "$input" | sprag --statusline --icon\n';
const WITH_NPX = '#!/bin/bash\ninput=$(cat)\necho "$input" | npx -y claude-token-saver@latest --statusline --icon\n';
const FALLBACK_NOTE = '(its npx fallback resolves to the deprecated claude-token-saver package, last published as 3.55.0)';

test('sandbox: paths resolve inside the temp directory', () => {
  assert.ok(SETTINGS.startsWith(SANDBOX));
});

test('a bash script that calls sprag is reported as a wrapper, and left alone', () => {
  arrange('bash ~/.claude/statusline.sh', DIRECT);
  const before = readFileSync(SETTINGS, 'utf8');
  const r = installStatusline();
  assert.equal(r.action, 'skipped');
  assert.equal(r.conflict, true, 'still a conflict, so the interactive install still asks');
  assert.equal(r.wrapper, true);
  assert.equal(r.existingCommand, 'bash ~/.claude/statusline.sh');
  assert.equal(
    r.reason,
    'existing statusLine wrapper script (~/.claude/statusline.sh) calls sprag; re-run with --force to replace it with `sprag --statusline --icon`',
  );
  assert.equal(readFileSync(SETTINGS, 'utf8'), before, 'settings.json is byte for byte what it was');
});

test('an npx fallback to the deprecated package is called out at the end of the reason', () => {
  arrange('bash ~/.claude/statusline.sh', WITH_NPX);
  const r = installStatusline();
  assert.equal(r.wrapper, true);
  assert.equal(
    r.reason,
    `existing statusLine wrapper script (~/.claude/statusline.sh) calls claude-token-saver; re-run with --force to replace it with \`sprag --statusline --icon\` ${FALLBACK_NOTE}`,
  );
});

test('the name reported is the one on the --statusline line', () => {
  arrange(
    'bash ~/.claude/statusline.sh',
    '#!/bin/bash\n# was claude-token-saver, now sprag\nsprag --statusline --icon || npx -y claude-token-saver@latest --statusline --icon\n',
  );
  const r = installStatusline();
  assert.match(r.reason, /calls sprag;/);
  assert.ok(r.reason.endsWith(FALLBACK_NOTE), 'the fallback is still named');
});

test('every way of writing the script path is recognised', () => {
  const abs = SCRIPT;
  for (const command of [
    'sh ~/.claude/statusline.sh',
    'bash $HOME/.claude/statusline.sh',
    'bash ${HOME}/.claude/statusline.sh',
    `bash "${abs}"`,
    `bash '${abs}'`,
    `bash ${abs} --extra-arg`,
    `${abs}`,
    '~/.claude/statusline.sh',
  ]) {
    arrange(command, DIRECT);
    const r = installStatusline();
    assert.equal(r.wrapper, true, command);
    assert.equal(r.action, 'skipped', command);
  }
});

test('anything short of a script that calls this tool keeps the generic message', () => {
  const generic = (command, body) => {
    arrange(command, body);
    const r = installStatusline();
    assert.equal(r.action, 'skipped', command);
    assert.equal(r.conflict, true, command);
    assert.equal(r.wrapper, undefined, `${command} is not a wrapper`);
    assert.equal(r.reason, `existing statusLine command (${command}) — re-run with --force to overwrite`);
  };
  // The script does not exist.
  generic('bash ~/.claude/statusline.sh', null);
  // It exists but never asks for the statusline.
  generic('bash ~/.claude/statusline.sh', '#!/bin/bash\n# sprag lives elsewhere\necho hi\n');
  // It asks for a statusline, from some other tool.
  generic('bash ~/.claude/statusline.sh', '#!/bin/bash\nccusage statusline --statusline\n');
  // Not a script invocation at all.
  generic('their-statusline', DIRECT);
  generic('node ~/.claude/statusline.js', DIRECT);
  generic('bash -c "echo hi"', DIRECT);
  // A directory where the script should be.
  mkdirSync(join(HOME, '.claude', 'dir.sh'), { recursive: true });
  generic('bash ~/.claude/dir.sh', null);
});

test('an oversized file is not read as a wrapper', () => {
  arrange('bash ~/.claude/statusline.sh', `${DIRECT}${'# padding\n'.repeat(40_000)}`);
  assert.equal(installStatusline().wrapper, undefined);
});

test('--force still replaces a wrapper, and merge still keeps it underneath', () => {
  arrange('bash ~/.claude/statusline.sh', DIRECT);
  const merged = installStatusline({ merge: true });
  assert.equal(merged.action, 'updated');
  assert.equal(merged.merged, true);
  assert.equal(loadConfig().statuslineBase.command, 'bash ~/.claude/statusline.sh');

  arrange('bash ~/.claude/statusline.sh', DIRECT);
  const forced = installStatusline({ force: true });
  assert.equal(forced.action, 'updated');
  assert.equal(forced.reason, 'replaced previous statusLine');
  assert.ok(isOurCommand(settings().statusLine.command));
});

test('install prints the wrapper sentence when it skips', () => {
  // The same sentence has to come out of the real command, not only out of the
  // function: install.js has more than one path that prints a statusline result.
  const dir = mkdtempSync(join(tmpdir(), 'cts-install-wrapper-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'statusline.sh'), WITH_NPX);
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
  }));
  try {
    const out = execFileSync(process.execPath, [CLI, 'install'], {
      env: childEnv({ HOME: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1', SPRAG_LANG: 'en' }),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const line = out.split('\n').find((l) => l.includes('statusline:') && l.includes('skipped'));
    assert.ok(line, `a skipped statusline line is printed:\n${out}`);
    assert.ok(
      line.includes(
        `skipped — existing statusLine wrapper script (~/.claude/statusline.sh) calls claude-token-saver; re-run with --force to replace it with \`sprag --statusline --icon\` ${FALLBACK_NOTE}`,
      ),
      line,
    );
    const after = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(after.statusLine.command, 'bash ~/.claude/statusline.sh', 'and nothing was replaced');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
