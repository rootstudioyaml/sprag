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
import { readStdinRaw } from './stdin-payload.js';

// A light name check instead of importing installer.js (heavy for a hot path).
// If the saved base were ourselves, running it would recurse without end.
const OURS = /(^|[\s/\\])(sprag|claude-token-saver)(-cli)?(\.cmd|\.exe|\.ps1)?(\s|$)/i;

// A wrapper script saved as the base may itself call `sprag --statusline`;
// that inner run must not start the base again, so the child carries a marker.
const NESTED = 'SPRAG_STATUSLINE_BASE';

export function withBaseStatusline(output) {
  if (process.env[NESTED] === '1') return output;
  try {
    const cmd = loadConfig().statuslineBase?.command;
    if (typeof cmd !== 'string' || !cmd.trim() || OURS.test(cmd)) return output;
    const opts = { input: readStdinRaw(), encoding: 'utf8', timeout: 1500, env: { ...process.env, [NESTED]: '1' } };
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
