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
 * Scope: this lifts the IntelliJ guard and nothing else. It is not a general
 * "always icons" switch, and outside IntelliJ it is never consulted — there is
 * no guard there to lift, and `icon` / `text` already own that choice. Letting
 * it win everywhere would mean `sprag mode text` could no longer turn icons off
 * while it was set, which is a worse trade than the narrow name.
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
 * The user's stored label preference, as one of the three modes.
 *
 * `labels` is the current key. Configs written before it existed carry a boolean
 * `icon` instead, so that is read as a fallback: absent means icons, since icons
 * are the default for a fresh install.
 */
export function labelPreference(cfg = {}) {
  if (cfg.labels === 'icon' || cfg.labels === 'narrow' || cfg.labels === 'text') return cfg.labels;
  return cfg.icon === false ? 'text' : 'icon';
}

/**
 * Resolve the label mode.
 *
 * @param {object} opts
 * @param {(name: string) => boolean} [opts.hasFlag] argv accessor
 * @param {object} [opts.cfg] statuslineDefaults() result
 * @param {object} [opts.env] environment to read
 * @returns {{ mode: 'icon'|'narrow'|'text', reason: string }} `reason` names the rule
 *   that decided, so `sprag mode` can explain a downgrade instead of leaving
 *   the user to guess why `--icon` did nothing. One of `flag:--no-icon`,
 *   `flag:--text`, `flag:--narrow`, `intellij-narrow`, `intellij-forced`,
 *   `flag:--icon`, `config`.
 *
 * Precedence: explicit opt-out, then the IntelliJ guard (and the escape hatch
 * out of it, which applies only there), then `--icon`, then persisted config.
 */
export function resolveLabelMode({ hasFlag = () => false, cfg = {}, env = process.env } = {}) {
  // An explicit opt-out wins everywhere. Nothing below should talk a user out
  // of the mode they just asked for. The two flags are reported separately so
  // the diagnostic line names the flag the user actually typed.
  if (hasFlag('--no-icon')) return { mode: 'text', reason: 'flag:--no-icon' };
  if (hasFlag('--text')) return { mode: 'text', reason: 'flag:--text' };
  if (hasFlag('--narrow')) return { mode: 'narrow', reason: 'flag:--narrow' };
  const pref = labelPreference(cfg);
  if (isJetBrainsTerminal(env)) {
    // Emoji on request, accepting that they garble here.
    if (iconForceRequested({ cfg, env })) return { mode: 'icon', reason: 'intellij-forced' };
    // Someone who asked for plain text gets plain text.
    if (pref === 'text') return { mode: 'text', reason: 'config' };
    // Otherwise narrow: the glyphs still mark each chip, and every one of them
    // is a character the IDE font actually has, so the line does not garble.
    return { mode: 'narrow', reason: 'intellij-narrow' };
  }
  if (hasFlag('--icon')) return { mode: 'icon', reason: 'flag:--icon' };
  return { mode: pref, reason: 'config' };
}
