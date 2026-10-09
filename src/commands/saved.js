/**
 * Subcommand: saved — a stopwatch reset for the lifetime "saved" counters.
 *
 *   sprag saved                              # totals since the last reset
 *   sprag saved reset [routing|doc2md|all]   # start counting from now
 *   sprag saved undo                         # put the previous counters back
 *   (add --agent codex for the Codex counters: codex-routing, codex-docs)
 *
 * Nothing is deleted. A reset only records a timestamp, and the totals count
 * events from that moment on; see src/saved-reset.cjs.
 */

const SCOPE_SETS = {
  claude: ['routing', 'doc2md'],
  codex: ['codex-routing', 'codex-docs'],
};

/** Totals since each scope's mark: { usd } for money counters, { docs } for the Codex document counter. */
async function currentTotals(scope, dir) {
  if (scope === 'routing') {
    const { delegationSavedTotals } = await import('../savings-ledger.js');
    return { usd: delegationSavedTotals(Date.now(), dir).total };
  }
  if (scope === 'doc2md') {
    const { doc2mdSavedTotals } = await import('../doc2md-ledger.cjs');
    return { usd: doc2mdSavedTotals(dir).total };
  }
  if (scope === 'codex-routing') {
    const { codexRoutingSavedTotals } = await import('../codex-ledger.js');
    return { usd: codexRoutingSavedTotals({ dir }).total };
  }
  const { codexDocumentTotals } = await import('../codex-doc2md-ledger.js');
  return { docs: codexDocumentTotals({ dir }).docs };
}

export async function run({ args, hasFlag, agent = 'claude', dir: dirArg }) {
  const { userLanguage } = await import('../config.js');
  const { userDataDir } = await import('../paths.js');
  const { readResetMarks, resetSaved, undoReset } = await import('../saved-reset.cjs');
  const ko = userLanguage() === 'ko';
  const dir = dirArg || userDataDir();
  const scopes = SCOPE_SETS[agent === 'codex' ? 'codex' : 'claude'];
  const suffix = agent === 'codex' ? ' --agent codex' : '';

  const money = (v) => (v < 0 ? `-$${(-v).toFixed(2)}` : `$${v.toFixed(2)}`);
  const fmtTotal = (t) => (t.docs !== undefined ? (ko ? `${t.docs}건` : `${t.docs} doc(s)`) : money(t.usd));
  const fmtTime = (ms) => new Date(ms).toLocaleString(ko ? 'ko-KR' : 'en-US');
  const label = (scope) => ({
    routing: ko ? '라우팅 절감' : 'Routing saved',
    doc2md: ko ? '문서 변환 절감' : 'Document conversion saved',
    'codex-routing': ko ? 'Codex 라우팅 절감' : 'Codex routing saved',
    'codex-docs': ko ? 'Codex 문서 변환' : 'Codex documents converted',
  })[scope];

  const sub = args[1];

  if (sub === undefined) {
    const marks = readResetMarks(dir);
    for (const s of scopes) {
      const t = await currentTotals(s, dir);
      const since = marks[s] === null
        ? (ko ? '초기화한 적 없음' : 'not reset')
        : (ko ? `${fmtTime(marks[s])} 이후` : `since ${fmtTime(marks[s])}`);
      console.log(`${label(s)}: ${fmtTotal(t)} (${since})`);
    }
    return;
  }

  if (sub === 'reset') {
    const arg = args[2] || 'all';
    const base = agent === 'codex' ? { routing: 'codex-routing', doc2md: 'codex-docs' } : { routing: 'routing', doc2md: 'doc2md' };
    let targets;
    if (arg === 'all') targets = scopes;
    else if (scopes.includes(arg)) targets = [arg];
    else if (base[arg]) targets = [base[arg]];
    else {
      console.error(ko
        ? `알 수 없는 범위입니다: ${arg}. 사용할 수 있는 범위는 ${scopes.join(', ')}, all 입니다.`
        : `Unknown scope: ${arg}. Valid scopes are ${scopes.join(', ')}, all.`);
      process.exit(1);
    }
    const before = {};
    for (const s of targets) before[s] = await currentTotals(s, dir);
    resetSaved(targets, { dir });
    for (const s of targets) {
      console.log(ko
        ? `${label(s)} 카운터를 0으로 초기화했습니다. 이전 합계는 ${fmtTotal(before[s])}입니다.`
        : `Reset the ${label(s)} counter to zero. The previous total was ${fmtTotal(before[s])}.`);
    }
    console.log(ko
      ? `원장 기록은 지우지 않았습니다. \`sprag saved undo${suffix}\`로 되돌릴 수 있습니다.`
      : `No ledger data was deleted. Run \`sprag saved undo${suffix}\` to restore the previous counters.`);
    return;
  }

  if (sub === 'undo') {
    const undone = undoReset({ dir });
    if (!undone) {
      console.log(ko ? '되돌릴 초기화 기록이 없습니다.' : 'There is no reset to undo.');
      return;
    }
    for (const s of undone.scopes) {
      const t = await currentTotals(s, dir);
      console.log(ko
        ? `${label(s)} 카운터를 되돌렸습니다. 현재 합계는 ${fmtTotal(t)}입니다.`
        : `Restored the ${label(s)} counter. The total is now ${fmtTotal(t)}.`);
    }
    return;
  }

  console.error(ko
    ? `알 수 없는 하위 명령입니다: ${sub}. 사용법은 sprag saved [reset|undo] 입니다.`
    : `Unknown subcommand: ${sub}. Usage: sprag saved [reset|undo].`);
  process.exit(1);
}
