// Weekly nudge that keeps the replay corpus growing: harvest delegations made
// since the last run, flag the ones the user corrected on the very next turn,
// and post the list to the sprag Slack channel. No model call and no cost; the
// main session then picks cases, writes rubrics and asks before replaying.
//
// Usage: node scripts/evals/weekly.mjs [--dry-run] [--env-file <path>]
//   --dry-run   print the message, post nothing, keep the state
// State: <work>/weekly-state.json ({ lastRun, seen: [candidate ids] }).
// Slack: SLACK_BOT_TOKEN and SPRAG_SLACK_CHANNEL_ID, the same lookup as
// scripts/upstream-watch.mjs. Scheduled by a launchd job on the maintainer's
// machine; see evals/README.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { harvest, groupCounts } from './harvest.mjs';
import { workDir, readJson, isMain } from './lib.mjs';

const DAY = 864e5;
// The user's next turn reads as a correction. Deliberately narrow: a false
// flag costs one look, a missed one costs nothing more than today.
// The contrastive '아니라' and 'again' fired on ordinary requests in the
// first dry run against 167 real delegations, so both are out.
const CORRECTION_RE = /아니야|아니요|틀렸|잘못(?:했|됐|된|찾)|빠졌|놓쳤|못 찾았|다시 (?:해|찾아|봐)|\bwrong\b|\bmissed\b|not what i/i;
// Replay sessions run in a worktree under the evals work dir; they are the
// experiment, not new evidence.
const isReplaySession = (c) => /evals-work/.test(c.project || '');

const head = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Pure: the new candidates since `seen`, and which of them look corrected. */
export function weeklyDigest(cands, seen = new Set()) {
  const fresh = cands.filter((c) => !seen.has(c.id) && !isReplaySession(c));
  // One turn often fans out to several delegations; list the turn once.
  const byTurn = new Map();
  for (const c of fresh) {
    if (!CORRECTION_RE.test(c.nextUserPrompt || '')) continue;
    const key = `${c.session}\u0000${c.userPrompt}`;
    if (byTurn.has(key)) byTurn.get(key).count += 1;
    else byTurn.set(key, { ...c, count: 1 });
  }
  return { fresh, suspects: [...byTurn.values()], groups: groupCounts(fresh) };
}

export function formatDigest({ fresh, suspects, groups }, { days }) {
  const lines = [`✇ sprag 위임 사례 후보 (최근 ${days}일)`];
  if (!fresh.length) {
    lines.push('새 위임이 없습니다.');
    return lines.join('\n');
  }
  lines.push(`새 위임 ${fresh.length}건이 있고 다음 턴에 사용자가 결과를 고친 것으로 보이는 요청은 ${suspects.length}건입니다.`);
  const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
  lines.push(`대상별: ${top.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (suspects.length) {
    lines.push('', '조용한 손실 의심:');
    for (const c of suspects.slice(0, 10)) {
      const fan = c.count > 1 ? ` 외 ${c.count - 1}건` : '';
      lines.push(`• ${c.id}${fan} ${c.subagentType || c.model || 'default'} / ${c.effort || '-'}: ${head(c.userPrompt, 60)}`);
      lines.push(`  다음 턴: ${head(c.nextUserPrompt, 60)}`);
    }
  }
  lines.push('', '다음 단계: 후보를 골라 cases/<id>.md와 rubric을 먼저 쓰고 `npm run evals:replay -- <round> --dry-run`으로 예상 토큰을 확인한 뒤 승인받아 돌립니다. 후보 전체는 handoff/evals-work/candidates.jsonl에 있습니다.');
  return lines.join('\n');
}

export async function main(argv = [], { now = Date.now(), post, root } = {}) {
  const dry = argv.includes('--dry-run');
  const envFile = argv.includes('--env-file') ? argv[argv.indexOf('--env-file') + 1] : undefined;
  const work = workDir();
  const statePath = join(work, 'weekly-state.json');
  const state = readJson(statePath, { lastRun: null, seen: [] });
  const days = state.lastRun ? Math.max(1, Math.ceil((now - Date.parse(state.lastRun)) / DAY)) : 7;
  const cands = harvest({ days, work, ...(root ? { root } : {}) });
  const digest = weeklyDigest(cands, new Set(state.seen));
  const text = formatDigest(digest, { days });
  if (dry) {
    console.log(text);
    return 0;
  }
  if (!post) {
    const { slackConfig, slackPost } = await import('../upstream-watch.mjs');
    const slack = slackConfig(envFile);
    post = (t) => slackPost(slack, t);
  }
  await post(text);
  // State moves only after Slack accepted the post, so a failed run is retried.
  mkdirSync(work, { recursive: true });
  const seen = [...new Set([...state.seen, ...digest.fresh.map((c) => c.id)])].slice(-5000);
  writeFileSync(statePath, JSON.stringify({ lastRun: new Date(now).toISOString(), seen }, null, 2) + '\n');
  console.log(`posted: ${digest.fresh.length} new, ${digest.suspects.length} suspected`);
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`weekly: ${e.message}`);
    process.exitCode = 1;
  });
}
