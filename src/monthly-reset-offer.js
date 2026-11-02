/**
 * Monthly reset offer: the first session start of a month in which the saved
 * counters have not been reset since the 1st tells the model to recommend a
 * reset and ask the user. The figures (routing saved, Doc2md saved, Model used
 * share) are lifetime-until-reset, so without a periodic reset they stop saying
 * anything about the current month.
 *
 * The asking happens at session start for the same reason as the upgrade and
 * seed offers: a statusline cannot open a dialog. The offer repeats at every
 * fresh session until the user answers: yes runs `sprag saved reset all`, whose
 * mark silences it; no runs `sprag saved keep`, which records the month as
 * declined. Printing alone records nothing, because a session where nobody
 * read the offer must not count as an answer (2026-11-01: a batch job got
 * November's only ask under the old once-per-month rule).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from './debug.js';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { readResetMarks } from './saved-reset.cjs';
import { delegationSavedTotals } from './savings-ledger.js';
import { doc2mdSavedTotals } from './doc2md-ledger.cjs';
import { formatMoney } from './formatters/statusline.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function readState(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/**
 * Whether a SessionStart with this `source` may carry the offer: a fresh
 * session only. The hook also fires on resume, clear and compact, and an offer
 * right after an auto-compact would interrupt work in progress. A payload
 * without `source` (older Claude Code, or a manual run) counts as a fresh start.
 *
 * SDK sessions (`claude -p`, Agent SDK; CLAUDE_CODE_ENTRYPOINT `sdk-*`) are
 * skipped too. They are mostly unattended batch jobs, so nobody would answer,
 * and an offer that repeats until answered would ride every run and could leak
 * a question into output a script parses.
 */
export function offersOnSessionSource(source, entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT) {
  if (typeof entrypoint === 'string' && entrypoint.startsWith('sdk')) return false;
  return !source || source === 'startup';
}

export const monthlyResetStatePath = (dir) => join(dir, 'monthly-reset-offer.json');

/**
 * @param {object} [opts]
 * @param {string} [opts.dir] user data dir (marks and offer state live here)
 * @param {number} [opts.now] epoch ms, injectable for tests
 * @param {'ko'|'en'} [opts.lang]
 * @returns {string|null} the block to print at session start, or null
 */
export function monthlyResetOffer({ dir = userDataDir(), now = Date.now(), lang = 'en' } = {}) {
  try {
    const today = new Date(now);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    // Declined this month: stay quiet until the next one. A state file from
    // v3.91 to v3.93 holds only `offeredAt`, which was never an answer.
    const state = readState(monthlyResetStatePath(dir));
    if (state && state.month === monthKey && Number.isFinite(state.declinedAt)) return null;

    // Reset since the 1st: nothing to recommend. A later `undo` that brings the
    // old mark back makes the offer due again.
    const marks = readResetMarks(dir);
    if (Number.isFinite(marks.routing) && marks.routing >= monthStart) return null;

    const routing = Number(delegationSavedTotals(now, dir).total);
    const doc = Number(doc2mdSavedTotals(dir).total);
    const routingOk = Number.isFinite(routing) ? routing : 0;
    const docOk = Number.isFinite(doc) ? doc : 0;
    // Both zero: a reset would change nothing, so there is nothing to offer.
    if (routingOk === 0 && docOk === 0) return null;

    const ko = lang === 'ko';
    const hasMark = Number.isFinite(marks.routing) && marks.routing > 0;
    let sinceText;
    if (hasMark) {
      const d = new Date(marks.routing);
      const md = `${d.getMonth() + 1}/${d.getDate()}`;
      sinceText = ko ? `${md}부터` : `since ${md}`;
    } else {
      sinceText = ko ? '설치 이후' : 'since install';
    }

    const block = ko
      ? [
        `✇ [sprag monthly-reset] ${today.getMonth() + 1}월 1일 이후 절감 집계를 초기화한 적이 없습니다. 지금 보이는 값은 ${sinceText} 누적입니다: 라우팅 절감 ${formatMoney(routingOk)}, Doc2md 절감 ${formatMoney(docOk)}.`,
        '이번 달 기준으로 새로 보려면 초기화를 권장합니다. 초기화하면 라우팅 절감과 Doc2md 절감, Model used 비율이 지금부터 다시 집계됩니다. 기록은 지워지지 않고 `sprag saved undo` 로 되돌릴 수 있습니다.',
        '사용자에게 위 내용을 알리고 초기화할지 물어보십시오. 승낙하면 첫째 명령을, 거절하면 둘째 명령을 실행하십시오. 둘 중 하나를 실행하기 전에는 새 세션을 열 때마다 이 안내가 다시 나옵니다. 거절하면 이번 달에는 더 묻지 않습니다.',
        '  sprag saved reset all',
        '  sprag saved keep',
      ]
      : [
        `✇ [sprag monthly-reset] The saved counters have not been reset since ${MONTH_NAMES[today.getMonth()]} 1. The figures shown are cumulative ${sinceText}: routing saved ${formatMoney(routingOk)}, Doc2md saved ${formatMoney(docOk)}.`,
        'A reset is recommended to see this month on its own. It restarts routing savings, Doc2md savings and the Model used share from now. Nothing is deleted, and `sprag saved undo` puts it back.',
        'Tell the user this and ask whether to reset. If they agree, run the first command; if they decline, run the second. Until one of them runs, this offer comes back at every new session. A decline keeps it quiet for the rest of the month.',
        '  sprag saved reset all',
        '  sprag saved keep',
      ];

    return block.join('\n');
  } catch (e) {
    debug('monthly-reset-offer', e);
    return null;
  }
}

/**
 * Record the user's "no" for the current calendar month (`sprag saved keep`).
 * @returns {string} the month key, e.g. '2026-11'
 */
export function declineMonthlyReset({ dir = userDataDir(), now = Date.now() } = {}) {
  const today = new Date(now);
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  writeStateFile(monthlyResetStatePath(dir), `${JSON.stringify({ version: 2, month: monthKey, declinedAt: now }, null, 2)}\n`);
  return monthKey;
}
