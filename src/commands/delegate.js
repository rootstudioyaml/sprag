/**
 * Subcommand: delegate — rewrite Task/Agent delegation prompts before they
 * spawn a subagent, appending bounds, (conditionally) Korean style guidance,
 * a ratchet pointer, and paths the session already read.
 *
 *   sprag delegate            # status
 *   sprag delegate on|off     # register / remove the PreToolUse hook
 *   sprag delegate --hook     # PreToolUse entry point
 */


/**
 * Whether the PreToolUse hook is actually in settings.json, and why not when
 * it is not.
 *
 * Reporting "on" from config alone while the hook itself is missing would tell
 * the user the feature is live when nothing will ever call it — the reason
 * doc2md.js grew the same check. The traversal lives in installer.js beside
 * install and remove rather than being written a third time here, which also
 * lets status say `hooks.PreToolUse is not an array` instead of reporting a
 * file it refused to touch the same way as a file with no hook in it.
 */
async function hookState() {
  try {
    const { delegationGuardHookState } = await import('../installer.js');
    return delegationGuardHookState();
  } catch {
    return { registered: false };
  }
}

export async function run({ args, hasFlag }) {
  const sub = args[1];

  // Hook path first and cheap: this runs on every Task/Agent call, so
  // nothing above it may cost a syscall.
  if (hasFlag?.('--hook') || sub === '--hook') {
    let out = null;
    try {
      // Reading stdin is inside the try for the same reason the rewrite is: a
      // synchronous read can throw on the pipe state it is handed, and a
      // malformed payload is exactly the case this path has to survive. An
      // escape here would end the hook process on a stack trace, which Claude
      // Code surfaces on every delegation — the loudest possible failure in
      // the one place that has to stay quiet.
      const { readStdinJson } = await import('../stdin-payload.js');
      const payload = readStdinJson();
      if (!payload) return;
      const { decideForDelegation, formatHookOutput } = await import('../delegation-guard.js');
      out = formatHookOutput(await decideForDelegation(payload));
    } catch {
      // Printing nothing leaves Claude Code to run the call exactly as given.
      return;
    }
    if (out) console.log(out);
    return;
  }

  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();

  if (sub === 'on') {
    // Install first, and only record the feature as on once that worked.
    // Saving the flag first left `delegate: on, hook not registered` behind
    // whenever settings.json could not be written — a feature the user
    // believes they turned on, with nothing registered to ever call it. The
    // risk only runs this way: with the flag off, a hook that is still
    // registered returns early in delegateEnabled() and changes nothing.
    const { installDelegationGuardHook } = await import('../installer.js');
    const res = installDelegationGuardHook();
    if (res.action === 'skipped') {
      console.log(`✗ ${res.reason}`);
      console.log(lang === 'ko'
        ? 'settings.json 을 고친 뒤 다시 실행하십시오. 기능은 꺼진 상태로 둡니다.'
        : 'Fix settings.json and run this again. The feature is left off.');
      return;
    }
    const { setDelegateEnabled } = await import('../delegation-guard.js');
    setDelegateEnabled(true);
    console.log(`✓ PreToolUse hook ${res.action} (${res.path})`);
    console.log(lang === 'ko'
      ? '다음 서브에이전트 위임부터 프롬프트에 상한과 필요한 경우 한국어 지침, 최근에 읽은 경로가 덧붙습니다.'
      : 'From the next delegation, prompts get bounds, Korean guidance when it applies, and already-touched paths appended.');
    return;
  }

  if (sub === 'off') {
    const { setDelegateEnabled } = await import('../delegation-guard.js');
    setDelegateEnabled(false);
    const { removeDelegationGuardHook } = await import('../installer.js');
    const res = removeDelegationGuardHook();
    console.log(res.action === 'skipped' ? `✗ ${res.reason}` : `✓ PreToolUse hook ${res.action}`);
    console.log(lang === 'ko'
      ? 'delegate off: 더 이상 위임 프롬프트를 고치지 않습니다.'
      : 'delegate off — delegation prompts are no longer rewritten.');
    return;
  }

  // status (default)
  const { delegateEnabled, BOUNDS_PATH } = await import('../delegation-guard.js');
  const { koreanStyleEnabled } = await import('../korean-style.js');
  const enabled = delegateEnabled();
  const { registered: hookOn, reason } = await hookState();
  if (lang === 'ko') {
    console.log(`delegate: ${enabled ? 'on' : 'off'}, hook ${hookOn ? '등록됨' : '미등록'}`);
    if (reason) console.log(`  settings.json: ${reason}`);
    console.log(`bounds 파일: ${BOUNDS_PATH}`);
    console.log(koreanStyleEnabled()
      ? 'korean 지침이 켜져 있어, 한글이 들어간 위임 프롬프트에는 같은 지침이 함께 붙습니다.'
      : 'korean 지침이 꺼져 있어, 위임 프롬프트에는 상한과 경로 안내만 붙습니다.');
    console.log('켜기: sprag delegate on');
  } else {
    console.log(`delegate: ${enabled ? 'on' : 'off'}, hook ${hookOn ? 'registered' : 'not registered'}`);
    if (reason) console.log(`  settings.json: ${reason}`);
    console.log(`bounds file: ${BOUNDS_PATH}`);
    console.log(koreanStyleEnabled()
      ? 'Korean guidance is on, so a delegation prompt containing Hangul also gets that guidance appended.'
      : 'Korean guidance is off, so delegation prompts only get bounds and touched-path notes appended.');
    console.log('Enable with: sprag delegate on');
  }
}
