/**
 * statusline-base — run the user's original statusline underneath ours.
 *
 * `sprag install` can merge with a statusline that was already configured: the
 * original settings.json entry is saved as config `statuslineBase`, and each
 * refresh prints that command's output first, sprag's lines after it.
 * The statusline runs every few seconds, so nothing here may throw or stall.
 */

import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';

// A light name check instead of importing installer.js (heavy for a hot path).
// If the saved base were ourselves, running it would recurse without end.
const OURS = /(^|[\s/\\])(sprag|claude-token-saver)(-cli)?(\.cmd|\.exe|\.ps1)?(\s|$)/i;

// A wrapper script saved as the base may itself call `sprag --statusline`;
// that inner run must not start the base again, so the child carries a marker.
const NESTED = 'SPRAG_STATUSLINE_BASE';

/**
 * `input` is the payload Claude Code wrote on stdin, forwarded to the base
 * verbatim; the caller passes the text it already read. This function must not
 * read fd 0 itself: the statusline has drained it by now, and a process whose
 * stdin is still open (the test runner on Windows keeps the pipe to each test
 * file open) blocks in readFileSync(0) with no timeout at all.
 */
export function withBaseStatusline(output, { input = '' } = {}) {
  if (process.env[NESTED] === '1') return output;
  try {
    const cmd = loadConfig().statuslineBase?.command;
    if (typeof cmd !== 'string' || !cmd.trim() || OURS.test(cmd)) return output;
    const opts = { input, encoding: 'utf8', timeout: 1500, windowsHide: true, env: { ...process.env, [NESTED]: '1' } };
    const r = process.platform === 'win32'
      ? spawnSync(cmd, { ...opts, shell: true })
      : spawnSync('/bin/sh', ['-c', cmd], opts);
    if (r.error || r.status !== 0) return output;
    const base = String(r.stdout || '').replace(/[\r\n]+$/, '');
    return base ? `${base}\n${output}` : output;
  } catch {
    return output;
  }
}
