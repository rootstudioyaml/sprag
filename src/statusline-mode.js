/**
 * Statusline label-mode resolution — the single place that decides icon vs text.
 *
 * The real statusline path and the `--demo` path both route through here. They
 * used to carry separate copies of the decision and the copies drifted: only
 * the real path applied the IntelliJ guard, so inside IntelliJ
 * `--statusline --demo` rendered emoji while the actual statusline rendered
 * plain text. That gap makes our own deliberate downgrade look like a terminal
 * bug, and it cost a full diagnosis session to rule out.
 */

const JETBRAINS_TERMINAL = 'JetBrains-JediTerm';

/**
 * IntelliJ's built-in terminal sets this for every shell it opens, whether or
 * not the Claude Code plugin is involved.
 */
export function isJetBrainsTerminal(env = process.env) {
  return env.TERMINAL_EMULATOR === JETBRAINS_TERMINAL;
}

/**
 * Whether the user has explicitly asked for icons inside IntelliJ regardless.
 *
 * The guard below exists for the IntelliJ Claude Code *plugin*, whose
 * statusline widget fuses consecutive frames at the character level when emoji
 * are present ("59:548"). JediTerm itself renders our output cleanly, so a user
 * who runs `claude` straight in the built-in terminal loses icons for a bug
 * that cannot reach them. TERMINAL_EMULATOR alone cannot tell the two apart,
 * so the escape hatch is explicit rather than inferred:
 *
 *   SPRAG_ICON=force            one-off, e.g. while checking a render
 *   sprag mode icon-force       persisted, so wrappers that hardcode --icon
 *                               do not have to be edited
 */
export function iconForceRequested({ cfg = {}, env = process.env } = {}) {
  const raw = String(env.SPRAG_ICON ?? '').trim().toLowerCase();
  if (raw === 'force') return true;
  return cfg.iconForce === true;
}

/**
 * Resolve the label mode.
 *
 * @param {object} opts
 * @param {(name: string) => boolean} [opts.hasFlag] argv accessor
 * @param {object} [opts.cfg] statuslineDefaults() result
 * @param {object} [opts.env] environment to read
 * @returns {{ mode: 'icon'|'text', reason: string }} `reason` names the rule
 *   that decided, so `sprag mode` can explain a downgrade instead of leaving
 *   the user to guess why `--icon` did nothing.
 */
export function resolveLabelMode({ hasFlag = () => false, cfg = {}, env = process.env } = {}) {
  // An explicit opt-out wins everywhere. Nothing below should talk a user out
  // of the mode they just asked for.
  if (hasFlag('--no-icon') || hasFlag('--text')) {
    return { mode: 'text', reason: 'flag:--text' };
  }
  if (isJetBrainsTerminal(env)) {
    if (!iconForceRequested({ cfg, env })) {
      return { mode: 'text', reason: 'intellij-guard' };
    }
    return { mode: 'icon', reason: 'intellij-forced' };
  }
  if (hasFlag('--icon')) return { mode: 'icon', reason: 'flag:--icon' };
  return { mode: cfg.icon ? 'icon' : 'text', reason: 'config' };
}
