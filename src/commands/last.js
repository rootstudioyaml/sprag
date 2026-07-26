/**
 * Subcommand: last — print the most recent warning + how to handle it.
 * Designed for the auto-trigger skill so the user immediately sees
 * "what just fired and how to fix it" without having to read the whole
 * history file.
 *   claude-token-saver last           # search last 1 day
 *   claude-token-saver last --days 7  # widen the lookback
 */


/**
 * Scan recent history file contents (newest day first) and return the most
 * recent warning event — `{ time, chip, detail, codes, isCap, capLabel, capPct }`.
 * Returns null when no warning is found in the window.
 *
 * Recognized event lines (from history.js appendDayLine output):
 *   - HH:MM:SS ⚠ Cache miss — session abc1: LOW_HIT_RATE
 *   - HH:MM:SS ⚠ A → ⚠ B — detail
 *   - HH:MM:SS 🚨 5H 94% cap warning (resets in ...)
 *   - HH:MM:SS ✓ resolved (was ...)        ← skip
 *   - HH:MM:SS ✓ 5H cap warning resolved   ← skip
 *   - HH:MM:SS 📝 handoff written: ...     ← skip
 */
function findLatestWarning(historyEntries, chipToCodes) {
  const warnings = [];
  for (const { date, content } of historyEntries) {
    const lines = content.split('\n');
    for (const line of lines) {
      // Skip non-event lines
      const m = line.match(/^- (\d{2}:\d{2}:\d{2})\s+(.+)$/);
      if (!m) continue;
      const time = m[1];
      const rest = m[2];
      // Skip resolutions and handoff entries
      if (rest.startsWith('✓ ') || rest.startsWith('📝 ')) continue;
      // Cap-warn line: `🚨 5H 94% cap warning (...)`
      const cap = rest.match(/^🚨\s+(\S+)\s+(\d+)%\s+cap warning(?:\s*\((.+)\))?$/);
      if (cap) {
        warnings.push({
          date,
          time,
          chip: `🚨 ${cap[1]} ${cap[2]}%`,
          isCap: true,
          capLabel: cap[1],
          capPct: parseInt(cap[2], 10),
          capReset: cap[3] || null,
          codes: [],
          detail: null,
        });
        continue;
      }
      // Chip line — last token after the chip is `— detail` (optional). The
      // chip itself can be a plain `⚠ X` or a `⚠ A → ⚠ B` transition; we want
      // the *current* chip (right side of the arrow if present).
      const arrowMatch = rest.match(/^(.+?)\s+→\s+(.+?)(?:\s+—\s+(.+))?$/);
      let chip;
      let detail = null;
      if (arrowMatch) {
        chip = arrowMatch[2].trim();
        detail = arrowMatch[3] || null;
      } else {
        const plain = rest.match(/^(\S+(?:\s+\S+)*?)(?:\s+—\s+(.+))?$/);
        if (!plain) continue;
        chip = plain[1].trim();
        detail = plain[2] || null;
      }
      // Resolve codes: detail "session ID: A, B" → codes; else CHIP_TO_CODES.
      const codes = [];
      if (detail) {
        const dm = detail.match(/^session [^:]+:\s*(.+)$/);
        if (dm) {
          for (const c of dm[1].split(',').map((s) => s.trim()).filter(Boolean)) {
            if (!codes.includes(c)) codes.push(c);
          }
        }
      }
      if (chipToCodes[chip]) {
        for (const c of chipToCodes[chip]) if (!codes.includes(c)) codes.push(c);
      }
      warnings.push({ date, time, chip, isCap: false, codes, detail });
    }
  }
  return warnings.length ? warnings[warnings.length - 1] : null;
}

export async function run({ numArg }) {
    const { readRecent, historyDir } = await import('../history.js');
    const { ISSUE_MESSAGES, CHIP_TO_CODES, CAP_TIPS } = await import('../advice.js');
    const { userLanguage } = await import('../config.js');
    const lang = userLanguage();
    const days = numArg('--days', { dflt: 1, min: 0 });
    const recent = readRecent(days);
    const latest = findLatestWarning(recent, CHIP_TO_CODES);
    if (!latest) {
      if (lang === 'ko') {
        console.log(`최근 ${days}일 내 경고가 없습니다.`);
        console.log(`(히스토리 디렉터리: ${historyDir()})`);
      } else {
        console.log(`No warnings in the last ${days} day${days === 1 ? '' : 's'}.`);
        console.log(`(History dir: ${historyDir()})`);
      }
      return;
    }
    // Header
    console.log(`Most recent warning — ${latest.date} ${latest.time}`);
    console.log(`  ${latest.chip}${latest.detail ? `  — ${latest.detail}` : ''}`);
    console.log('');
    // Cap-warn path: handoff is the recommendation. Print the bilingual tip
    // and a one-line "how to back up" pointer.
    if (latest.isCap) {
      if (latest.capReset) console.log(`  Cap window: ${latest.capReset}`);
      console.log('');
      console.log('💡 ' + (lang === 'ko' ? CAP_TIPS.ko : CAP_TIPS.en));
      console.log('');
      console.log(lang === 'ko' ? '실행:' : 'Run:');
      console.log('  claude-token-saver handoff');
      return;
    }
    // Chip warning path: render full ISSUE_MESSAGES advice for each code,
    // bilingual (English first, `└ Korean` continuation per line — matches
    // the history.md format).
    if (latest.codes.length === 0) {
      console.log(lang === 'ko'
        ? '(진단 코드 없음 — 표 뷰를 열어보세요: `claude-token-saver --days 1`)'
        : '(No diagnostic code attached — open the table view: `claude-token-saver --days 1`)');
      return;
    }
    // Pick a single language per field; fall back to EN when KO is missing.
    const pick = (en, ko) => (lang === 'ko' && ko ? ko : en);
    for (const code of latest.codes) {
      const msg = ISSUE_MESSAGES[code];
      if (!msg) {
        console.log(`Code: ${code} (no advice registered)`);
        continue;
      }
      console.log(`▎ ${pick(msg.title, msg.titleKo)}`);
      console.log(`  ${pick(msg.explain, msg.explainKo)}`);
      const actions = typeof msg.actions === 'function' ? msg.actions() : msg.actions || [];
      for (const a of actions) {
        console.log('');
        console.log(`  ${pick(a.label, a.labelKo)}:`);
        const cmds = a.commands || [];
        const cmdsKo = a.commandsKo || [];
        for (let i = 0; i < cmds.length; i++) {
          console.log(`    - ${pick(cmds[i], cmdsKo[i])}`);
        }
      }
      console.log('');
    }
    return;
}
