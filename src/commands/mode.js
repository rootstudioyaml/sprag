/**
 * Subcommand: mode — persist statusline preferences so future runs pick
 * them up without flags or wrapper edits.
 *   claude-token-saver mode                    # show current config
 *   claude-token-saver mode icon verbose       # set icon + verbose
 *   claude-token-saver mode reset              # clear back to defaults
 */


export async function run({ args }) {
    const { applyMode, loadConfig, configPath, statuslineDefaults, userLanguage, VALID_KEYWORDS } =
      await import('../config.js');
    const words = args.slice(1);
    if (words.length === 0) {
      const eff = statuslineDefaults();
      const raw = loadConfig();
      console.log('Statusline (effective):');
      console.log(`  icon:    ${eff.icon}`);
      console.log(`  verbose: ${eff.verbose}`);
      console.log(`  timer:   ${eff.timer}`);
      console.log(`  color:   ${eff.color}`);
      console.log(`  window:  ${eff.windowLabel} (${eff.windowHours}h)`);
      console.log(`  ttl:     ${eff.ttlBucket}${eff.ttlBucket === 'auto' ? ' (measured split, else gateway detection)' : ' (pinned)'}`);
      console.log('');
      console.log('Output language (advice / history / last):');
      console.log(`  language: ${userLanguage()}`);
      console.log('');
      console.log(`Stored config file (${configPath()}):`);
      console.log(`  ${Object.keys(raw).length === 0 ? '(none — using defaults)' : JSON.stringify(raw)}`);
      console.log('');
      console.log('Change with: claude-token-saver mode <keywords...>');
      console.log(`Keywords: ${VALID_KEYWORDS.join(', ')}`);
      return;
    }
    const { applied, unknown } = applyMode(words);
    if (unknown.length) {
      console.error(`Unknown keyword${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
      console.error(`Valid: ${VALID_KEYWORDS.join(', ')}`);
      process.exit(1);
    }
    const eff = statuslineDefaults();
    console.log(`Updated: ${applied.join(', ')}`);
    console.log(`Now: icon=${eff.icon} verbose=${eff.verbose} timer=${eff.timer} color=${eff.color} window=${eff.windowLabel} language=${userLanguage()}`);
    console.log('Statusline picks up the change on the next refresh (~1s).');
    return;
}
