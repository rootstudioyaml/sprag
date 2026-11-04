/**
 * Subcommand: routing — master switch for model delegation.
 *
 *   sprag routing            # status
 *   sprag routing on|off     # turn every delegation path on or off
 *
 * Off removes the delegation rules from ratchet-model.md and the preset
 * ratchet, the per-prompt route hint, and the route-scan candidate and
 * rule-health briefings. Registered rules stay in the registry.
 */

export async function run({ args }) {
  const sub = args[1];
  const { userLanguage } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const { routingEnabled, setRoutingEnabled } = await import('../routing-switch.js');

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

  if (sub === undefined || sub === 'status') {
    const on = routingEnabled();
    const n = await rules().catch(() => 0);
    let agentsOn = true;
    try { agentsOn = (await import('../delegation-agents.js')).delegationAgentStatus().enabled; } catch { /* default on */ }
    console.log(`routing: ${on ? 'on' : 'off'}`);
    console.log(ko ? `등록된 룰: ${n}건` : `registered rules: ${n}`);
    console.log(`delegate agents: ${agentsOn ? 'on' : 'off'}`);
    console.log(ko
      ? (on ? '끄기: sprag routing off' : '켜기: sprag routing on')
      : (on ? 'Disable with: sprag routing off' : 'Enable with: sprag routing on'));
    return;
  }

  console.log('Usage: sprag routing on|off|status');
  process.exitCode = 1;
}
