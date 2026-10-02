/**
 * Whether the npm `postinstall` step should run `sprag install`.
 *
 * `install` writes hooks and a statusline into ~/.claude/settings.json, and
 * those call the `sprag` binary by name. That is what someone who typed
 * `npm i -g sprag-cli` asked for. The script ran for every other install too:
 * a project that lists the package as a dependency, the `npx` cache, a CI job,
 * `npm install` in a checkout of this repository. None of those put `sprag` on
 * PATH, so the hooks they registered pointed at a command that is not there,
 * and a CI runner had its home directory rewritten for nothing.
 *
 * So setup runs only where it was asked for:
 *   - never in CI;
 *   - with npm, only for a global install (npm says so in `npm_config_global`);
 *   - with another package manager, as before: pnpm and bun do not run this
 *     script unless the user allowed it, and neither they nor yarn report a
 *     global install in a way worth guessing at.
 * `SPRAG_POSTINSTALL=1` forces it and `SPRAG_POSTINSTALL=0` skips it.
 */

const truthy = (v) => typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

export function postinstallDecision(env = process.env) {
  if (env.SPRAG_POSTINSTALL === '1') return { run: true, reason: 'SPRAG_POSTINSTALL=1' };
  if (env.SPRAG_POSTINSTALL === '0') return { run: false, reason: 'SPRAG_POSTINSTALL=0' };
  if (truthy(env.CI)) return { run: false, reason: 'CI environment' };
  const agent = String(env.npm_config_user_agent || '');
  if (/^npm\//.test(agent) && env.npm_config_global !== 'true') {
    return { run: false, reason: 'not a global install' };
  }
  return { run: true, reason: /^npm\//.test(agent) ? 'global install' : 'package manager does not report scope' };
}
