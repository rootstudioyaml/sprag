/**
 * Subcommand: korean — Korean writing guidance for every session.
 *   claude-token-saver korean on       # inject at session start, all projects
 *   claude-token-saver korean off      # stop injecting
 *   claude-token-saver korean status   # current state, cost, and provenance
 *   claude-token-saver korean show     # print the guidance itself
 *
 * Why this exists rather than pointing users at Claude Code's output styles:
 * an output style is one global slot, so turning it on takes the slot away
 * from whatever else the user had there, and it has to be configured on every
 * machine. This ships the guidance with the package and delivers it through
 * the SessionStart hook that is already installed, so it applies everywhere
 * the CLI is installed and leaves the output-style slot free.
 */

export async function run({ args }) {
  const sub = args[1] || 'status';
  const ks = await import('../korean-style.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();

  if (sub === 'show') {
    const text = ks.koreanStyleText();
    if (!text) {
      console.error('Korean style guidance file is missing from the package.');
      process.exit(1);
    }
    console.log(text);
    return;
  }

  if (sub === 'on' || sub === 'off') {
    const enabled = sub === 'on';
    ks.setKoreanStyleEnabled(enabled);
    if (enabled) {
      console.log(lang === 'ko'
        ? '한국어 문체 지침을 켰습니다. 다음 세션부터 모든 프로젝트에 적용됩니다.'
        : 'Korean writing guidance is on. It applies in every project from the next session.');
      console.log(lang === 'ko'
        ? '  주입 시점: 세션 시작 1회 (매 턴이 아니므로 두 번째 요청부터는 캐시에 올라갑니다)'
        : '  Injected once per session (not per turn), so it rides the prompt cache from the second request on.');
      console.log(lang === 'ko'
        ? `  출처: ${ks.KOREAN_STYLE_SOURCE}`
        : `  Source: ${ks.KOREAN_STYLE_SOURCE}`);
    } else {
      console.log(lang === 'ko'
        ? '한국어 문체 지침을 껐습니다. 다음 세션부터 주입하지 않습니다.'
        : 'Korean writing guidance is off. Nothing is injected from the next session.');
    }
    return;
  }

  // status (default)
  const on = ks.koreanStyleEnabled();
  const text = ks.koreanStyleText();
  // 4 bytes/token is the usual mixed ko/en approximation, same as the ratchet
  // size report — this is the number the user is trading for the style.
  const tokens = text ? Math.round(Buffer.byteLength(text, 'utf8') / 4) : 0;
  if (lang === 'ko') {
    console.log(`한국어 문체 지침: ${on ? '켜짐' : '꺼짐'}`);
    console.log(`  비용: 세션당 약 ${tokens} 토큰 (세션 시작 1회 주입)`);
    console.log(`  출처: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  라이선스 전문: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  끄려면: claude-token-saver korean off'
      : '  켜려면: claude-token-saver korean on');
  } else {
    console.log(`Korean writing guidance: ${on ? 'on' : 'off'}`);
    console.log(`  Cost: ~${tokens} tokens per session (injected once at session start)`);
    console.log(`  Source: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  License text: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  Turn off with: claude-token-saver korean off'
      : '  Turn on with: claude-token-saver korean on');
  }
}
