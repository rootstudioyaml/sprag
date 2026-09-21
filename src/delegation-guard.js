/**
 * delegation-guard — PreToolUse hook logic for Task/Agent delegation calls.
 *
 * A subagent loads CLAUDE.md by default, but whether it inherits the text a
 * SessionStart hook injected into the main session is not documented, and
 * this project's Korean-style guidance is injected exactly that way (see
 * korean-style.js). So a subagent spawned mid-session most likely never sees
 * it, and everything it writes in Korean drifts back to the patterns the
 * guidance exists to stop. The same gap applies to exploration: a fresh
 * subagent has no memory of what the parent session already read, so it
 * re-discovers those files at its own cost.
 *
 * This module rewrites the delegation prompt to close both gaps, plus a third
 * that has nothing to do with inheritance: a subagent given no explicit limit
 * tends to explore until its own context runs out rather than until the task
 * is answered, which is the tool-call-cap section below.
 *
 * Opt-in via `sprag delegate on` — like doc2md and korean-style, a feature
 * that rewrites tool input silently has to be something the user asked for,
 * not something that ships on by default.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadConfig, saveConfig } from './config.js';
import { recentToolPaths } from './session-paths.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BOUNDS_PATH = join(packageRoot, 'presets', 'delegation', 'bounds.md');

// Marks a prompt this hook has already rewritten, so a second PreToolUse hook
// running on the same call (or a retried call) never appends the appendix
// twice. Doubles as the first line of the appendix itself.
const DELEGATION_MARKER = '<!-- sprag:delegation -->';

/** The rules file the ratchet section points at. One place, two readers. */
const ratchetPath = (home = homedir()) => join(home, '.claude', 'ratchet.md');

/** Whether the delegation guard is on. Off unless the user asked. */
export function delegateEnabled(cfg = loadConfig()) {
  return cfg?.delegate?.enabled === true;
}

export function setDelegateEnabled(enabled) {
  const cfg = loadConfig();
  cfg.delegate = { ...(cfg.delegate || {}), enabled: !!enabled };
  saveConfig(cfg);
  return cfg.delegate;
}

/** The bounds preset's body, or null when the file is missing. */
export function boundsText() {
  try {
    if (!existsSync(BOUNDS_PATH)) return null;
    const text = readFileSync(BOUNDS_PATH, 'utf8').trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Whether `~/.claude/CLAUDE.md` exists but does not already pull in
 * ratchet.md through an `@` import.
 *
 * When the import is there, Claude Code loads ratchet.md into the subagent's
 * CLAUDE.md the same way it does for the main session, so pointing at the
 * path again would just repeat what the subagent already has. When the file
 * does not exist at all, there is no harness to point at either, so this
 * stays false rather than inventing a path that leads nowhere.
 */
function ratchetImportMissing(home = homedir()) {
  // Check the file the section would point at, not just the harness around
  // it. Without this a machine that keeps CLAUDE.md but no rules file gets a
  // section telling the subagent to read a path that is not there, and the
  // failed Read spends one of its capped tool calls — the opposite of what
  // this feature is for.
  if (!existsSync(ratchetPath(home))) return false;
  const claudeMdPath = join(home, '.claude', 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) return false;
  try {
    const text = readFileSync(claudeMdPath, 'utf8');
    return !/@[^\s]*ratchet\.md/.test(text);
  } catch {
    return false;
  }
}

/**
 * Assemble the block appended to a delegation prompt, or null when every
 * section came back empty.
 *
 * Each section is independently conditional: a missing bounds file, an
 * English-only prompt, an already-imported ratchet.md, or a session with
 * nothing read yet each drop their own section without blocking the others.
 */
export async function buildAppendix(payload, { cfg = loadConfig(), home = homedir() } = {}) {
  const sections = [];

  // Read from `model` first — it is the more specific field when both are set
  // — falling back to `subagent_type`. Hoisted out of the bounds section
  // because the Korean section below weighs the same answer.
  const modelHint = String(payload?.tool_input?.model || payload?.tool_input?.subagent_type || '');
  const isHaiku = /haiku/i.test(modelHint);

  const bounds = boundsText();
  if (bounds) {
    // Hardcoded per the user's model-fitting ratchet rule
    // (~/.claude/ratchet-model.md): haiku delegations get a tighter leash
    // (8 tool calls / 1,500 output tokens) than everything else (20 / 8,000).
    const capLine = isHaiku
      ? 'Cap for this delegation: 8 tool calls, 1,500 output tokens.'
      : 'Cap for this delegation: 20 tool calls, 8,000 output tokens.';
    sections.push(['## Bounds and output shape', bounds, capLine].join('\n\n'));
  }

  const prompt = payload?.tool_input?.prompt;
  // koreanStyleInjection() runs to ~8k characters. Appending it to every
  // delegation regardless of language would multiply that cost by the number
  // of delegations in a session; gating it on the prompt actually containing
  // Hangul means an English-only delegation — the common case — never pays
  // for guidance it has no use for.
  // Two cases the plain syllable range misses. A prompt written in English can
  // still ask for Korean output, and this repository keeps `.ko.md` documents
  // beside their English originals, so that ask is routine rather than rare.
  // Compatibility jamo (ㄱ-ㅎ, ㅏ-ㅣ) are Korean too and live outside 가-힣.
  const wantsKorean = typeof prompt === 'string'
    && (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(prompt) || /\.ko\.[a-z]+\b/i.test(prompt));
  if (wantsKorean) {
    // Deliberately attached to haiku delegations too, though the ratio is
    // poor: measured on this repository, this section is 6,390 of the
    // appendix's 8,444 characters (76%), about 7,000 tokens, against the
    // 1,500-token output cap the section above asks a haiku target for.
    //
    // Left in anyway. The cap governs output length while this is input, so
    // the two do not actually contradict each other, and the drift this
    // guidance exists to stop is worst on the cheapest model — dropping it
    // here would remove the benefit exactly where it is largest. What the
    // numbers do argue for is a shortened variant for haiku rather than an
    // all-or-nothing choice, which is a preset change, not a change to this
    // gate. `isHaiku` is in scope so that work has somewhere to land.
    try {
      const { koreanStyleInjection, koreanStyleEnabled } = await import('./korean-style.js');
      // koreanStyleInjection() already returns null when the feature is off,
      // so skipping the check here would still produce the right output —
      // but this section is the most expensive one (~8k characters), and
      // relying on that as the only gate means a future refactor of
      // korean-style.js that changes what an empty return means would turn
      // this into a silent cost regression. Checking directly costs nothing
      // and keeps that assumption out of the picture.
      if (koreanStyleEnabled(cfg)) {
        const koreanBlock = await koreanStyleInjection({ cfg });
        if (koreanBlock) sections.push(['## Korean style guidance', koreanBlock].join('\n\n'));
      }
    } catch {
      // korean-style.js unavailable for some reason — skip only this section.
    }
  }

  if (ratchetImportMissing(home)) {
    sections.push([
      '## Ratchet rules',
      'This machine keeps a growing list of "condition -> action" rules learned',
      'from past mistakes, and your prompt was not written to include it.',
      // Existence was already checked against ratchetPath(home) above; only
      // the string written into the prompt is home-relative from here on.
      // The prompt this appends to can end up quoted back into a transcript,
      // a shared log, or a bug report, and writing the real
      // /Users/<name>/... path there would leak the local username into
      // whatever the caller does with the delegation, for no benefit — the
      // subagent resolves ~ on its own.
      'Read ~/.claude/ratchet.md before repeating one of them.',
    ].join('\n'));
  }

  const paths = recentToolPaths(payload?.transcript_path, { root: payload?.cwd });
  if (paths.length) {
    sections.push([
      '## Already-touched paths',
      'The calling session already read these, most recent first — start here',
      'instead of re-exploring from scratch:',
      ...paths.map((p) => `- ${p}`),
    ].join('\n'));
  }

  if (!sections.length) return null;
  return [DELEGATION_MARKER, ...sections].join('\n\n');
}

/**
 * Decide whether to rewrite a Task/Agent call's prompt, and with what.
 * Returns `{ updatedInput }` or null — null on any reason not to touch the
 * call, so the caller's contract stays "print nothing, let the tool run
 * exactly as given" for every one of them.
 */
export async function decideForDelegation(payload, { cfg = loadConfig(), home = homedir() } = {}) {
  if (!delegateEnabled(cfg)) return null;
  if (payload?.tool_name !== 'Task' && payload?.tool_name !== 'Agent') return null;

  const toolInput = payload?.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return null;
  const prompt = toolInput.prompt;
  if (typeof prompt !== 'string' || prompt === '') return null;
  // Idempotency guard: a retried call, or a second PreToolUse hook on the
  // same tool_name, must not stack the appendix onto itself.
  if (prompt.includes(DELEGATION_MARKER)) return null;

  const appendix = await buildAppendix(payload, { cfg, home });
  if (!appendix) return null;

  return { updatedInput: { ...toolInput, prompt: `${prompt}\n\n${appendix}` } };
}

/**
 * The decision rendered as the JSON Claude Code expects on stdout.
 *
 * `updatedInput` sits directly under `hookSpecificOutput`, which is the shape a
 * live session actually honours: with the hook registered on Task|Agent, a
 * delegated subagent quoted back the last line of the appended block verbatim,
 * so the rewritten prompt is what reached it. The shape is still written in
 * exactly one place, so a future contract change means editing this function
 * only.
 *
 * No `permissionDecision` is sent. Rewriting a prompt is not a judgement
 * about whether the call should be allowed, and answering `allow` here would
 * quietly settle a permission question the user may have wanted to see. The
 * hook states its opinion on the input and stays silent on the decision.
 */
export function formatHookOutput(decision) {
  if (!decision) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: decision.updatedInput,
    },
  });
}
