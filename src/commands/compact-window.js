/**
 * Subcommand: compact-window — audit / pin Claude Code's `autoCompactWindow`.
 *   claude-token-saver compact-window                      # status
 *   claude-token-saver compact-window set --global         # pin 400k in ~/.claude/settings.json
 *   claude-token-saver compact-window set --project        # pin 400k in <root>/.claude/settings.json
 *   claude-token-saver compact-window set --global --value 250k
 *   claude-token-saver compact-window off | on             # toggle the statusline warning
 *
 * Scope is deliberately explicit for `set`: writing a global settings.json is
 * not something to guess at, and the non-TTY hook environment cannot prompt.
 */

export async function run({ args, hasFlag }) {
  const sub = args[1];
  const cw = await import('../compact-window.js');
  const { findProjectRoot } = await import('../harness.js');
  const { loadConfig, saveConfig, userLanguage } = await import('../config.js');
  const lang = userLanguage();
  const root = findProjectRoot();
  const ko = lang === 'ko';
  const fmt = (n) => (n === null || n === undefined ? '-' : `${Math.round(n / 1000)}k`);

  if (sub === 'off' || sub === 'on') {
    const cfg = loadConfig();
    cfg.compactWindow = cfg.compactWindow || {};
    cfg.compactWindow.enabled = sub === 'on';
    saveConfig(cfg);
    console.log(`Statusline compact-window warning: ${sub}`);
    return;
  }

  if (sub === 'set') {
    const scope = hasFlag('--global') ? 'global' : hasFlag('--project') ? 'project' : null;
    if (!scope) {
      console.error(ko
        ? '적용 범위를 명시하세요 (사용자에게 먼저 확인): --global (~/.claude/settings.json) 또는 --project (<root>/.claude/settings.json)'
        : 'Scope required: --global (~/.claude/settings.json) or --project (<root>/.claude/settings.json)');
      process.exit(1);
    }
    const argv = args.slice(2);
    const i = argv.indexOf('--value');
    const eq = argv.find((a) => a.startsWith('--value='));
    const raw = i !== -1 && argv[i + 1] ? argv[i + 1] : (eq ? eq.slice('--value='.length) : null);
    const r = cw.setAutoCompactWindow({ root, scope, value: raw ?? cw.RECOMMENDED_WINDOW });
    if (!r.ok) { console.error(`❌ ${r.error}`); process.exit(1); }
    console.log(`✅ autoCompactWindow = ${r.value} (${fmt(r.value)}) → ${r.path} [${r.scope}]`);
    if (r.previous !== null && r.previous !== undefined) console.log(`   previous: ${r.previous}`);
    if (r.backup) console.log(`   backup:   ${r.backup}`);
    // The env var beats settings.json, so a stale export silently defeats the
    // write we just made — say so instead of letting the user wonder.
    if (process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) {
      console.log(ko
        ? `\n⚠ 셸에 CLAUDE_CODE_AUTO_COMPACT_WINDOW=${process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW} 가 설정돼 있어 settings.json보다 우선합니다. unset 하세요.`
        : `\n⚠ CLAUDE_CODE_AUTO_COMPACT_WINDOW=${process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW} is exported and takes precedence over settings.json. Unset it.`);
    }
    console.log(ko ? '\n새 세션부터 적용됩니다.' : '\nApplies from the next session.');
    return;
  }

  if (!sub || sub === 'status' || sub === 'check') {
    const s = cw.compactWindowStatus({ root });
    console.log(`model:  ${s.model || '(not set — Claude Code default)'}${s.modelSource ? ` [${s.modelSource}]` : ''}`);
    console.log(`window: ${s.is1m ? '1M context' : '200k context'}`);
    console.log(`autoCompactWindow: ${s.window === null ? '(unset)' : `${s.window} (${fmt(s.window)})`}${s.windowSource ? ` [${s.windowSource}${s.windowPath ? ` → ${s.windowPath}` : ''}]` : ''}`);
    if (s.ok && s.reason === 'not-1m') {
      console.log(ko
        ? '\n✅ 200k 컨텍스트라 이 설정은 영향이 없습니다 (워닝 대상 아님).'
        : '\n✅ 200k context — this setting changes nothing here (not warned).');
      return;
    }
    if (s.ok) {
      console.log(ko ? '\n✅ 압축 창이 400k 이하로 고정돼 있습니다.' : '\n✅ Compaction window is pinned at or below 400k.');
      return;
    }
    console.log(ko
      ? `\n⚠ 1M 컨텍스트인데 autoCompactWindow가 ${s.reason === 'unset' ? '설정되지 않았습니다' : `${fmt(s.window)}로 너무 큽니다`} — 자동 압축이 80만 토큰 근처에서야 걸립니다.`
      : `\n⚠ 1M context with autoCompactWindow ${s.reason === 'unset' ? 'unset' : `at ${fmt(s.window)}`} — compaction only fires near 800k.`);
    console.log(ko
      ? '  그 전까지 모든 요청이 전체 컨텍스트를 재과금합니다. 40만으로 고정하면 1M 창은 유지하면서 압축 시점만 앞당깁니다.'
      : '  Until then every request re-bills the whole context. Pinning 400k keeps the 1M window while capping the runaway tail.');
    console.log('\n  claude-token-saver compact-window set --global     (~/.claude/settings.json)');
    console.log('  claude-token-saver compact-window set --project    (<root>/.claude/settings.json)');
    console.log(ko ? '  (적용 범위는 사용자에게 먼저 확인할 것)' : '  (confirm the scope with the user first)');
    return;
  }

  console.error(`Unknown compact-window subcommand: ${sub}`);
  console.error('Usage: claude-token-saver compact-window [status|set --global|--project [--value 400k]|off|on]');
  process.exit(1);
}
