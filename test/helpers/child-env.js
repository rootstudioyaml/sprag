/**
 * The environment a spawned child gets when a test drives the real CLI.
 *
 * These tests used to spread the ambient environment into the child, so every
 * variable this tool reads arrived from whatever shell happened to run the
 * suite. That makes a green suite a property of the terminal rather than of the
 * tree: inside IntelliJ, TERMINAL_EMULATOR reaches the child, statusline-mode.js
 * steps the labels down to the narrow set, and the five effort/ultracode tests
 * that pin the 🔬 chip fail on code that is correct. v3.50.0 records the same
 * shape once already — COLORTERM reaching the gauge tests, green in CI and red
 * on the machine that ran the release — which is why this is one shared helper
 * rather than a third local patch.
 *
 * So the child starts from the ambient environment minus every name the tool
 * reads, and the caller adds back exactly what its case is about. SCRUBBED is
 * that list and child-env.test.js keeps it honest against the source, so a new
 * `process.env` read cannot quietly reopen the hole.
 *
 * What is deliberately left alone: PATH, the platform's own variables, and
 * anything else nothing here reads. A child that cannot find node, a shell or a
 * temp directory is a different kind of broken, and scrubbing by name means the
 * list says which variables are inputs to the tool.
 */

/**
 * Every environment variable src/, bin/ and scripts/ read. Sorted, so a new
 * entry lands where a reader looks for it.
 */
export const SCRUBBED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
  'APPDATA',
  'CACHE_MONITOR_EXCLUDE_SESSION',
  'CI',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'COLORTERM',
  'CTS_DEBUG',
  'CTS_DOC2MD_NO_AUTOINSTALL',
  'CTS_DOC2MD_PYTHON',
  'CTS_LANG',
  'CTS_NO_DOC2MD',
  'CTS_NO_HARNESS',
  'CTS_NO_INPUT',
  'CTS_NO_KOREAN',
  'CTS_NO_NOTE',
  'CTS_NO_UPDATE_CHECK',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_MESSAGES',
  'NO_COLOR',
  'NO_UPDATE_NOTIFIER',
  'NPM_TOKEN',
  'SPRAG_ICON',
  'TERMINAL_EMULATOR',
  'UPLOAD_DEST',
  'UPLOAD_PORT',
  'UPLOAD_TOKEN',
  'XDG_CONFIG_HOME',
];

/**
 * Names that must never be scrubbed, with the reason each one is safe.
 *
 * HOME and USERPROFILE are not read through `process.env` here — homedir()
 * reads them for us — and removing them does not isolate anything: POSIX
 * homedir() falls back to the passwd entry, so a child with no HOME reads the
 * real ~/.claude of whoever ran the suite. Every caller therefore states its
 * own HOME and childEnv() refuses to build an environment without one.
 */
export const NEVER_SCRUBBED = ['HOME', 'USERPROFILE'];

const SCRUBBED_SET = new Set(SCRUBBED);

/**
 * Build the child environment. `overrides.HOME` is required; a value of
 * `undefined` for any other key removes it, which is how a case says "not set"
 * without reaching for `delete` afterwards.
 */
export function childEnv(overrides = {}) {
  if (!overrides.HOME) {
    throw new Error('childEnv({ HOME }) is required: without it the child reads the real home directory');
  }
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SCRUBBED_SET.has(key)) env[key] = value;
  }
  /* A spawned CLI must never wait on a terminal. Non-TTY stdio already settles
     this, but stating it means a test that does hand the child a TTY cannot
     hang the suite. A caller that is testing the prompt itself overrides it. */
  env.CTS_NO_INPUT = '1';
  /* Windows resolves the home through USERPROFILE, so a case that names only
     HOME means the same directory on both platforms. */
  env.USERPROFILE = overrides.HOME;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
