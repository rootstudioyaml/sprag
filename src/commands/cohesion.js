/**
 * Subcommand: cohesion — English sentence-connection guidance for every session.
 *   claude-token-saver cohesion on       # inject at session start, all projects
 *   claude-token-saver cohesion off      # stop injecting
 *   claude-token-saver cohesion status   # current state and cost
 *   claude-token-saver cohesion show     # print the guidance itself
 *
 * The English sibling of `korean on`, carrying only the language-neutral
 * cohesion rules (given-before-new, one referent per pronoun, subject
 * consistency, bridging, merging choppy sentences). No lint: every clause
 * needs judgement, so nothing here is machine-checkable.
 */

export async function run({ args }) {
  const sub = args[1] || 'status';
  const co = await import('../cohesion.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();

  if (sub === 'on' || sub === 'off') {
    co.setCohesionEnabled(sub === 'on');
    if (sub === 'on') {
      console.log(lang === 'ko'
        ? '✍️ cohesion on: 다음 세션부터 영어 문장 연결 지침이 주입됩니다 (약 0.5k 토큰/세션, 세션 시작 1회).'
        : '✍️ cohesion on — English cohesion guidance will be injected from the next session (~0.5k tokens per session, once at session start).');
      const { koreanStyleEnabled } = await import('../korean-style.js');
      if (koreanStyleEnabled()) {
        console.log(lang === 'ko'
          ? '참고: korean 지침이 켜져 있는 동안에는 같은 원칙이 이미 들어가므로 이 블록은 주입되지 않습니다.'
          : 'Note: while the Korean guidance is on, its supplement already carries these rules, so this block is not injected.');
      }
    } else {
      console.log(lang === 'ko' ? 'cohesion off: 더 이상 주입하지 않습니다.' : 'cohesion off — no longer injected.');
    }
    return;
  }

  if (sub === 'show') {
    const text = co.cohesionText();
    if (!text) {
      console.error('cohesion guidance file missing: ' + co.COHESION_PATH);
      process.exit(1);
    }
    console.log(text);
    return;
  }

  // status (default)
  const enabled = co.cohesionEnabled();
  const { koreanStyleEnabled } = await import('../korean-style.js');
  const suppressed = enabled && koreanStyleEnabled();
  if (lang === 'ko') {
    console.log(`cohesion: ${enabled ? 'on' : 'off'}${suppressed ? ' (korean 지침이 켜져 있어 주입은 생략됨)' : ''}`);
    console.log('영어 산문의 문장 연결 지침을 세션 시작에 주입합니다. 켜기: claude-token-saver cohesion on');
  } else {
    console.log(`cohesion: ${enabled ? 'on' : 'off'}${suppressed ? ' (suppressed while the Korean guidance is on — it already carries these rules)' : ''}`);
    console.log('Injects English cohesion guidance at session start. Enable with: claude-token-saver cohesion on');
  }
}
