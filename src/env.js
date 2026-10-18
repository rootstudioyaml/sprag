/**
 * Reads a SPRAG_ environment variable, falling back to its legacy CTS_ name.
 *
 * The package used to be called claude-token-saver and its variables carried a
 * CTS_ prefix. Users still have those set in shells, CI and Claude Code managed
 * settings, so every read takes the SPRAG_ name first and the CTS_ name second.
 * Pass the suffix: envVar('NO_TEAM_SYNC') answers env.SPRAG_NO_TEAM_SYNC ??
 * env.CTS_NO_TEAM_SYNC.
 *
 * src/env.cjs is the CommonJS twin for the .cjs files; test/env.test.js pins
 * the two together.
 *
 * @param {string} name the variable name without its prefix
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function envVar(name, env = process.env) {
  return env['SPRAG_' + name] ?? env['CTS_' + name];
}
