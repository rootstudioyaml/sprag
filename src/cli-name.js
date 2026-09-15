/**
 * cli-name — the name this tool tells the user to type.
 *
 * One definition, because the alternative was measured: the marker string in the
 * release scripts lived in two files, one was renamed, and the gate that grepped
 * for the other silently stopped gating. A command name printed for the user to
 * copy fails more quietly still — nothing errors, the user simply types a name
 * that is not the package they installed.
 *
 * `sprag-cli` is the package; `claude-token-saver` is the deprecated name it
 * shipped under, and both binaries are still in `package.json`'s `bin`, so the
 * old name keeps working for anyone whose settings or notes carry it.
 *
 * NOT the same thing as the on-disk identifiers. The state directory, the harness
 * block markers, and the skill directory are all still spelled with the old name
 * on purpose: renaming those would orphan existing users' ledgers and stop the
 * harness markers matching text already in their CLAUDE.md. Those are addresses,
 * not instructions, and an address only has to be stable.
 */

/** The command name to print in anything a user is expected to type or read. */
export const CLI_NAME = 'sprag';

/** The deprecated name. Still a working binary; recognised, never printed. */
export const LEGACY_CLI_NAME = 'claude-token-saver';
