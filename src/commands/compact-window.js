/**
 * Subcommand: compact-window — audit / pin Claude Code's `autoCompactWindow`.
 *   sprag compact-window                      # status
 *   sprag compact-window set --global --all-models              # 500k for every model in ~/.claude/settings.json
 *   sprag compact-window set --project --all-models             # same, in <root>/.claude/settings.json
 *   sprag compact-window set --global --model claude-opus-5-5   # 500k for that model only
 *   sprag compact-window set --global --all-models --value 600k
 *   sprag compact-window off | on             # toggle the statusline chip and the session briefing
 *
 * Scope and models are deliberately explicit for `set`: writing a global
 * settings.json is not something to guess at, and the non-TTY hook environment
 * cannot prompt. `--all-models` writes the top-level key and removes per-model
 * values in that file so one value really applies everywhere; `--model <id>`
 * writes only that model's `modelSettings` entry, the slot `/autocompact` uses.
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
    console.log(`Compact-window warning (statusline chip and session briefing): ${sub}`);
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
    const flagValue = (name) => {
      const i = argv.indexOf(name);
      const eq = argv.find((a) => a.startsWith(`${name}=`));
      return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (eq ? eq.slice(name.length + 1) : null);
    };
    const raw = flagValue('--value');
    const model = flagValue('--model');
    const all = hasFlag('--all-models');
    if (all === !!model) {
      console.error(ko
        ? '적용할 모델을 하나만 고르세요 (사용자에게 먼저 확인): --all-models (모든 모델에 같은 값, 같은 파일의 모델별 값은 지웁니다) 또는 --model <모델 id> (그 모델에만, 예: claude-opus-5-5)'
        : 'Pick exactly one (confirm with the user first): --all-models (one value for every model; per-model values in that file are removed) or --model <model id> (that model only, e.g. claude-opus-5-5)');
      console.error(`  ${cw.modelSettingsNotice(cw.claudeCodeVersion(), ko)}`);
      process.exit(1);
    }
    const r = cw.setAutoCompactWindow({ root, scope, value: raw ?? cw.RECOMMENDED_WINDOW, models: all ? 'all' : model });
    if (!r.ok) { console.error(`❌ ${r.error}`); process.exit(1); }
    const slot = r.modelKey ? `modelSettings.${r.modelKey}.autoCompactWindow` : 'autoCompactWindow';
    console.log(`✅ ${slot} = ${r.value} (${fmt(r.value)}) → ${r.path} [${r.scope}]`);
    if (r.previous !== null && r.previous !== undefined) console.log(`   previous: ${r.previous}`);
    if (r.backup) console.log(`   backup:   ${r.backup}`);
    // An older Claude Code ignores modelSettings, so the write above would do
    // nothing there. Name the installed version either way.
    if (r.modelKey) {
      const version = cw.claudeCodeVersion();
      console.log(`\n${cw.modelSettingsSupported(version) === false ? '⚠' : 'ℹ'} ${cw.modelSettingsNotice(version, ko)}`);
    }
    // --all-models: a per-model entry would have beaten the top-level key for
    // its model, so those were removed. Say which, so nothing changes silently.
    for (const { key, value } of r.removed || []) {
      console.log(ko
        ? `   removed:  modelSettings.${key}.autoCompactWindow (${value}). 모든 모델에 같은 값을 쓰도록 지웠습니다.`
        : `   removed:  modelSettings.${key}.autoCompactWindow (${value}) so every model uses the same value.`);
    }
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
    // The statusline knows the real window; the settings model id often does
    // not (a bare `opus` carries no `[1m]`), so the last reported size decides.
    let liveWindow = null;
    try { liveWindow = (await import('../ctx-window-cache.js')).latestLiveWindow(); } catch { /* id-only fallback */ }
    let liveModel = null;
    try { liveModel = (await import('../ctx-window-cache.js')).latestLiveModel(); } catch { /* settings model fallback */ }
    const s = cw.compactWindowStatus({ root, liveWindow, liveModel });
    console.log(`model:  ${s.model || '(not set — Claude Code default)'}${s.modelSource ? ` [${s.modelSource}]` : ''}`);
    console.log(`window: ${s.is1m ? '1M context' : '200k context'}${liveWindow ? ` [statusline: ${liveWindow >= 1e6 ? `${liveWindow / 1e6}M` : fmt(liveWindow)}]` : ''}`);
    const winText = s.windowAuto ? 'auto (model default)' : s.window === null ? '(unset)' : `${s.window} (${fmt(s.window)})`;
    const keyText = s.windowModelKey ? `, modelSettings.${s.windowModelKey}` : '';
    console.log(`autoCompactWindow: ${winText}${s.windowSource ? ` [${s.windowSource}${s.windowPath ? ` → ${s.windowPath}` : ''}${keyText}]` : ''}`);
    if (s.ok && s.reason === 'not-1m') {
      console.log(ko
        ? '\n✅ 200k 컨텍스트라 이 설정은 영향이 없습니다 (워닝 대상 아님).'
        : '\n✅ 200k context — this setting changes nothing here (not warned).');
      return;
    }
    if (s.ok && s.reason === 'auto') {
      console.log(ko
        ? '\n✅ /autocompact auto 로 모델 기본값을 직접 고른 상태라 경고하지 않습니다.'
        : '\n✅ "auto" was chosen with /autocompact auto, so the model default is left alone (not warned).');
      return;
    }
    if (s.ok) {
      console.log(ko
        ? `\n✅ 압축 창이 권장 범위(${fmt(s.recommendedMin)}~${fmt(s.recommendedMax)}) 상한 이하입니다.`
        : `\n✅ Compaction window is at or below the top of the recommended ${fmt(s.recommendedMin)}–${fmt(s.recommendedMax)} band.`);
      return;
    }
    console.log(ko
      ? `\n⚠ 1M 컨텍스트인데 autoCompactWindow가 ${s.reason === 'unset' ? '설정되지 않았습니다' : `${fmt(s.window)}로 너무 큽니다`}. 자동 압축이 약 97만 토큰에서야 걸립니다.`
      : `\n⚠ 1M context with autoCompactWindow ${s.reason === 'unset' ? 'unset' : `at ${fmt(s.window)}`} — compaction only fires near 967k.`);
    console.log(ko
      ? `  그 전까지 모든 요청이 전체 컨텍스트를 재과금합니다. 1M은 너무 크니 ${fmt(s.recommendedMin)}~${fmt(s.recommendedMax)} 범위를 권장합니다 (기본값 ${fmt(s.recommended)}, --value로 조절). 1M 창 자체는 그대로 두고 압축 시점만 앞당깁니다.`
      : `  Until then every request re-bills the whole context. 1M is too large — pick something in ${fmt(s.recommendedMin)}–${fmt(s.recommendedMax)} (default ${fmt(s.recommended)}, override with --value). The 1M window itself stays.`);
    console.log(`\n  sprag compact-window set --global --all-models     (~/.claude/settings.json, ${fmt(s.recommended)})`);
    console.log(`  sprag compact-window set --project --all-models    (<root>/.claude/settings.json, ${fmt(s.recommended)})`);
    console.log(`  sprag compact-window set --global --model ${cw.canonicalModelId(s.windowModelKey || s.model) || 'claude-opus-5-5'}   (${ko ? '그 모델에만' : 'that model only'})`);
    console.log(`  sprag compact-window set --global --all-models --value ${fmt(s.recommendedMax)}`);
    console.log(`  ${cw.modelSettingsNotice(cw.claudeCodeVersion(), ko)}`);
    console.log(ko ? '  (적용 범위와 모델 범위는 사용자에게 먼저 확인할 것)' : '  (confirm the scope and the models with the user first)');
    return;
  }

  console.error(`Unknown compact-window subcommand: ${sub}`);
  console.error('Usage: sprag compact-window [status|set --global|--project [--value 500k]|off|on]');
  process.exit(1);
}
