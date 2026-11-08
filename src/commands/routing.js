/**
 * Subcommand: routing — master switch for model delegation.
 *
 *   sprag routing            # status
 *   sprag routing on|off     # turn every delegation path on or off
 *   sprag routing grade [quality|cost]   # show or set the delegation grade
 *   sprag routing effort-hint on|off     # the effort line for low/medium sessions on judgement requests
 *
 * Off removes the delegation rules from ratchet-model.md and the preset
 * ratchet, the per-prompt route hint, and the route-scan candidate and
 * rule-health briefings. Registered rules stay in the registry.
 */

export async function run({ args }) {
  const sub = args[1];
  const { userLanguage } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const { routingEnabled, setRoutingEnabled, delegationGrade, setDelegationGrade, normalizeDelegationGrade, gradeLabel, DELEGATION_GRADES, effortHintEnabled, setEffortHint } = await import('../routing-switch.js');

  const rules = async () => (await import('../model-rules.js')).loadModelRules().rules.length;
  // Re-render the files that carry delegation text so the change shows without
  // waiting for the next session start. Each step may fail on its own.
  const resync = async () => {
    try {
      const { findProjectRoot } = await import('../harness.js');
      (await import('../model-rules.js')).syncAllFiles({ roots: [findProjectRoot()] });
    } catch { /* the next session start re-renders */ }
    try { (await import('../preset-ratchet.js')).syncPresetRatchet(); } catch { /* the next session start re-renders */ }
  };

  if (sub === 'off') {
    setRoutingEnabled(false);
    await resync();
    const n = await rules().catch(() => 0);
    console.log(ko ? '✓ 모델 위임을 껐습니다.' : '✓ Model delegation is off.');
    console.log(ko
      ? '다음 세션부터 위임 룰과 프롬프트 힌트와 후보 안내가 빠집니다.'
      : 'From the next session, delegation rules, prompt hints and candidate notices are left out.');
    console.log(ko
      ? `등록된 룰 ${n}건은 보관됩니다. 다시 켜면 그대로 적용됩니다.`
      : `The ${n} registered rule(s) are kept and apply again when you turn routing back on.`);
    console.log(ko
      ? '위임 에이전트 파일까지 지우려면 sprag delegate agents off 를 쓰십시오.'
      : 'To remove the delegation agent files too, run: sprag delegate agents off');
    return;
  }

  if (sub === 'on') {
    setRoutingEnabled(true);
    await resync();
    console.log(ko ? '✓ 모델 위임을 켰습니다.' : '✓ Model delegation is on.');
    console.log(ko
      ? '다음 세션부터 위임 룰과 프롬프트 힌트와 후보 안내가 적용됩니다.'
      : 'From the next session, delegation rules, prompt hints and candidate notices apply.');
    return;
  }

  if (sub === 'grade') {
    const want = args[2];
    if (want === undefined) {
      const g = delegationGrade();
      console.log(`grade: ${g} (${gradeLabel(g, ko ? 'ko' : 'en')})`);
      return;
    }
    const stored = normalizeDelegationGrade(want);
    if (stored === null) {
      console.error(`Usage: sprag routing grade [${DELEGATION_GRADES.join('|')}]`);
      process.exitCode = 2;
      return;
    }
    // balanced and saving were grades of an earlier version; they are accepted
    // and stored as the grade that replaced them.
    if (stored !== want) {
      console.error(ko
        ? `경고: ${want} 등급은 없어졌습니다. ${gradeLabel(stored, 'ko')}(${stored})으로 저장합니다.`
        : `Warning: the ${want} grade no longer exists; storing ${stored}.`);
    }
    setDelegationGrade(stored);
    await resync();
    console.log(ko ? `✓ 위임 등급을 ${gradeLabel(stored, 'ko')}(${stored})으로 바꿨습니다.` : `✓ Delegation grade is now ${stored}.`);
    console.log(ko
      ? '프롬프트 힌트는 바로, ratchet-model.md는 방금 다시 썼습니다.'
      : 'Prompt hints change at once; ratchet-model.md was just rewritten.');
    return;
  }

  if (sub === 'effort-hint') {
    const want = args[2];
    if (want !== 'on' && want !== 'off') {
      console.error('Usage: sprag routing effort-hint on|off');
      process.exitCode = 2;
      return;
    }
    setEffortHint(want === 'on');
    console.log(want === 'on'
      ? (ko ? '✓ effort 안내를 켰습니다. 판단형 요청에서 세션 effort가 low나 medium이면 한 번 안내합니다.' : '✓ Effort hint is on. A low or medium effort session is told once on a judgement request.')
      : (ko ? '✓ effort 안내를 껐습니다.' : '✓ Effort hint is off.'));
    return;
  }

  if (sub === undefined || sub === 'status') {
    const on = routingEnabled();
    const n = await rules().catch(() => 0);
    let agentsOn = true;
    try { agentsOn = (await import('../delegation-agents.js')).delegationAgentStatus().enabled; } catch { /* default on */ }
    console.log(`routing: ${on ? 'on' : 'off'}`);
    const grade = delegationGrade();
    console.log(`grade: ${grade} (${gradeLabel(grade, ko ? 'ko' : 'en')})`);
    console.log(`effort hint: ${effortHintEnabled() ? 'on' : 'off'}`);
    console.log(ko ? `등록된 룰: ${n}건` : `registered rules: ${n}`);
    console.log(`delegate agents: ${agentsOn ? 'on' : 'off'}`);
    console.log(ko
      ? (on ? '끄기: sprag routing off' : '켜기: sprag routing on')
      : (on ? 'Disable with: sprag routing off' : 'Enable with: sprag routing on'));
    return;
  }

  console.log('Usage: sprag routing on|off|status|grade [quality|cost]|effort-hint on|off');
  process.exitCode = 1;
}
