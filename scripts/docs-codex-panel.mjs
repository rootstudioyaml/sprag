// Capture CLI output from an isolated example, never from a user's sessions.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../test/helpers/child-env.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export function captureCodexPanel(output) {
  const work = mkdtempSync(join(tmpdir(), 'sprag-codex-capture-'));
  try {
    const home = join(work, 'codex');
    const project = join(work, 'example-project');
    const state = join(work, 'state');
    mkdirSync(join(home, 'sessions'), { recursive: true });
    mkdirSync(join(project, '.git'), { recursive: true });
    mkdirSync(join(state, 'claude-token-saver'), { recursive: true });
    writeFileSync(join(state, 'claude-token-saver', 'config.json'), JSON.stringify({ language: 'en', codex: { delegate: true } }));
    const now = Date.now();
    const records = [
      { type: 'session_meta', payload: { id: 'example-session', cwd: project, model_provider: 'example' } },
      { type: 'turn_context', payload: { model: 'example-model', effort: 'high' } },
      { type: 'event_msg', payload: { type: 'token_count', info: {
        model_context_window: 200000,
        total_token_usage: { input_tokens: 420000, cached_input_tokens: 378000, output_tokens: 8400, reasoning_output_tokens: 2100 },
        last_token_usage: { input_tokens: 94000 },
      }, rate_limits: {
        primary: { used_percent: 62, window_minutes: 300, resets_at: Math.floor(now / 1000) + 7200 },
        secondary: { used_percent: 38, window_minutes: 10080, resets_at: Math.floor(now / 1000) + 259200 },
      } } },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ].map((row) => ({ timestamp: new Date(now).toISOString(), ...row }));
    writeFileSync(join(home, 'sessions', 'example.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const env = childEnv({ HOME: work, CODEX_HOME: home, XDG_CONFIG_HOME: state, APPDATA: state, CTS_LANG: 'en', CTS_NO_KOREAN: '1' });
    const run = (args) => execFileSync(process.execPath, [join(root, 'bin/cli.js'), ...args, '--agent', 'codex'],
      { cwd: project, env, encoding: 'utf8', timeout: 10000 });
    run(['harness', 'init', '--project']);
    // Register the hooks inside the sandbox too, so the example shows an installed
    // panel rather than `Hooks 0/5`, which reads as a broken setup.
    run(['install', '--no-panel']);
    const raw = run(['--statusline', '--no-color', '--columns', '108']);
    const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const body = raw.trimEnd().split('\n').map((line) => `<div class="line">${escape(line)}</div>`).join('\n');
    writeFileSync(output, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sprag Codex example</title><style>
    *{box-sizing:border-box}body{margin:0;background:#141516;color:#d4d7dd}
    main{padding:24px 28px;width:1200px;min-height:330px;font:16px/2 Menlo,monospace;letter-spacing:0}
    .command{color:#f7f8f8;margin-bottom:16px}.line{white-space:pre}.line:nth-child(2){color:#74d7ae}
    </style><main><div class="command">$ sprag --statusline --agent codex</div>${body}</main></html>`);
    return raw;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || join(tmpdir(), 'sprag-codex-panel.html');
  console.log(captureCodexPanel(output));
  console.log(output);
}
