/**
 * Subcommand: seed — register the bundled starter rules, one answer at a time.
 *
 *   claude-token-saver seed                          # what is still pending
 *   claude-token-saver seed accept <id> --global     # register one rule
 *   claude-token-saver seed accept <id> --project    # ... into this project only
 *   claude-token-saver seed accept all --global      # when the user says "all of them"
 *   claude-token-saver seed skip <id> | skip all     # never offer it again
 *   claude-token-saver seed reset                    # make every preset pending again
 *
 * Scope is explicit on purpose, exactly as `harness promote` requires it: the
 * hook environment is non-TTY, so the model has to ask the user and pass the
 * flag rather than let a default decide where a rule lands.
 */

export async function run({ args, hasFlag }) {
  const sub = args[1];
  const seed = await import('../seed-rules.js');
  const { userLanguage } = await import('../config.js');
  const { findProjectRoot } = await import('../harness.js');
  const lang = userLanguage();
  const ko = lang === 'ko';
  const root = findProjectRoot();

  const scopeFlag = () => (hasFlag('--global') ? 'global' : hasFlag('--project') ? 'project' : null);

  if (sub === 'reset') {
    const n = seed.resetSeeds();
    console.log(ko
      ? `기록된 응답 ${n}건을 지웠습니다 — 프리셋 전체가 다시 제안 대상이 됩니다.`
      : `Cleared ${n} recorded answer(s) — every preset is pending again.`);
    return;
  }

  if (sub === 'accept' || sub === 'skip') {
    const ids = args.slice(2).filter((a) => !a.startsWith('-'));
    if (ids.length === 0) {
      console.error(ko
        ? 'id를 지정하십시오 (목록: claude-token-saver seed). 전체는 `all`.'
        : 'Pass an id (list them with `claude-token-saver seed`), or `all`.');
      process.exit(1);
    }
    const pending = seed.pendingSeeds({ lang, root });
    const targets = ids.includes('all') ? pending.map((s) => s.id) : ids;

    if (sub === 'skip') {
      for (const id of targets) {
        const r = seed.skipSeed(id, { lang, root });
        console.log(r
          ? (ko ? `건너뜀: ${id}` : `skipped: ${id}`)
          : (ko ? `대기 중인 프리셋이 아닙니다: ${id}` : `not a pending preset: ${id}`));
      }
      return;
    }

    const scope = scopeFlag();
    if (!scope) {
      console.error(ko
        ? '적용 범위를 명시하십시오 (사용자에게 먼저 확인): --global 또는 --project'
        : 'Scope required (confirm it with the user first): --global or --project');
      process.exit(1);
    }
    for (const id of targets) {
      const r = await seed.acceptSeed(id, { scope, root, lang });
      if (!r) {
        console.log(ko ? `대기 중인 프리셋이 아닙니다: ${id}` : `not a pending preset: ${id}`);
        continue;
      }
      console.log(ko
        ? `✅ 등록: ${id} [${scope === 'global' ? '전체 프로젝트' : '이 프로젝트'}]`
        : `✅ registered: ${id} [${scope}]`);
      console.log(`   ${r.rule}`);
      for (const p of r.paths || (r.path ? [r.path] : [])) console.log(`   → ${p}`);
    }
    return;
  }

  // Default: status. Lists what is pending and what was already answered, so a
  // user who said no can see that they did and reverse it with `reset`.
  const pending = seed.pendingSeeds({ lang, root });
  const { decided } = seed.loadSeedState();
  const answered = Object.entries(decided);
  console.log(ko
    ? `seed — 동봉 프리셋 중 대기 ${pending.length}건, 응답 완료 ${answered.length}건`
    : `seed — ${pending.length} preset(s) pending, ${answered.length} already answered`);
  for (const s of pending) {
    const head = s.kind === 'model'
      ? `[${s.id}] ${s.tier} · "${s.label}" → ${s.agent}`
      : `[${s.id}] ${ko ? '랫쳇 룰' : 'ratchet rule'}`;
    console.log(`  ${head}`);
    console.log(`      ${s.ruleText}`);
  }
  if (answered.length > 0) {
    console.log(ko ? '  응답 기록:' : '  answered:');
    for (const [id, d] of answered) {
      console.log(`    ${id}: ${d.action}${d.scope ? ` (${d.scope})` : ''} — ${d.at}`);
    }
  }
  if (pending.length > 0) {
    console.log('');
    console.log(ko
      ? '등록: claude-token-saver seed accept <id> --global|--project   ·   거절: seed skip <id>'
      : 'register: claude-token-saver seed accept <id> --global|--project   ·   decline: seed skip <id>');
  }
}
