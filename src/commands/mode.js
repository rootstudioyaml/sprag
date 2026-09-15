/**
 * Subcommand: mode — persist statusline preferences so future runs pick
 * them up without flags or wrapper edits.
 *   sprag mode                    # show current config
 *   sprag mode icon verbose       # set icon + verbose
 *   sprag mode reset              # clear back to defaults
 */


export async function run({ args }) {
    const { applyMode, loadConfig, configPath, statuslineDefaults, userLanguage, VALID_KEYWORDS } =
      await import('../config.js');
    const { resolveLabelMode, isJetBrainsTerminal } = await import('../statusline-mode.js');
    const words = args.slice(1);
    if (words.length === 0) {
      const eff = statuslineDefaults();
      const raw = loadConfig();
      console.log('Statusline (effective):');
      console.log(`  labels:  ${eff.labels}`);
      // What renders can differ from the stored preference: inside IntelliJ the
      // emoji set steps down to narrow glyphs, because the IDE font lacks the
      // emoji and the fallback breaks the cell grid. Saying so here is the
      // difference between a two-second answer and a hunt through the source for
      // why `--icon` appeared to do nothing.
      const { mode: labelMode, reason } = resolveLabelMode({ cfg: eff });
      if (labelMode !== eff.labels) {
        const why = reason === 'intellij-narrow'
          ? ' (IntelliJ: emoji garble in the IDE font. `sprag mode icon-force` keeps them anyway)'
          : reason === 'intellij-forced'
            ? ' (icon-force)'
            : '';
        console.log(`  renders: ${labelMode}${why}`);
      }
      console.log(`  icon-force: ${eff.iconForce}`);
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
      console.log('Change with: sprag mode <keywords...>');
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
    console.log(`Now: labels=${eff.labels} icon-force=${eff.iconForce} verbose=${eff.verbose} timer=${eff.timer} color=${eff.color} window=${eff.windowLabel} language=${userLanguage()}`);
    const { mode: renders } = resolveLabelMode({ cfg: eff });
    if (renders !== eff.labels) {
      console.log(`Renders as: ${renders}${isJetBrainsTerminal() ? ' (IntelliJ detected)' : ''}`);
    }
    console.log('Statusline picks up the change on the next refresh (~1s).');
    return;
}
