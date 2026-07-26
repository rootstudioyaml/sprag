/**
 * Subcommand: history — print recent warning transitions captured by the
 * statusline. One markdown file per day, persisted under the platform-
 * specific user-data dir.
 *   claude-token-saver history              # last 7 days
 *   claude-token-saver history --days 30    # custom window
 *   claude-token-saver history --list       # just list available dates
 */


export async function run({ hasFlag, numArg }) {
    const { readRecent, listDates, historyDir, formatHistoryForLanguage } =
      await import('../history.js');
    const { userLanguage } = await import('../config.js');
    const lang = userLanguage();
    if (hasFlag('--list')) {
      const dates = listDates();
      if (dates.length === 0) {
        console.log(lang === 'ko'
          ? `히스토리가 아직 없습니다. 파일은 다음 위치에 생성됩니다: ${historyDir()}`
          : `No history yet. Files will appear under: ${historyDir()}`);
        return;
      }
      console.log(lang === 'ko' ? `히스토리 (${historyDir()}):` : `History (${historyDir()}):`);
      for (const d of dates) console.log(`  ${d}`);
      return;
    }
    const days = numArg('--days', { dflt: 7, min: 0 });
    const recent = readRecent(days);
    if (recent.length === 0) {
      if (lang === 'ko') {
        console.log(`최근 ${days}일 내 경고 히스토리가 없습니다.`);
        console.log(`(파일이 생성될 위치: ${historyDir()})`);
      } else {
        console.log(`No warning history in the last ${days} day${days === 1 ? '' : 's'}.`);
        console.log(`(Files would be written to: ${historyDir()})`);
      }
      return;
    }
    for (const { content } of recent) {
      const filtered = formatHistoryForLanguage(content, lang);
      console.log(filtered.replace(/\n+$/, ''));
      console.log('');
    }
    return;
}
