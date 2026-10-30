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
 *
 * The routing mark also bounds the per-rule `saved ~$` figures in
 * model-rules.json and ratchet-model.md, which are rebuilt by a scan rather than
 * summed from the ledger. So a reset or undo that touches `routing` finishes by
 * running that scan; see refreshRuleSavings.
 */

import { debug } from '../debug.js';

const SCOPE_SETS = {
  claude: ['routing', 'doc2md'],
  codex: ['codex-routing', 'codex-docs'],
};

/** Totals since each scope's mark; Codex keeps unavailable estimates explicit. */
async function currentTotals(scope, dir) {
  if (scope === 'routing') {
    const { delegationSavedTotals } = await import('../savings-ledger.js');
    const t = delegationSavedTotals(Date.now(), dir);
    return { usd: t.total, spent: t.spent, spentMissing: t.spentMissing };
  }
  if (scope === 'doc2md') {
    const { doc2mdSavedTotals } = await import('../doc2md-ledger.cjs');
    return { usd: doc2mdSavedTotals(dir).total };
  }
  if (scope === 'codex-routing') {
    const { codexRoutingSavedTotals } = await import('../codex/ledger.js');
    const totals = codexRoutingSavedTotals({ dir });
    return { usd: totals.priced ? totals.total : null, unpriced: totals.runs - totals.priced };
  }
  const { codexDocumentTotals } = await import('../codex/doc2md-ledger.js');
  const totals = codexDocumentTotals({ dir });
  return { docs: totals.docs, usd: totals.savings.priced ? totals.savings.total : null, unpriced: totals.savings.unpriced };
}

/**
 * Rebuild each rule's savedUsd and re-render ratchet-model.md after the routing
 * mark moved. The 14-day scan does both (it reads the mark, refreshes the
 * registry, writes the managed files) in about half a second, so it is reused
 * rather than duplicated here.
 *
 * Best-effort by design: the mark is already saved, and a failed rescan must not
 * turn a successful reset into an error. It says so in one line instead, since
 * the figures then stay stale until the next scan.
 *
 * @param {boolean} ko
 * @param {Function} [rescan] injected by tests; defaults to runRouteScan
 */
async function refreshRuleSavings(ko, rescan) {
  try {
    const scan = rescan || (await import('../route-scan.js')).runRouteScan;
    await scan({ days: 14 });
  } catch (e) {
    debug('saved:rule-savings', e);
    console.log(ko
      ? '룰별 절감액은 다음 route-scan 때 다시 계산됩니다.'
      : 'Per-rule savings will be recalculated at the next route-scan.');
  }
}

const FAMILY_NAMES = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', mythos: 'Mythos' };

/**
 * The model-share table for the routing counter's period. Best-effort like the
 * statusline: a failure to read transcripts must not break the totals above it.
 */
async function printModelShare({ ko, dir, money }) {
  const { loadModelShare, roundShares } = await import('../model-share.js');
  let share;
  try {
    share = await loadModelShare({ dir, env: process.env });
  } catch (e) {
    debug('saved:model-share', e);
    return;
  }
  let title = ko ? '모델별 사용 비중 (같은 기간, 비용 기준)' : 'Model share (same period, by cost)';
  if (share.sinceKind === 'month') title += ko ? ' · 초기화 기록이 없어 이번 달 기준' : ' · no reset on record, this month';
  else if (share.sinceKind === 'capped') title += ko ? ' · 최근 90일' : ' · last 90 days';
  console.log('');
  console.log(title);
  if (!(share.totalUsd > 0)) {
    console.log(ko ? '이 기간에 집계할 사용 기록이 없습니다.' : 'No usage to count in this period.');
  } else {
    const names = share.families.map((f) => FAMILY_NAMES[f.family] || f.family);
    const nameW = Math.max(...names.map((n) => n.length));
    const pcts = share.families.map((f) => f.pct.toFixed(1));
    const pctW = Math.max(...pcts.map((p) => p.length));
    share.families.forEach((f, i) => {
      const filled = roundShares([f.usd, share.totalUsd - f.usd], 20)[0];
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      console.log(`  ${names[i].padEnd(nameW)}  ${bar}  ${pcts[i].padStart(pctW)}%  ${money(f.usd)}`);
    });
    if (share.subagent.usd > 0) {
      const subs = share.subagent.families;
      const subPct = Math.round(share.subagent.pct);
      // A share that rounds to 0 still spent money; "0%" would read as unused.
      const pctText = (p) => (p > 0 && Math.round(p) === 0 ? '<1' : String(Math.round(p)));
      const detail = subs
        .map((f) => `${f.family} ${pctText(f.pct)}%`)
        .join(', ');
      console.log(`  ${ko ? '서브에이전트 몫' : 'Subagents'}: ${subPct}% (${detail})`);
    }
  }
  if (share.unpriced > 0) {
    console.log(ko ? `단가가 없어 제외한 부분 ${share.unpriced}건` : `${share.unpriced} part(s) left out: no price`);
  }
}

export async function run({ args, hasFlag, agent = 'claude', dir: dirArg, rescan }) {
  const { userLanguage } = await import('../config.js');
  const { userDataDir } = await import('../paths.js');
  const { readResetMarks, resetSaved, undoReset } = await import('../saved-reset.cjs');
  const ko = userLanguage() === 'ko';
  const dir = dirArg || userDataDir();
  const scopes = SCOPE_SETS[agent === 'codex' ? 'codex' : 'claude'];
  const suffix = agent === 'codex' ? ' --agent codex' : '';

  const money = (v) => (v < 0 ? `-$${(-v).toFixed(2)}` : `$${v.toFixed(2)}`);
  const fmtTotal = (t) => {
    const value = Number.isFinite(t.usd) ? money(t.usd) : 'n/a';
    if (t.docs !== undefined) return `${ko ? `${t.docs}건` : `${t.docs} doc(s)`}, ${value} (${ko ? 'XML 대비 추정' : 'XML estimate'}; ${t.unpriced} unpriced)`;
    // What the delegated runs cost on the models they ran on. The statusline
    // no longer draws it beside the saving, so this is where it is read.
    const spent = Number(t.spent) > 0
      ? ` · ${ko ? '위임 실행 비용' : 'spent on delegated runs'} ${money(t.spent)}${t.spentMissing > 0 ? ` +${t.spentMissing} unpriced` : ''}`
      : '';
    return `${value}${t.unpriced ? ` +${t.unpriced} unpriced` : ''}${spent}`;
  };
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
    if (agent !== 'codex') {
      console.log(ko
        ? '라우팅 절감은 위임하지 않고 직접 했을 때의 캐시 읽기와 쌓일 컨텍스트까지 반영해 계산합니다 (v3).'
        : 'Routing saved is net of the cache re-reads and carried context the same work would have cost without delegating (v3).');
      await printModelShare({ ko, dir, money });
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
    // Codex keeps no per-rule figure (its rules are a separate store with no
    // savedUsd), so only the Claude `routing` scope has anything to recompute.
    if (targets.includes('routing')) await refreshRuleSavings(ko, rescan);
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
    // Keyed on what was undone, not on --agent: undo pops the latest reset
    // whichever agent made it, so a bare `undo --agent codex` can restore
    // the Claude routing mark and the rule figures must follow it.
    if (undone.scopes.includes('routing')) await refreshRuleSavings(ko, rescan);
    return;
  }

  console.error(ko
    ? `알 수 없는 하위 명령입니다: ${sub}. 사용법은 sprag saved [reset|undo] 입니다.`
    : `Unknown subcommand: ${sub}. Usage: sprag saved [reset|undo].`);
  process.exit(1);
}
