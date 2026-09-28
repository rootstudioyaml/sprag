import test from 'node:test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runCodexWithPanel, resizeInlinePanel, createInlinePanelResizer } from '../src/codex-panel-runner.js';
import { selectAgent } from '../src/agent.js';
import { existsSync } from 'node:fs';
import { readPanelBinding } from '../src/codex-panel-session.js';

test('inline runner uses isolated tmux, preserves args and cleans up after detach', () => {
  const calls = [];
  const code = runCodexWithPanel(['--agent', 'test', 'quote\' $(no)'], {
    tty: true, env: { TEST: 'kept' }, exec: (bin, args, options) => {
      calls.push(args);
      if (args.includes('new-session')) return '%0\n';
      if (options.env) assert.equal(options.env.SPRAG_CODEX_PANEL, '1');
      return '';
    }, spawn: (bin, args, options) => {
      assert.equal(options.stdio, 'inherit');
      assert.equal(options.env.TEST, 'kept');
      assert.ok(args.includes('attach-session'));
      return { status: 7 };
    },
  });
  assert.equal(code, 7);
  assert.ok(calls.some((args) => args.includes('split-window') && args.at(-1).endsWith('--compact')));
  assert.match(calls.find((args) => args.includes('new-session')).at(-1), /'"'"'/);
  assert.equal(calls.at(-1).at(-1), 'kill-server');
  assert.deepEqual(selectAgent(['panel', 'run', '--agent', 'codex', '--', '--agent', 'test']),
    { agent: 'codex', args: ['panel', 'run', '--', '--agent', 'test'] });
});

test('inline runner rejects missing tty or tmux before starting', () => {
  assert.throws(() => runCodexWithPanel([], { tty: false }), /interactive terminal/);
  assert.throws(() => runCodexWithPanel([], { tty: true, exec: () => { throw Error('missing'); } }), /requires tmux/);
});

function codexLaunchCommand(args, options = {}) {
  let command;
  runCodexWithPanel(args, {
    tty: true, env: {}, ...options,
    exec: (bin, argv) => {
      if (argv.includes('new-session')) { command = argv.at(-1); return '%0\n'; }
      return '';
    },
    spawn: () => ({ status: 0 }),
  });
  return command;
}

test('inline runner hides the native statusline without changing caller args or config files', () => {
  for (const args of [[], ['resume', '--last'], ['--', 'prompt'], ['-c', 'model_reasoning_effort="xhigh"']]) {
    const original = args.slice();
    const command = codexLaunchCommand(args);
    assert.ok(command.includes("'codex' '--no-daemon' '-c' 'tui.status_line=[]'"));
    if (args.length) assert.ok(command.includes(`'tui.status_line=[]' ${args.map((arg) => `'${arg}'`).join(' ')}`));
    assert.deepEqual(args, original);
    assert.doesNotMatch(command, /config\.toml|show_tooltips/);
  }
});

test('inline runner can keep native statusline or accept a later explicit Codex override', () => {
  const kept = codexLaunchCommand(['resume', '--last'], { keepNativeStatusline: true });
  assert.ok(kept.includes("'codex' '--no-daemon' 'resume' '--last'"));
  assert.doesNotMatch(kept, /tui\.status_line/);
  const explicit = codexLaunchCommand(['-c', 'tui.status_line=["current-dir"]']);
  assert.ok(explicit.includes("'codex' '--no-daemon' '-c' 'tui.status_line=[]' '-c' 'tui.status_line=[\"current-dir\"]'"));
});

test('inline launches get private pending bindings, pass them to the panel, and clean up', () => {
  const paths = [];
  for (let i = 0; i < 2; i++) {
    let file;
    runCodexWithPanel([], { tty: true, env: { SPRAG_CODEX_PANEL_BINDING: '/old-launch', CODEX_HOME: '/test-home' },
      exec: (bin, args, opts) => {
        if (args.includes('new-session')) {
          file = opts.env.SPRAG_CODEX_PANEL_BINDING;
          paths.push(file);
          assert.ok(existsSync(file));
          assert.equal(readPanelBinding(file), null);
          assert.match(args.at(-1), /--no-daemon/);
          return '%0\n';
        }
        if (args.includes('split-window')) {
          assert.ok(args.at(-1).includes(`'--session-file' '${file}'`));
          // The runner resolves CODEX_HOME, which gains a drive letter on Windows.
          assert.ok(args.at(-1).includes(`'CODEX_HOME=${resolve('/test-home')}'`));
        }
        return '';
      }, spawn: () => ({ status: 0 }),
    });
    assert.equal(existsSync(file), false);
  }
  assert.notEqual(paths[0], paths[1]);
  assert.equal(codexLaunchCommand(['--no-daemon']).match(/--no-daemon/g).length, 1);
  for (const args of [['--remote', 'ws://localhost'], ['--remote=ws://localhost']]) {
    assert.throws(() => codexLaunchCommand(args), /require a local Codex process/);
  }
  assert.doesNotThrow(() => codexLaunchCommand(['--', '--remote=literal-prompt']));
});

test('inline panel resizes for wrapped content while retaining ten Codex rows', () => {
  const calls = [];
  const options = { env: { SPRAG_CODEX_PANEL: '1', TMUX: 'private', TMUX_PANE: '%1' }, exec: (bin, args) => {
    calls.push(args); return '24 6';
  } };
  resizeInlinePanel(30, options);
  assert.deepEqual(calls.at(-1), ['resize-pane', '-t', '%1', '-y', '13']);
  calls.length = 0;
  resizeInlinePanel(5, options);
  assert.equal(calls.length, 1);
  resizeInlinePanel(8, { ...options, env: {} });
  assert.equal(calls.length, 1);
});

test('inline panel does not shrink on content updates but refits after terminal resizing', () => {
  let height = 6, width = 120, windowHeight = 30;
  const sizes = [];
  const fit = createInlinePanelResizer({ env: { SPRAG_CODEX_PANEL: '1', TMUX: 'private', TMUX_PANE: '%1' },
    exec: (_bin, args) => {
      if (args[0] === 'display-message') return `${windowHeight} ${height} ${width}`;
      height = Number(args.at(-1));
      sizes.push(height);
    } });
  fit(5);
  fit(8);
  fit(5);
  fit(8);
  assert.deepEqual(sizes, [9], 'timer and warning changes must not move the split back and forth');
  width = 200;
  fit(4);
  assert.deepEqual(sizes, [9, 5], 'a wider terminal may release unused panel space');
  windowHeight = 18;
  fit(20);
  assert.deepEqual(sizes, [9, 5, 7], 'ten Codex rows and a separator still fit');
});

test('inline resizer state belongs to one panel rather than the module', () => {
  const sizes = [];
  const opts = { env: { SPRAG_CODEX_PANEL: '1', TMUX: 'private', TMUX_PANE: '%1' },
    exec: (_bin, args) => {
      if (args[0] === 'display-message') return '30 6 120';
      sizes.push(Number(args.at(-1)));
    } };
  createInlinePanelResizer(opts)(12);
  createInlinePanelResizer(opts)(5);
  assert.deepEqual(sizes, [13]);
});
