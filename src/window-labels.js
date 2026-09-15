/**
 * Friendly labels + icons for `rate_limits.*` keys from Claude Code's stdin.
 *
 * Each window carries two glyphs. `icon` is the emoji; `narrowIcon` is the
 * one-cell glyph used where emoji garble the line, chosen by JetBrains Mono
 * coverage for the reason src/glyphs.js explains.
 * payload. Known keys (`five_hour`, `seven_day`) get curated short/long labels
 * and dedicated icons. Unknown keys are passed through with a derived label so
 * any future window Anthropic adds (e.g. `seven_day_sonnet`) renders without
 * a code change.
 */

// `short` is used by the cap-warn chip and history records (stable shape so
// parsers/dedup keep working). `usageLabel` is the friendlier word that the
// always-on usage segment renders next to the icon — empty string means the
// icon alone carries the meaning (5H 'session/now' is the implicit default).
const KNOWN = {
  // ✦ reads as "AI token unit" (Anthropic/OpenAI/Gemini sparkle motif), more
  // on-theme than the 🪙 coin which suggested in-app currency. Same width as
  // 📅 in monospace terminals so the chip alignment stays stable.
  // 'current' mirrors how `weekly` reads next to 7D — names the window in
  // plain English so a glance at `✦ current ████▒░ 72%` tells the eye what's
  // being measured without parsing the icon's meaning.
  five_hour: { short: '5H', long: 'Current session', icon: '✦', narrowIcon: '✶', usageLabel: 'current' },
  seven_day: { short: '7D', long: 'Current week', icon: '📅', narrowIcon: '⌸', usageLabel: 'weekly' },
  // Speculative — `/usage` shows a Sonnet-only weekly bucket, so if Anthropic
  // ever surfaces it on stdin we render with a sensible default already.
  seven_day_sonnet: { short: '7D-S', long: 'Current week (Sonnet)', icon: '🅂', narrowIcon: '◇', usageLabel: 'weekly (Sonnet)' },
  seven_day_opus: { short: '7D-O', long: 'Current week (Opus)', icon: '🅾', narrowIcon: '◆', usageLabel: 'weekly (Opus)' },
  // 💳 는 지출 한도를 가리킨다. 이전에 쓰던 🔑 은 인증 수단을 연상시키므로,
  // 이 칩이 새로 보는 사람에게 키 자신의 상태로 읽힐 여지가 있었다.
  // LiteLLM 게이트웨이 키 예산. rate_limits 가 없는 환경에서 cap 게이지를
  // 대신하는 합성 윈도우라서, 여기 라벨만 있으면 나머지 렌더는 공용 경로를 탄다.
  litellm_budget: { short: 'BUDGET', long: 'LiteLLM key budget', icon: '💳', narrowIcon: '◫', usageLabel: 'budget' },
};

function deriveShort(key) {
  // "five_hour" → "5H"; "seven_day_sonnet" → "7DS"; arbitrary key → uppercase initials
  const m = key.match(/^(\d+)_?([a-z]+)/);
  if (m) {
    const num = m[1];
    const word = m[2];
    const letter = word.charAt(0).toUpperCase();
    const tail = key.slice(m[0].length);
    const suffix = tail
      .split('_')
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase())
      .join('');
    return `${num}${letter}${suffix}`;
  }
  return key
    .split('_')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase())
    .join('') || key;
}

function deriveLong(key) {
  return key
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function labelForKey(key) {
  if (KNOWN[key]) return KNOWN[key];
  const short = deriveShort(key);
  return { short, long: deriveLong(key), icon: '⏱', narrowIcon: '◕', usageLabel: short };
}
