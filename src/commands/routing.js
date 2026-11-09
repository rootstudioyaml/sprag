/**
 * Subcommand: routing — master switch for model delegation.
 *
 *   sprag routing            # status
 *   sprag routing on|off     # turn every delegation path on or off
 *   sprag routing relax [off]            # widen delegation until the busiest usage window resets, or end that early
 *   sprag routing effort-hint on|off     # the effort line for low/medium sessions on judgement requests
 *   sprag routing impl on|off            # the reminder to hand multi-file implementation to a worker
 *
 * Off removes the delegation rules from ratchet-model.md and the preset
 * ratchet, the per-prompt route hint, and the route-scan candidate and
 * rule-health briefings. Registered rules stay in the registry.
 */

export async function run({ args }) {
  const sub = args[1];
  const { userLanguage } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const { routingEnabled, setRoutingEnabled, isRelaxed, relaxUntil, setRelaxUntil, relaxClock, effortHintEnabled, setEffortHint, implementationFollowUpEnabled, setImplementationFollowUp } = await import('../routing-switch.js');

  // The reset of the busiest usage window in the statusline snapshot, in epoch
  // ms; five hours from now when the snapshot is missing, stale or has no reset.
  const relaxDeadline = async () => {
    const fallback = Date.now() + 5 * 60 * 60 * 1000;
    try {
      const { capPressure } = await import('../caps-cache.js');
      const p = capPressure();
      const ms = p && p.resetsAt ? p.resetsAt * 1000 : null;
      return ms !== null && ms > Date.now() ? ms : fallback;
    } catch {
      return fallback;
    }
  };

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

  if (sub === 'relax') {
    const want = args[2];
    if (want !== undefined && want !== 'off') {
      console.error('Usage: sprag routing relax [off]');
      process.exitCode = 2;
      return;
    }
    if (want === 'off') {
      setRelaxUntil(null);
      await resync();
      console.log(ko ? '✓ 위임 범위를 원래대로 돌렸습니다.' : '✓ Delegation is back to its usual range.');
      return;
    }
    const until = await relaxDeadline();
    setRelaxUntil(until);
    await resync();
    const clock = relaxClock(until);
    console.log(ko
      ? `이번 한도 창이 끝나는 ${clock}까지 위임을 넓힙니다. 그 뒤에는 자동으로 돌아옵니다.`
      : `Delegation is widened until ${clock}, when this limit window ends. It switches back by itself after that.`);
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

  if (sub === 'impl') {
    const want = args[2];
    if (want !== 'on' && want !== 'off') {
      console.error('Usage: sprag routing impl on|off');
      process.exitCode = 2;
      return;
    }
    setImplementationFollowUp(want === 'on');
    console.log(want === 'on'
      ? (ko ? '✓ 구현 분업 상기를 켰습니다. 구현 요청과 파일 두 개 직접 수정 때 한 번씩 안내합니다.' : '✓ Implementation reminder is on. It speaks once on an implementation request and once after two files edited directly.')
      : (ko ? '✓ 구현 분업 상기를 껐습니다.' : '✓ Implementation reminder is off.'));
    return;
  }

  if (sub === undefined || sub === 'status') {
    const on = routingEnabled();
    const n = await rules().catch(() => 0);
    let agentsOn = true;
    try { agentsOn = (await import('../delegation-agents.js')).delegationAgentStatus().enabled; } catch { /* default on */ }
    console.log(`routing: ${on ? 'on' : 'off'}`);
    console.log(isRelaxed() ? `relax: until ${relaxClock(relaxUntil())}` : 'relax: off');
    console.log(`effort hint: ${effortHintEnabled() ? 'on' : 'off'}`);
    console.log(ko ? `구현 분업 상기: ${implementationFollowUpEnabled() ? '켜짐' : '꺼짐'}` : `Implementation reminder: ${implementationFollowUpEnabled() ? 'on' : 'off'}`);
    console.log(ko ? `등록된 룰: ${n}건` : `registered rules: ${n}`);
    console.log(`delegate agents: ${agentsOn ? 'on' : 'off'}`);
    console.log(ko
      ? (on ? '끄기: sprag routing off' : '켜기: sprag routing on')
      : (on ? 'Disable with: sprag routing off' : 'Enable with: sprag routing on'));
    return;
  }

  console.log('Usage: sprag routing on|off|status|relax [off]|effort-hint on|off|impl on|off');
  process.exitCode = 1;
}
