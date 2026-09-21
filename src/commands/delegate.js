/**
 * Subcommand: delegate — rewrite Task/Agent delegation prompts before they
 * spawn a subagent, appending bounds, (conditionally) Korean style guidance,
 * a ratchet pointer, and paths the session already read.
 *
 *   sprag delegate            # status
 *   sprag delegate on|off     # register / remove the PreToolUse hook
 *   sprag delegate --hook     # PreToolUse entry point
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Whether the PreToolUse hook is actually in settings.json.
 *
 * Mirrors doc2md.js's hookRegistered(): reporting "on" from config alone
 * while the hook itself is missing from settings.json would tell the user
 * the feature is live when nothing will ever call it.
 */
async function hookRegistered() {
  try {
    const { homedir } = require('node:os');
    // The same pattern install and remove use. A substring test would call a
    // future `delegate --hook-batch` this hook and report a feature as
    // registered that nothing will call.
    const { DELEGATE_HOOK_PATTERN } = await import('../installer.js');
    const settings = JSON.parse(
      require('node:fs').readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'),
    );
    return (settings?.hooks?.PreToolUse || []).some((m) =>
      (m.hooks || []).some((h) => typeof h.command === 'string' && DELEGATE_HOOK_PATTERN.test(h.command)),
    );
  } catch {
    return false;
  }
}

export async function run({ args, hasFlag }) {
  const sub = args[1];

  // Hook path first and cheap: this runs on every Task/Agent call, so
  // nothing above it may cost a syscall.
  if (hasFlag?.('--hook') || sub === '--hook') {
    const { readStdinJson } = await import('../stdin-payload.js');
    const payload = readStdinJson();
    if (!payload) return;
    let out = null;
    try {
      const { decideForDelegation, formatHookOutput } = await import('../delegation-guard.js');
      out = formatHookOutput(await decideForDelegation(payload));
    } catch {
      // A rewrite that throws must not take the delegation down with it.
      // Printing nothing leaves Claude Code to run the call exactly as given.
      return;
    }
    if (out) console.log(out);
    return;
  }

  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();

  if (sub === 'on') {
    const { setDelegateEnabled } = await import('../delegation-guard.js');
    setDelegateEnabled(true);
    const { installDelegateHook } = await import('../installer.js');
    const res = installDelegateHook();
    console.log(res.action === 'skipped'
      ? `✗ ${res.reason}`
      : `✓ PreToolUse hook ${res.action} (${res.path})`);
    console.log(lang === 'ko'
      ? '다음 서브에이전트 위임부터 프롬프트에 상한과 필요한 경우 한국어 지침, 최근에 읽은 경로가 덧붙습니다.'
      : 'From the next delegation, prompts get bounds, Korean guidance when it applies, and already-touched paths appended.');
    return;
  }

  if (sub === 'off') {
    const { setDelegateEnabled } = await import('../delegation-guard.js');
    setDelegateEnabled(false);
    const { removeDelegateHook } = await import('../installer.js');
    const res = removeDelegateHook();
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
  const hookOn = await hookRegistered();
  if (lang === 'ko') {
    console.log(`delegate: ${enabled ? 'on' : 'off'}, hook ${hookOn ? '등록됨' : '미등록'}`);
    console.log(`bounds 파일: ${BOUNDS_PATH}`);
    console.log(koreanStyleEnabled()
      ? 'korean 지침이 켜져 있어, 한글이 들어간 위임 프롬프트에는 같은 지침이 함께 붙습니다.'
      : 'korean 지침이 꺼져 있어, 위임 프롬프트에는 상한과 경로 안내만 붙습니다.');
    console.log('켜기: sprag delegate on');
  } else {
    console.log(`delegate: ${enabled ? 'on' : 'off'}, hook ${hookOn ? 'registered' : 'not registered'}`);
    console.log(`bounds file: ${BOUNDS_PATH}`);
    console.log(koreanStyleEnabled()
      ? 'Korean guidance is on, so a delegation prompt containing Hangul also gets that guidance appended.'
      : 'Korean guidance is off, so delegation prompts only get bounds and touched-path notes appended.');
    console.log('Enable with: sprag delegate on');
  }
}
