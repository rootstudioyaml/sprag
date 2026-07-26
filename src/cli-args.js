/**
 * argv accessors shared by every subcommand.
 *
 * `createArgs(argv)` binds them to one argument list, so a subcommand module
 * takes them as a parameter instead of reaching for a module-level global —
 * which also makes them directly testable.
 */

export function createArgs(argv) {
  const args = argv;

  function getArg(name) {
    const idx = args.indexOf(name);
    if (idx !== -1) return args[idx + 1];
    const prefix = `${name}=`;
    const eq = args.find((a) => a.startsWith(prefix));
    if (eq) return eq.slice(prefix.length);
    return undefined;
  }

  function hasFlag(name) {
    return args.includes(name);
  }

  /**
   * Read a numeric option, rejecting garbage instead of letting NaN flow into
   * the report window. `--days abc` used to render as `NaNd` on the statusline
   * and as a bare "no session data" in the table view — a typo that looked
   * exactly like "you have no logs".
   *
   * @param {string} name flag name, e.g. '--days'
   * @param {object} [opts]
   * @param {number} [opts.dflt] value when the flag is absent
   * @param {number} [opts.min] inclusive lower bound
   * @param {number} [opts.max] inclusive upper bound
   * @throws {Error} on a non-numeric or out-of-range value
   */
  function numArg(name, { dflt, min, max } = {}) {
    const raw = getArg(name);
    if (raw === undefined) return dflt;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`${name} expects a number, got "${raw}"`);
    }
    if (min !== undefined && n < min) throw new Error(`${name} must be >= ${min}, got ${n}`);
    if (max !== undefined && n > max) throw new Error(`${name} must be <= ${max}, got ${n}`);
    return n;
  }

  return { args, getArg, hasFlag, numArg };
}
