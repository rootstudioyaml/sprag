/**
 * Claude Code may start the statusline command before it has written the
 * payload. Reading fd 0 then has to wait for the writer, not give up.
 *
 * It used to give up. `process.stdin.isTTY` builds a stream that turns the pipe
 * non-blocking, readFileSync(0) threw EAGAIN on the still-empty pipe, and the
 * catch turned that into an empty payload: no session id, no rate limits, no
 * model. In the suite it showed as a statusline test that failed about once in
 * ten full runs, always on a cold cache, because only a slow first render
 * reached fd 0 before execFileSync had written the input.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeHome, writeSession, strip } from './helpers/statusline-home.js';
import { childEnv } from './helpers/child-env.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'bin', 'cli.js');

/** Spawn, write `input` after `delayMs`, resolve with stdout. */
function runLate(args, input, { delayMs = 300, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stdin.on('error', () => {}); // a reader that quit early shows up in the assertion
    c.on('error', reject);
    c.on('close', () => resolve(out));
    setTimeout(() => c.stdin.end(input), delayMs);
  });
}

test('readStdinRaw waits for a writer that is late, even after process.stdin was touched', async () => {
  const mod = pathToFileURL(join(ROOT, 'src', 'stdin-payload.js')).href;
  const script = `process.stdin.isTTY; const m = await import(${JSON.stringify(mod)}); process.stdout.write(JSON.stringify(m.readStdinJson()));`;
  const home = makeHome();
  try {
    const out = await runLate(['--input-type=module', '-e', script], '{"session_id":"late"}', { env: childEnv({ HOME: home.dir }) });
    assert.equal(out, '{"session_id":"late"}');
  } finally {
    home.cleanup();
  }
});

test('the statusline keeps the session chip when the payload arrives late', async () => {
  const home = makeHome();
  try {
    const mine = writeSession(home, {
      sessionId: 'sess-late',
      subagents: ['claude-haiku-4-5', 'claude-sonnet-5'],
    });
    const out = await runLate([CLI, '--statusline', '--no-color', '--no-verbose'],
      JSON.stringify({ session_id: 'sess-late', transcript_path: mine }), {
        cwd: home.project,
        env: childEnv({
          HOME: home.dir,
          XDG_CONFIG_HOME: join(home.dir, 'cfg'),
          APPDATA: join(home.dir, 'cfg'),
          NO_COLOR: '1',
          SPRAG_NO_UPDATE_CHECK: '1',
        }),
      });
    assert.match(strip(out), /🔀 this session 2 \(haiku 1 · sonnet 1\)/);
  } finally {
    home.cleanup();
  }
});
