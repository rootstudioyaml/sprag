/**
 * Subcommand: feedback — submit a bug report or feature request from the
 * terminal (or from a Claude Code session) without opening a browser.
 *
 *   sprag feedback "statusline이 IntelliJ에서 깨져요"
 *   sprag feedback --title "cache chip" "5m TTL 칩이 안 사라짐"
 *
 * Why this exists: GitHub issues require a logged-in browser session, and
 * corporate networks often block github.com entirely. This command tries
 * three transports in order and reports which one carried the message:
 *
 *   1. `gh` CLI, if installed and authenticated — files a real GitHub issue.
 *   2. Anonymous Google Form POST — no login, no GitHub access needed.
 *      (Only when the form endpoint below is configured for this build.)
 *   3. Local fallback — saves the report to a Markdown file and prints a
 *      prefilled GitHub new-issue URL to use from an unblocked machine.
 *
 * Metadata (tool version, OS, Node version) is attached automatically so a
 * report is diagnosable without a follow-up round trip.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { debug } from '../debug.js';

const REPO = 'rootstudioyaml/claude-token-saver';
const ISSUES_URL = `https://github.com/${REPO}/issues`;

// Anonymous submission endpoint (Google Form). A Google Form's formResponse
// URL accepts unauthenticated POSTs, which is exactly the property a
// login-free, GitHub-blocked-network path needs. Responses land in the
// maintainer's "claude-token-saver 피드백 (Feedback)" form (published
// 2026-09-13, responder access: anyone with the link).
//   id      — the /d/e/<id>/ segment of the form URL
//   message — entry.NNNN field id of the message question
//   meta    — entry.NNNN field id of the metadata question
const FORM = {
  id: '1FAIpQLScISjU8_t9y8xfp-X3jvLV6_RcSjQIJ4aydATC8NazkxcJbgg',
  message: 'entry.79517542',
  meta: 'entry.112678638',
};

function metadata(version) {
  return [
    `version: ${version}`,
    `os: ${process.platform} ${os.release()}`,
    `node: ${process.version}`,
  ].join('\n');
}

function tryGhCli(title, body) {
  try {
    const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 10_000 });
    if (auth.status !== 0) return null;
    const res = spawnSync('gh', ['issue', 'create', '-R', REPO, '--title', title, '--body', body],
      { encoding: 'utf8', timeout: 30_000 });
    if (res.status !== 0) { debug('feedback:gh', res.stderr); return null; }
    const url = String(res.stdout).trim().split('\n').pop();
    return { transport: 'gh', url };
  } catch (e) { debug('feedback:gh', e); return null; }
}

async function tryForm(title, body, meta) {
  if (!FORM) return null;
  try {
    const params = new URLSearchParams();
    params.set(FORM.message, `${title}\n\n${body}`);
    params.set(FORM.meta, meta);
    const res = await fetch(`https://docs.google.com/forms/d/e/${FORM.id}/formResponse`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { debug('feedback:form', `HTTP ${res.status}`); return null; }
    return { transport: 'form' };
  } catch (e) { debug('feedback:form', e); return null; }
}

function saveLocal(title, body, dataDir) {
  const dir = join(dataDir, 'feedback');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}.md`);
  writeFileSync(file, `# ${title}\n\n${body}\n`);
  const prefilled = `${ISSUES_URL}/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return { transport: 'local', file, prefilled };
}

export async function run({ args, getArg, version, dataDir }) {
  // --anonymous skips the gh transport: for people whose gh CLI is signed in
  // with an account they do not want attached to the report.
  const anonymous = args.includes('--anonymous');
  const rest = args.slice(1).filter((a, i, all) => {
    if (a === '--title') return false;
    if (all[i - 1] === '--title') return false;
    return !a.startsWith('--');
  });
  const message = rest.join(' ').trim();
  const explicitTitle = getArg('--title');

  if (!message) {
    console.log('usage: sprag feedback [--title "<제목>"] "<내용>"');
    console.log(`       (GitHub에서 직접 제보: ${ISSUES_URL})`);
    process.exitCode = 1;
    return;
  }

  const title = explicitTitle || (message.length > 60 ? `${message.slice(0, 57)}...` : message);
  const meta = metadata(version);
  const body = `${message}\n\n---\n${meta}`;

  const viaGh = anonymous ? null : tryGhCli(title, body);
  if (viaGh) {
    console.log(`feedback: GitHub 이슈로 등록했습니다 — ${viaGh.url}`);
    return;
  }

  const viaForm = await tryForm(title, message, meta);
  if (viaForm) {
    console.log('feedback: 제출했습니다. 감사합니다. (익명 제출이라 답변 추적은 GitHub 이슈에서만 가능합니다)');
    console.log(`          공개 트래커: ${ISSUES_URL}`);
    return;
  }

  const local = saveLocal(title, body, dataDir);
  console.log(`feedback: 온라인 제출 경로가 없어 로컬에 저장했습니다: ${local.file}`);
  console.log('          GitHub 접근이 가능한 환경에서 아래 주소를 열면 내용이 채워진 이슈 작성 화면이 나옵니다:');
  console.log(`          ${local.prefilled}`);
}
