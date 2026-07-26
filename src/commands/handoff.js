/**
 * Subcommand: handoff — write a HANDOFF-YYYY-MM-DD-HHMM.md template in cwd
 * capturing git status + the latest cap snapshot, so a fresh Claude Code
 * session can pick up where this one stopped. Pairs with the cap-warn chip:
 * when statusline shows 🚨 5H 90%+, run this to back up state before the cap
 * hits.
 *   claude-token-saver handoff             # write to cwd
 *   claude-token-saver handoff --cwd PATH  # custom directory
 */

import { readStdinJson, extractCaps } from '../stdin-payload.js';
import { debug } from '../debug.js';

export async function run({ getArg }) {
    const { writeHandoff } = await import('../handoff.js');
    const { recordHandoff } = await import('../history.js');
    const cwd = getArg('--cwd') || process.cwd();
    // Cap data only flows in via stdin (Claude Code statusline contract).
    // Direct CLI invocations won't have it — that's fine, the template will
    // note the gap.
    const stdinJson = readStdinJson();
    const caps = extractCaps(stdinJson);
    const { path, git } = writeHandoff({ cwd, caps });
    try { recordHandoff(path); } catch (e) { debug('handoff:record', e); }
    console.log(`Handoff written: ${path}`);
    if (git) {
      console.log(`  git: ${git.branch}${git.head ? ` @ ${git.head}` : ''}${git.status ? ' (dirty)' : ' (clean)'}`);
    }
    console.log('');
    console.log('Fill in the empty sections, then start a new Claude Code session with:');
    console.log('  Read the most recent HANDOFF-*.md in this directory and continue the work.');
    return;
}
