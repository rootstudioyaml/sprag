/**
 * delegate — decideForDelegation() rewrites a Task/Agent PreToolUse call's
 * prompt; formatHookOutput() renders that decision as the PreToolUse JSON
 * Claude Code expects on stdout.
 *
 * cfg is injected directly wherever that avoids touching the real
 * ~/.claude config, the way cohesion.test.js does. buildAppendix() still
 * reads two real files (bounds.md, and — through korean-style.js — the
 * Korean preset) because those ship inside this package; that part is not
 * worth mocking.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAppendix, decideForDelegation, formatHookOutput } from '../src/delegation-guard.js';

const DELEGATION_MARKER = '<!-- sprag:delegation -->';
const ON = { delegate: { enabled: true } };

/* An empty home for every test that does not set one up itself. Without it
   `home` defaults to homedir() and the ratchet section reads whatever the
   machine running the tests keeps in ~/.claude, so the appendix these tests
   assert against differs between a developer's laptop and CI. The buildAppendix
   tests below already inject a throwaway home for that reason; this extends the
   same guarantee to the decideForDelegation ones. */
const EMPTY_HOME = mkdtempSync(join(tmpdir(), 'sprag-home-'));
after(() => rmSync(EMPTY_HOME, { recursive: true, force: true }));

test('decideForDelegation: disabled config returns null', async () => {
  const payload = { tool_name: 'Task', tool_input: { prompt: 'do the thing' } };
  assert.equal(await decideForDelegation(payload, { cfg: {} }), null);
  assert.equal(await decideForDelegation(payload, { cfg: { delegate: { enabled: false } } }), null);
});

test('decideForDelegation: a tool_name other than Task/Agent returns null', async () => {
  const payload = { tool_name: 'Bash', tool_input: { prompt: 'do the thing' } };
  assert.equal(await decideForDelegation(payload, { cfg: ON, home: EMPTY_HOME }), null);
});

test('decideForDelegation: no usable prompt returns null', async () => {
  assert.equal(await decideForDelegation({ tool_name: 'Task', tool_input: {} }, { cfg: ON, home: EMPTY_HOME }), null);
  assert.equal(await decideForDelegation({ tool_name: 'Task', tool_input: { prompt: '' } }, { cfg: ON, home: EMPTY_HOME }), null);
  assert.equal(await decideForDelegation({ tool_name: 'Agent' }, { cfg: ON, home: EMPTY_HOME }), null);
});

test('decideForDelegation: a prompt that already carries the marker is left alone (idempotent)', async () => {
  const payload = {
    tool_name: 'Task',
    tool_input: { prompt: `already rewritten\n\n${DELEGATION_MARKER}\nsome appendix` },
  };
  assert.equal(await decideForDelegation(payload, { cfg: ON, home: EMPTY_HOME }), null);
});

test('decideForDelegation: updatedInput keeps every other tool_input key untouched', async () => {
  const payload = {
    tool_name: 'Task',
    tool_input: {
      prompt: 'Investigate the failing build',
      subagent_type: 'general-purpose',
      model: 'sonnet',
      description: 'build triage',
    },
  };
  const decision = await decideForDelegation(payload, { cfg: ON, home: EMPTY_HOME });
  assert.ok(decision, 'bounds.md ships with the package, so a decision is always produced when enabled');
  assert.equal(decision.updatedInput.subagent_type, 'general-purpose');
  assert.equal(decision.updatedInput.model, 'sonnet');
  assert.equal(decision.updatedInput.description, 'build triage');
  assert.ok(decision.updatedInput.prompt.startsWith('Investigate the failing build'));
  assert.ok(decision.updatedInput.prompt.includes(DELEGATION_MARKER));
});

test('decideForDelegation: an English-only prompt never gets the Korean guidance block, even with it turned on', async () => {
  const payload = { tool_name: 'Task', tool_input: { prompt: 'Investigate the failing build, no Korean here' } };
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: true } };
  const decision = await decideForDelegation(payload, { cfg, home: EMPTY_HOME });
  assert.ok(decision);
  assert.doesNotMatch(decision.updatedInput.prompt, /\[sprag korean-style\]/);
});

test('decideForDelegation: a Hangul prompt still skips the Korean guidance section when koreanStyle itself is off', async () => {
  // The existing test above covers an English prompt with koreanStyle on;
  // this covers the other axis, a Hangul prompt with koreanStyle off. Without
  // this case the section's own gate — koreanStyleEnabled(cfg) — has no test
  // pinning it, and only koreanStyleInjection()'s internal check would be
  // exercised.
  const payload = { tool_name: 'Task', tool_input: { prompt: '한국어로 보고서를 작성하십시오.' } };
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: false } };
  const decision = await decideForDelegation(payload, { cfg, home: EMPTY_HOME });
  assert.ok(decision, 'bounds.md still fires, so a decision is produced regardless of koreanStyle');
  assert.doesNotMatch(decision.updatedInput.prompt, /## Korean style guidance/);
});

test('decideForDelegation: the tool-call cap depends on whether haiku is the target', async () => {
  const haikuByModel = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', model: 'claude-haiku-4-5' } },
    { cfg: ON, home: EMPTY_HOME },
  );
  assert.match(haikuByModel.updatedInput.prompt, /Cap for this delegation: 8 tool calls, 1,500 output tokens\./);

  const haikuBySubagentType = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', subagent_type: 'haiku' } },
    { cfg: ON, home: EMPTY_HOME },
  );
  assert.match(haikuBySubagentType.updatedInput.prompt, /Cap for this delegation: 8 tool calls, 1,500 output tokens\./);

  const nonHaiku = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', model: 'sonnet' } },
    { cfg: ON, home: EMPTY_HOME },
  );
  assert.match(nonHaiku.updatedInput.prompt, /Cap for this delegation: 20 tool calls, 8,000 output tokens\./);
});

test('formatHookOutput: null in, null out; otherwise fixes hookEventName and sends no permissionDecision', () => {
  assert.equal(formatHookOutput(null), null);
  assert.equal(formatHookOutput(undefined), null);

  const rendered = formatHookOutput({ updatedInput: { prompt: 'x', model: 'sonnet' } });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  // Pinned as absent on purpose: rewriting a prompt is not a judgement about
  // whether the call is allowed, and a live session honours updatedInput
  // without it. Answering 'allow' would settle a permission question the
  // user may have wanted to see.
  assert.equal(parsed.hookSpecificOutput.permissionDecision, undefined);
  assert.deepEqual(parsed.hookSpecificOutput.updatedInput, { prompt: 'x', model: 'sonnet' });
});

/* The two sections that read the home directory. `home` is injected so the
   result does not depend on whatever the machine running the tests happens to
   keep in ~/.claude — without it half of buildAppendix's branches can only be
   observed by not asserting on them. */
test('buildAppendix: the ratchet section needs a rules file and a CLAUDE.md that does not import it', async () => {
  const payload = { tool_name: 'Task', tool_input: { prompt: 'summarize this file', model: 'sonnet' } };
  const home = mkdtempSync(join(tmpdir(), 'sprag-home-'));
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    const appendix = () => buildAppendix(payload, { cfg: ON, home });

    assert.doesNotMatch(await appendix(), /Ratchet rules/, 'neither file: nothing to point at');

    writeFileSync(join(home, '.claude', 'ratchet.md'), '- a rule\n');
    assert.doesNotMatch(await appendix(), /Ratchet rules/, 'rules but no harness around them');

    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# notes\n');
    assert.match(await appendix(), /## Ratchet rules/, 'both, and the import is absent');

    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# notes\n@~/.claude/ratchet.md\n');
    assert.doesNotMatch(await appendix(), /Ratchet rules/, 'imported already, so saying it again is noise');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildAppendix: Korean guidance rides along for Hangul, and for an English ask at a .ko target', async () => {
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: true } };
  const home = mkdtempSync(join(tmpdir(), 'sprag-home-'));
  const ask = (prompt) => buildAppendix({ tool_name: 'Task', tool_input: { prompt } }, { cfg, home });
  try {
    assert.match(await ask('한국어로 보고하십시오.'), /## Korean style guidance/);
    // English prose, Korean deliverable: the target path is the only signal
    // that the output will be read as Korean.
    assert.match(await ask('Rewrite docs/COMMANDS.ko.md from the English original'), /## Korean style guidance/);
    assert.doesNotMatch(await ask('Rewrite docs/COMMANDS.md and keep it terse'), /Korean style guidance/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildAppendix: transcript_path and cwd combine into the touched-paths section via { root: payload?.cwd }', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-cwd-'));
  const home = mkdtempSync(join(tmpdir(), 'sprag-home-'));
  try {
    const filePath = join(root, 'src', 'thing.js');
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: filePath } }] },
    });
    const transcriptPath = join(root, 'session.jsonl');
    writeFileSync(transcriptPath, line + '\n');

    const payload = {
      tool_name: 'Task',
      tool_input: { prompt: 'continue the investigation' },
      transcript_path: transcriptPath,
      cwd: root,
    };
    // recentToolPaths() only learns a root through `payload?.cwd`. If that
    // wiring is ever dropped — a future refactor passing `payload` itself, or
    // some other key — recentToolPaths() falls back to returning [] and the
    // whole section disappears with no error anywhere else to catch it. This
    // is the one test standing in front of that.
    const appendix = await buildAppendix(payload, { cfg: ON, home });
    assert.match(appendix, /## Already-touched paths/);
    assert.ok(appendix.includes(join('src', 'thing.js')), 'the relative path must be in the rendered section');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

/* installDelegationGuardHook() / removeDelegationGuardHook() resolve ~/.claude
   through os.homedir(), which cannot be redirected inside a running process,
   so each of these runs the installer in a child process with HOME pointed at
   a throwaway directory — the same technique doc2md.test.js uses for its own
   hook install/remove pair. */
test('installDelegationGuardHook: hooks.PreToolUse present but not an array is left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settingsPath = join(home, '.claude', 'settings.json');
    const original = { hooks: { PreToolUse: 'not-an-array' } };
    writeFileSync(settingsPath, JSON.stringify(original, null, 2) + '\n');

    const script = `
      import { installDelegationGuardHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
      console.log(JSON.stringify(installDelegationGuardHook()));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.action, 'skipped');
    assert.match(result.reason, /hooks\.PreToolUse is not an array/);
    // Schema-invalid data belongs to the user, not this tool — the file on
    // disk has to come back exactly as it started.
    assert.equal(readFileSync(settingsPath, 'utf8'), JSON.stringify(original, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installDelegationGuardHook: installing twice does not duplicate the entry, and removing the only one drops the PreToolUse key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });

    const script = `
      import { installDelegationGuardHook, removeDelegationGuardHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
      const { readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      // homedir(), not process.env.HOME: the installer resolves ~/.claude that
      // way, and on Windows it reads USERPROFILE. Assembling the path from one
      // variable would let this test check a different file than the code wrote.
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const steps = [];
      steps.push(installDelegationGuardHook().action);
      steps.push(installDelegationGuardHook().action);
      steps.push(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse.length);
      steps.push(removeDelegationGuardHook().action);
      steps.push('PreToolUse' in JSON.parse(readFileSync(settingsPath, 'utf8')).hooks);
      steps.push(removeDelegationGuardHook().action);
      console.log(JSON.stringify(steps));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(run.status, 0, run.stderr);
    const [created, again, countAfterInstall, removed, hasKeyAfterRemove, absent] = JSON.parse(run.stdout.trim());
    assert.equal(created, 'created');
    assert.equal(again, 'exists', 'installing twice must not duplicate the entry');
    assert.equal(countAfterInstall, 1);
    assert.equal(removed, 'removed');
    assert.equal(hasKeyAfterRemove, false, 'the only entry removed must drop hooks.PreToolUse entirely, not leave []');
    assert.equal(absent, 'absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeDelegationGuardHook: a foreign PreToolUse hook survives install and remove', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settingsPath = join(home, '.claude', 'settings.json');
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] };
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [foreign] } }, null, 2) + '\n');

    const script = `
      import { installDelegationGuardHook, removeDelegationGuardHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
      installDelegationGuardHook();
      console.log(JSON.stringify(removeDelegationGuardHook()));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.action, 'removed');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(settings.hooks.PreToolUse, [foreign], "someone else's hook survives, and the key stays for it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('removeDelegationGuardHook: a hook that carries our flag but not our executable is left alone', () => {
  /* `delegate --hook` says nothing about which program runs. A user who
     registers their own `other-tool delegate --hook`, or a script of their own
     named delegate, matched the flag-only test and `delegate off` deleted their
     entry. v3.46.1 records this repository shipping that same bug through
     `uninstall`; isDelegationGuardHookCommand() now requires our executable in
     the command position as well, and this pins it. */
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settingsPath = join(home, '.claude', 'settings.json');
    const lookalike = { matcher: 'Task', hooks: [{ type: 'command', command: 'other-tool delegate --hook' }] };
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [lookalike] } }, null, 2) + '\n');

    const script = `
      import { installDelegationGuardHook, removeDelegationGuardHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
      const { readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      // homedir(), not process.env.HOME: the installer resolves ~/.claude that
      // way, and on Windows it reads USERPROFILE. Assembling the path from one
      // variable would let this test check a different file than the code wrote.
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const steps = [];
      // The lookalike must not read as "already installed" either, or ours
      // never gets registered and the feature silently does nothing.
      steps.push(installDelegationGuardHook().action);
      steps.push(removeDelegationGuardHook().action);
      steps.push(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse);
      console.log(JSON.stringify(steps));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(run.status, 0, run.stderr);
    const [installed, removed, remaining] = JSON.parse(run.stdout.trim());
    assert.equal(installed, 'updated', 'a lookalike must not be mistaken for ours already being there');
    assert.equal(removed, 'removed');
    assert.deepEqual(remaining, [lookalike], "the user's own hook survives `delegate off`");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* The three below drive bin/cli.js as a child process, because what they pin is
   the process-level contract the hook lives under: what reaches stdout, and
   what is left in config when installation fails. */
/* fileURLToPath, not URL#pathname: on Windows the latter yields
   `/D:/repo/bin/cli.js`, and the leading slash makes the spawn miss. v3.38.0
   fixed exactly this in the --help test, and this repository runs a 3-OS
   matrix, so the same expression would have failed on windows-latest again. */
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

test('delegate --hook: an empty or malformed payload prints nothing at all', () => {
  /* Claude Code reads this hook's stdout as its instruction, so anything
     printed on a path that has no rewrite to offer is acted on. v3.26.2 records
     this failing once already: an unknown subcommand called with --hook fell
     through to the default report and pushed a whole statistics table into the
     hook stream on every Read. Nothing here asserts on behaviour inside the
     module; the contract is the empty stdout. */
  for (const stdin of ['', 'not json at all', '{"tool_name":"Task"', '{}']) {
    const run = spawnSync(process.execPath, [CLI, 'delegate', '--hook'], { encoding: 'utf8', input: stdin });
    assert.equal(run.status, 0, `exit code for ${JSON.stringify(stdin)}: ${run.stderr}`);
    assert.equal(run.stdout, '', `stdout for ${JSON.stringify(stdin)} must be empty`);
  }
});

test('delegate on: a settings.json it cannot use leaves the feature off, not half on', () => {
  /* The flag used to be saved before the install was attempted, so a settings
     file this cannot edit left `delegate: on, hook not registered` behind — a
     feature the user believes is on with nothing registered to call it. The
     opposite order is safe, since delegateEnabled() turns a stray hook into a
     no-op. */
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: 'not-an-array' } }) + '\n');
    const env = { ...process.env, HOME: home, USERPROFILE: home };

    const on = spawnSync(process.execPath, [CLI, 'delegate', 'on'], { encoding: 'utf8', env });
    assert.equal(on.status, 0, on.stderr);
    assert.match(on.stdout, /✗/, 'the refusal has to be visible');
    assert.doesNotMatch(on.stdout, /✓/);

    const status = spawnSync(process.execPath, [CLI, 'delegate'], { encoding: 'utf8', env });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /^delegate: off/m, 'a failed install must not leave the flag on');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bounds preset is covered by package.json files, so it ships', () => {
  /* boundsText() returns null when the file is missing and the bounds section
     simply disappears — the one section that is supposed to be unconditional
     would be absent for anyone who installed from npm while every git checkout
     looked fine. `npm pack --dry-run` confirms it ships today; this keeps a
     future narrowing of `files` from undoing that silently. */
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const needed = 'presets/delegation/bounds.md';
  // Segment comparison, not a suffix test: npm treats "presets" and "presets/"
  // alike, so requiring the separator would fail a package that still ships the
  // file. The check reads the declaration only — an .npmignore could still drop
  // the file — which is what `npm pack --dry-run` was run to confirm separately.
  const covered = (pkg.files || []).some((entry) => {
    const e = String(entry).replace(/\/+$/, '');
    return e === needed || needed.startsWith(e + '/');
  });
  assert.ok(covered, `package.json files must cover ${needed}; it has ${JSON.stringify(pkg.files)}`);
});

test("removeDelegationGuardHook: another tool's hook inside OUR matcher group survives", () => {
  /* Claude Code merges entries that share a matcher into one group, so a hook
     someone else registered on `Task|Agent` ends up beside ours. Filtering by
     group took theirs with ours; v3.46.1 and v3.51.0 both record that failure,
     and the existing foreign-hook test does not reach it because its hook sits
     in a separate `Bash` group. */
  const dir = mkdtempSync(join(tmpdir(), 'sprag-dg-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settingsPath = join(home, '.claude', 'settings.json');
    const neighbour = { type: 'command', command: 'some-other-tool watch --pre' };
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2) + '\n');

    const script = `
      import { installDelegationGuardHook, removeDelegationGuardHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
      const { readFileSync, writeFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      installDelegationGuardHook();
      // Put the neighbour into the group Claude Code would have merged it into:
      // the same matcher, alongside ours.
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      settings.hooks.PreToolUse[0].hooks.push(${JSON.stringify(neighbour)});
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\\n');
      const res = removeDelegationGuardHook();
      console.log(JSON.stringify([res.action, JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse]));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(run.status, 0, run.stderr);
    const [action, remaining] = JSON.parse(run.stdout.trim());
    assert.equal(action, 'removed');
    assert.equal(remaining.length, 1, 'the group stays, because it still carries their hook');
    assert.deepEqual(remaining[0].hooks, [neighbour], "only our entry goes, not the whole group");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildAppendix: an English prompt naming the language gets the Korean guidance', async () => {
  /* The two original signals were Hangul in the prompt and a `.ko.` target, so
     "write the release note in Korean" — English prose, Korean deliverable, no
     marked filename — fell through. koreanStyleEnabled still gates the section,
     which is what keeps this widening cheap. */
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: true } };
  const appendix = await buildAppendix(
    { tool_name: 'Task', tool_input: { prompt: 'Write the release note in Korean, three lines' } },
    { cfg, home: EMPTY_HOME },
  );
  assert.match(appendix, /## Korean style guidance/);
});
