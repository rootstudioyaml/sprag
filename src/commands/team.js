/**
 * team — `sprag team <create|join|name|leave|status|sync|rules|propose|town>`.
 *
 * The opt-in team layer. `join` shows exactly what will be uploaded (daily
 * aggregates and a delegation rule summary) and asks before enrolling. `sync --background` is what the
 * SessionStart hook's detached child runs: auto-join from SPRAG_TEAM_TOKEN,
 * then upload and pull, printing nothing. All network access goes through
 * rpc() in src/team-sync.js. Exit codes: 0 ok, 1 error, 2 usage.
 */

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { userLanguage } from '../config.js';
import { pendingPrompts } from '../team-prompts.js';
import { memberId } from '../member-id.js';
import { teamRuleText } from '../team-ratchet.js';
import { ruleStatsSummary } from '../team-rule-stats.js';
import { orgMinVersion, readOrgUpgrade, orgUpgradeInFlight } from '../org-upgrade.js';
import {
  loadTeamState, deviceInfo, isJoined, joinTeam, leaveTeam, syncTeam, autoJoin, aggregateDaily, rpc,
  teamRulesCachePath, teamSyncDisabled, verifySignInCode, listAuthenticators, verifyAuthenticatorCode, createTeam, isSeatLimitError, isOrgExpiredError,
  setDisplayName,
} from '../team-sync.js';
import { standingGuideLines } from '../team-standing.js';
import { readDiag } from '../diag-log.js';
import { envVar } from '../env.js';

const T = {
  en: {
    usage: [
      'Usage: sprag team <command>',
      '  create [--email <e>] [--name <n>] [--code <6 digits>] [--app-code <6 digits>] [--org <org-id>] [--no-join]   create a team (you become the owner)',
      '  join [token] [--name <n>] [--yes]   join a team (token or SPRAG_TEAM_TOKEN)',
      '  name [<n>]                           show or change your display name',
      '  leave                                leave the team and stop uploading',
      '  status [--show-payload]              membership, standing and what the next species takes, last sync, what is sent (daily aggregates and rule summary)',
      '  sync [--force] [--rules-only]        upload aggregates, prompts (Enterprise capture) and pull rules now',
      '                                       (--rules-only: pull organization and team rules only, upload nothing)',
      '  rules                                show cached organization and team rules',
      '  propose <text> [--scope ratchet|model]   propose a rule to the team',
      '  town [--no-open]                     open the read-only town in your browser (link valid 12 hours)',
    ].join('\n'),
    willSend: 'Joining uploads aggregates only. Per local day:\n  - spend (USD)\n  - savings (USD)\n  - delegation run counts\n  - model-family share\nAnd one summary of your delegation rules, per category and tier:\n  - category, tier, delegation count, failure rate, savings (USD)\nError messages from sprag itself (to fix problems on your machine). Home paths, host names and secrets are masked.\nNo prompts, rule text, examples, file paths or transcripts are sent.',
    rulesPayload: 'delegation rule summary (member_rules_report)',
    asName: (n) => `Display name: ${n}`,
    asDevice: (d) => `Machine ID: ${d} (lets the organization count this machine once if it joins again)`,
    ask: 'Join? [y/N] ',
    needYes: 'Not a terminal. Re-run with --yes to confirm: sprag team join <token> --yes',
    noToken: 'Missing invite token. Pass it as an argument or set SPRAG_TEAM_TOKEN.',
    aborted: 'Not joined.',
    joined: (n) => `Joined team "${n}". Check it with: sprag team status`,
    seatLimit: 'This organization has no free seat. Ask your organization owner or admin to add seats, then join again.',
    orgExpired: "This organization's paid term has ended, so the server no longer accepts uploads or joins. Ask your organization owner to renew it (support@sprag.io).",
    org: 'Organization',
    seats: (u, l) => `${u}/${l} seats used`,
    orgCreated: (n, u, l) => `Organization: ${n}${u != null && l != null ? ` (${u}/${l} seats used)` : ''}`,
    badOrg: '--org needs an organization id.',
    noOrgCreate: 'Only Sprag opens new organizations. Pass --org <id> for an organization you administer (the id is on the dashboard), or write to support@sprag.io to open one.',
    left: 'Left the team. Nothing is uploaded any more.',
    notJoined: 'Not in a team. Join with: sprag team join <token>',
    team: 'Team', plan: 'Plan', capture: 'Prompt capture', name: 'Display name',
    lastSync: (t, n) => `Last sync: ${t} (${n} rows)`,
    neverSynced: 'Last sync: never',
    lastError: 'Last error',
    orgMin: (min, cur) => `Organization minimum version: v${min} (this machine runs v${cur})`,
    orgUpgradeRunning: (t) => `Organization upgrade to v${t} is running in the background (log: org-upgrade.log)`,
    orgUpgradeOk: (t, when) => `Last organization upgrade: v${t} installed (${when})`,
    orgUpgradeFailed: (t, when, e) => `Last organization upgrade: v${t} failed (${when}): ${e}. Run sprag upgrade yourself.`,
    on: 'on', off: 'off',
    lastPrompts: (t, n) => `Last prompt upload: ${t} (${n} prompts)`,
    noPrompts: 'Last prompt upload: never',
    pendingPrompts: (n) => `Prompts waiting to upload: ${n}`,
    diagWaiting: (n, last) => `Diagnostics waiting to upload: ${n} (last upload: ${last})`,
    diagNever: 'never',
    diagPayload: 'diagnostics (diag_upload)',
    pendingExample: (e) => `Example (redacted): ${e.at} · ${e.project || '-'} · ${e.text}`,
    disabled: 'Team sync is disabled (SPRAG_NO_TEAM_SYNC=1).',
    skipped: (s) => `Skipped: ${s}`,
    synced: (u, r, p) => `Synced: ${u} day rows uploaded, ${r} rules${p ? `, ${p} prompts` : ''}.`,
    rulesPulled: (r) => `Rules updated: ${r} organization and team rules. A new session applies them.`,
    noRules: 'No organization or team rules yet.',
    proposed: (id) => `Proposed. Id: ${id}`,
    needText: 'Missing rule text. Usage: sprag team propose <text> [--scope ratchet|model]',
    badScope: 'Scope must be ratchet or model.',
    needJoin: 'Join a team first: sprag team join <token>',
    renamed: (n) => `Display name changed to "${n}". The dashboard shows it from now on.`,
    nameHint: 'Change it with: sprag team name "<new name>"',
    nameUnsupported: 'The team server does not support renaming yet. Try again after it is updated.',
    createUsage: 'Usage: sprag team create --email <e> --name "<team name>" [--code <6 digits>] [--app-code <6 digits>] [--no-join]',
    badEmail: 'That does not look like an email address.',
    badCode: 'The code is 6 digits, like 123456.',
    needEmail: 'Missing --email. Usage: sprag team create --email <e> --name "<team name>"',
    needName: 'Missing --name. Usage: sprag team create --email <e> --name "<team name>" --code <6 digits>',
    alreadyJoined: (n) => `This machine is already in team "${n}". Run \`sprag team leave\` first, or pass --no-join.`,
    askEmail: 'Your email: ',
    askCode: 'Code from the email (6 digits): ',
    askAppCode: 'Code from your authenticator app (6 digits): ',
    badAppCode: 'The authenticator code is 6 digits, like 123456.',
    needAppCode: (e, n) => `Missing --app-code. Run: sprag team create --email ${e} --name "${n}" --code <code> --app-code <authenticator code>`,
    noAuthenticator: 'This account has no authenticator app yet. Sign in once at https://sprag.io/team/ to enroll one (Google Authenticator or any app that makes 6-digit codes), then run this again.',
    askTeamName: (d) => `Team name [${d}]: `,
    getCode: (e) => `Request your sign-in code at ${CODE_URL} : enter ${e} there and the 6-digit code arrives by mail (valid 30 minutes). The request runs in the browser because it passes a Cloudflare check.`,
    rerun: (e, n) => `Then run: sprag team create --email ${e} --name "${n}" --code <code> --app-code <authenticator code>`,
    created: (n) => `Created team "${n}".`,
    inviteToken: 'Invite token',
    memberCmd: 'Member command',
    orgLine: 'Organization env',
    dashboard: (e) => `Dashboard: https://sprag.io/team/ (sign in with ${e})`,
    noJoinNote: 'This machine did not join (--no-join).',
    syncFailed: (e) => `Team created, but the first sync failed: ${e}`,
    townLink: (u) => `Town link: ${u}`,
    townExpiry: (when) => `You can open it until ${when} (12 hours). Numbers show for you alone; teammates appear as characters.`,
    townRate: 'Too many town links in a short time. Wait a few minutes and try again.',
    townBadReply: 'The team server sent no usable town link. Try again later.',
    townUnsupported: 'The team server does not support the member town yet. Try again after it is updated.',
  },
  ko: {
    usage: [
      '사용법: sprag team <명령>',
      '  create [--email <e>] [--name <이름>] [--code <6자리>] [--app-code <6자리>] [--org <조직 ID>] [--no-join]   팀 만들기 (만든 사람이 조직 오너)',
      '  join [토큰] [--name <이름>] [--yes]   팀에 참여 (토큰 또는 SPRAG_TEAM_TOKEN)',
      '  name [<이름>]                          표시 이름 보기 또는 바꾸기',
      '  leave                                  팀에서 나가고 업로드 중단',
      '  status [--show-payload]                참여 상태, 순위와 다음 등급까지의 거리, 마지막 동기화, 보내는 내용(하루 집계와 룰 요약)',
      '  sync [--force] [--rules-only]          지금 집계를 올리고 규칙을 받기',
      '                                         (--rules-only: 조직·팀 규칙만 받고 아무것도 올리지 않음)',
      '  rules                                  받아 둔 조직·팀 규칙 보기',
      '  propose <내용> [--scope ratchet|model]   팀에 규칙 제안',
      '  town [--no-open]                       읽기 전용 타운을 브라우저로 열기 (링크 12시간 유효)',
    ].join('\n'),
    willSend: '참여하면 집계만 올라갑니다. 로컬 날짜별로는 다음과 같습니다.\n  - 지출(USD)\n  - 절감(USD)\n  - 위임 실행 횟수\n  - 모델 계열 비중\n위임 룰은 카테고리와 티어별 요약 한 벌이 올라갑니다.\n  - 카테고리, 티어, 위임 횟수, 실패율, 절감액(USD)\nsprag 자체의 오류 메시지(이 기기의 문제를 고치는 데 씁니다). 홈 경로, 호스트 이름, 비밀 값은 가려서 보냅니다.\n프롬프트, 룰 본문, 예시, 파일 경로, 대화 기록은 보내지 않습니다.',
    rulesPayload: '위임 룰 요약 (member_rules_report)',
    asName: (n) => `표시 이름: ${n}`,
    asDevice: (d) => `기기 ID: ${d} (다시 참여해도 조직이 이 컴퓨터를 한 좌석으로 셉니다)`,
    ask: '참여할까요? [y/N] ',
    needYes: '터미널이 아닙니다. 확인하려면 --yes 를 붙여 다시 실행하세요: sprag team join <토큰> --yes',
    noToken: '초대 토큰이 없습니다. 인자로 넘기거나 SPRAG_TEAM_TOKEN 을 설정하세요.',
    aborted: '참여하지 않았습니다.',
    joined: (n) => `팀 "${n}" 에 참여했습니다. 확인: sprag team status`,
    seatLimit: '이 조직에 남은 좌석이 없습니다. 조직 오너나 어드민에게 좌석 추가를 요청한 뒤 다시 참여하세요',
    orgExpired: '조직의 이용 기간이 끝나 서버가 업로드와 참여를 받지 않습니다. 조직 오너에게 연장을 요청하세요(support@sprag.io)',
    org: '조직',
    seats: (u, l) => `좌석 ${u}/${l} 사용 중`,
    orgCreated: (n, u, l) => `조직: ${n}${u != null && l != null ? ` (좌석 ${u}/${l} 사용 중)` : ''}`,
    badOrg: '--org 에는 조직 ID 가 필요합니다',
    noOrgCreate: '새 조직은 Sprag가 개설합니다. 관리하는 조직이 있으면 --org <ID> 를 붙여 주세요(ID 는 대시보드에 있습니다). 조직 개설은 support@sprag.io 로 문의해 주세요.',
    left: '팀에서 나왔습니다. 이제 아무것도 업로드하지 않습니다.',
    notJoined: '참여한 팀이 없습니다. 참여하려면: sprag team join <토큰>',
    team: '팀', plan: '플랜', capture: '프롬프트 수집', name: '표시 이름',
    lastSync: (t, n) => `마지막 동기화: ${t} (${n}행)`,
    neverSynced: '마지막 동기화: 아직 없음',
    lastError: '마지막 오류',
    orgMin: (min, cur) => `조직 최소 버전: v${min} (이 컴퓨터는 v${cur} 실행 중)`,
    orgUpgradeRunning: (t) => `조직 정책에 따라 v${t} 로 백그라운드 업그레이드를 진행 중입니다 (로그: org-upgrade.log)`,
    orgUpgradeOk: (t, when) => `마지막 조직 업그레이드: v${t} 설치 완료 (${when})`,
    orgUpgradeFailed: (t, when, e) => `마지막 조직 업그레이드: v${t} 설치 실패 (${when}): ${e}. sprag upgrade 를 직접 실행하십시오.`,
    on: '켜짐', off: '꺼짐',
    lastPrompts: (t, n) => `마지막 프롬프트 업로드: ${t} (${n}건)`,
    noPrompts: '마지막 프롬프트 업로드: 아직 없음',
    pendingPrompts: (n) => `업로드 대기 중인 프롬프트: ${n}건`,
    diagWaiting: (n, last) => `업로드 대기 중인 진단 기록: ${n}건 (마지막 업로드: ${last})`,
    diagNever: '아직 없음',
    diagPayload: '진단 기록 (diag_upload)',
    pendingExample: (e) => `예시 (비밀값 가림): ${e.at} · ${e.project || '-'} · ${e.text}`,
    disabled: '팀 동기화가 꺼져 있습니다 (SPRAG_NO_TEAM_SYNC=1).',
    skipped: (s) => `건너뜀: ${s}`,
    synced: (u, r, p) => `동기화 완료: ${u}일치 집계 업로드, 규칙 ${r}개${p ? `, 프롬프트 ${p}건` : ''}.`,
    rulesPulled: (r) => `규칙을 받았습니다: 조직·팀 규칙 ${r}개. 새 세션부터 적용됩니다.`,
    noRules: '아직 조직이나 팀 규칙이 없습니다.',
    proposed: (id) => `제안했습니다. ID: ${id}`,
    needText: '규칙 내용이 없습니다. 사용법: sprag team propose <내용> [--scope ratchet|model]',
    badScope: '범위는 ratchet 또는 model 이어야 합니다.',
    needJoin: '먼저 팀에 참여하세요: sprag team join <토큰>',
    renamed: (n) => `표시 이름을 바꿨습니다: ${n}. 이제부터 대시보드에 이 이름이 나옵니다.`,
    nameHint: '바꾸려면: sprag team name "<새 이름>"',
    nameUnsupported: '팀 서버가 아직 이름 변경을 지원하지 않습니다. 서버가 갱신된 뒤 다시 시도하세요.',
    createUsage: '사용법: sprag team create --email <e> --name "<팀 이름>" [--code <6자리>] [--app-code <6자리>] [--no-join]',
    badEmail: '이메일 주소 형식이 아닙니다',
    badCode: '코드는 123456 같은 6자리 숫자입니다',
    needEmail: '--email 이 없습니다. 사용법: sprag team create --email <e> --name "<팀 이름>"',
    needName: '--name 이 없습니다. 사용법: sprag team create --email <e> --name "<팀 이름>" --code <6자리>',
    alreadyJoined: (n) => `이 PC는 이미 팀 "${n}" 에 참여 중입니다. 먼저 \`sprag team leave\` 를 실행하거나 --no-join 을 붙이세요`,
    askEmail: '이메일: ',
    askCode: '메일로 받은 코드 (6자리): ',
    askAppCode: '인증 앱 코드 (6자리): ',
    badAppCode: '인증 앱 코드는 123456 같은 6자리 숫자입니다',
    needAppCode: (e, n) => `--app-code 가 없습니다. 실행: sprag team create --email ${e} --name "${n}" --code <코드> --app-code <인증 앱 코드>`,
    noAuthenticator: '이 계정에는 아직 인증 앱이 없습니다. https://sprag.io/team/ 에 한 번 로그인해 인증 앱(Google Authenticator처럼 6자리 코드를 만드는 앱)을 등록한 뒤 다시 실행하세요',
    askTeamName: (d) => `팀 이름 [${d}]: `,
    getCode: (e) => `로그인 코드는 ${CODE_URL} 에서 요청하세요. 거기에 ${e} 을 입력하면 6자리 코드가 메일로 옵니다(30분간 유효). Cloudflare 확인을 거치기 때문에 브라우저에서 요청합니다`,
    rerun: (e, n) => `받은 코드로 다시 실행하세요: sprag team create --email ${e} --name "${n}" --code <코드> --app-code <인증 앱 코드>`,
    created: (n) => `팀 "${n}" 을 만들었습니다`,
    inviteToken: '초대 토큰',
    memberCmd: '멤버용 명령',
    orgLine: '조직 환경 변수',
    dashboard: (e) => `대시보드: https://sprag.io/team/ (${e} 로 로그인)`,
    noJoinNote: '이 PC는 참여하지 않았습니다 (--no-join)',
    syncFailed: (e) => `팀은 만들어졌지만 첫 동기화에 실패했습니다: ${e}`,
    townLink: (u) => `타운 링크: ${u}`,
    townExpiry: (when) => `${when}까지 열 수 있습니다(12시간). 숫자는 내 기록만 보이고 동료는 캐릭터로만 나옵니다.`,
    townRate: '타운 링크를 짧은 시간에 너무 많이 만들었습니다. 몇 분 뒤에 다시 시도하세요.',
    townBadReply: '팀 서버가 쓸 수 있는 타운 링크를 주지 않았습니다. 잠시 뒤에 다시 시도하세요.',
    townUnsupported: '팀 서버가 아직 멤버 타운을 지원하지 않습니다. 서버가 갱신된 뒤 다시 시도하세요.',
  },
};

/**
 * `sprag team rules` lines: `- [org · model] text`, organization rules first.
 * Rows without a level (older servers) are team rules. Removed ids are skipped.
 */
export function formatRuleLines(cache, { lang = userLanguage() } = {}) {
  const removed = new Set(Array.isArray(cache?.removed) ? cache.removed : []);
  const textOf = (r) => teamRuleText(r, { lang });
  const rules = (Array.isArray(cache?.rules) ? cache.rules : [])
    .filter((r) => r && textOf(r) && !removed.has(r.id));
  const org = rules.filter((r) => r.level === 'org');
  const team = rules.filter((r) => r.level !== 'org');
  return [...org, ...team].map((r) =>
    `- [${r.level === 'org' ? 'org' : 'team'} · ${r.scope === 'model' ? 'model' : 'ratchet'}] ${textOf(r).replace(/\s*\n\s*/g, ' ')}`);
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

async function confirm(question) {
  return /^y(es)?$/i.test(await prompt(question));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Where the sign-in code is requested: the page runs the Cloudflare check the team server demands. */
const CODE_URL = 'https://sprag.io/team/';
/** Opens the URL in the default browser and never fails: the message already carries the address. */
function openInBrowser(url) {
  const win = process.platform === 'win32';
  const cmd = process.platform === 'darwin' ? 'open' : win ? 'cmd' : 'xdg-open';
  const args = win ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* no opener on this machine */ }
}
const CODE_RE = /^\d{6}$/;
/** Where the member town lives. SPRAG_TOWN_URL points it at a local server (site/ served by scripts/serve-site.mjs). */
export const TOWN_URL = 'https://sprag.io/town/';
export const townUrl = (env = process.env) => envVar('TOWN_URL', env) || TOWN_URL;
const TOWN_TOKEN_RE = /^stv_[0-9a-f]{64}$/;
// The default display name is the machine id; `status` and `join` then point at `team name`.
const MACHINE_NAME_RE = /^member-[0-9a-f]{8}$/;

/** `sprag team create`: sign in by emailed code, insert the team, join as first member. */
async function createFlow({ m, out, hasFlag, getArg, version, fetch, interactive, ask, openUrl = openInBrowser }) {
  const noJoin = hasFlag('--no-join');
  const st0 = loadTeamState();
  if (isJoined(st0) && !noJoin) { console.error(m.alreadyJoined(st0.teamName || '')); return process.exit(1); }

  const org = getArg('--org');
  if (hasFlag('--org') && (!org || org.startsWith('--'))) { console.error(m.badOrg); return process.exit(2); }
  let email = getArg('--email');
  let name = getArg('--name');
  const code = getArg('--code');
  if (code !== undefined && code !== null && !CODE_RE.test(String(code))) { console.error(m.badCode); return process.exit(2); }
  if (!email && interactive) email = await ask(m.askEmail);
  if (!email) { console.error(m.needEmail); return process.exit(2); }
  if (!EMAIL_RE.test(email)) { console.error(m.badEmail); return process.exit(2); }

  const defaultName = `${memberId()}'s team`;

  let useCode = code;
  if (!useCode) {
    /* The code request passes Cloudflare Turnstile, so it happens on the sign-in page, not here. */
    out(m.getCode(email));
    if (!interactive) { out(m.rerun(email, name || defaultName)); return undefined; }
    openUrl(CODE_URL);
    useCode = await ask(m.askCode);
    if (!CODE_RE.test(useCode)) { console.error(m.badCode); return process.exit(2); }
  }
  if (!name && interactive) name = (await ask(m.askTeamName(defaultName))) || defaultName;
  if (!name) { console.error(m.needName); return process.exit(2); }

  const first = await verifySignInCode({ email, code: useCode, fetch });
  const userId = first.userId;
  /* Second step: the authenticator app. The server refuses team_create below aal2 (sprag-team 20261108000100). */
  const apps = await listAuthenticators({ accessToken: first.accessToken, factors: first.factors, fetch });
  if (!apps.length) { console.error(m.noAuthenticator); return process.exit(1); }
  let appCode = getArg('--app-code');
  if (appCode !== undefined && appCode !== null && !CODE_RE.test(String(appCode))) { console.error(m.badAppCode); return process.exit(2); }
  if (!appCode) {
    if (!interactive) { console.error(m.needAppCode(email, name)); return process.exit(2); }
    appCode = await ask(m.askAppCode);
    if (!CODE_RE.test(appCode)) { console.error(m.badAppCode); return process.exit(2); }
  }
  const { accessToken } = await verifyAuthenticatorCode({ accessToken: first.accessToken, factorId: apps[0].id, code: appCode, fetch });
  let team;
  try {
    team = await createTeam({ name, accessToken, userId, orgId: org || null, fetch });
  } catch (e) {
    if (/only Sprag operators/i.test(String(e && e.message))) { console.error(m.noOrgCreate); return process.exit(1); }
    throw e;
  }
  out(m.created(team.name || name));
  if (team.orgName && noJoin) out(m.orgCreated(team.orgName, null, null));
  out(`${m.inviteToken}: ${team.inviteToken}`);
  out(`${m.memberCmd}: npm i -g sprag-cli@latest && sprag team join ${team.inviteToken}`);
  out(`${m.orgLine}: export SPRAG_TEAM_TOKEN=${team.inviteToken}`);
  out(m.dashboard(email));

  if (noJoin) { out(m.noJoinNote); return undefined; }
  const display = memberId();
  const joined = await joinTeam({ token: team.inviteToken, displayName: display, fetch, version });
  if (joined.orgName && joined.seatsUsed != null && joined.seatLimit != null) out(m.orgCreated(joined.orgName, joined.seatsUsed, joined.seatLimit));
  if (!teamSyncDisabled()) {
    const r = await syncTeam({ force: true, fetch, version });
    if (r.error) console.error(m.syncFailed(r.error));
    else if (!r.skipped) out(m.synced(r.uploaded, r.rules, r.prompts));
  }
  return undefined;
}

export async function run({ args, hasFlag, getArg, version, fetch, interactive, ask, openUrl }) {
  const m = T[userLanguage()] || T.en;
  const verb = args[1];
  const out = (s) => console.log(s);

  try {
    switch (verb) {
      case 'create': {
        const tty = interactive !== undefined ? interactive : !!(process.stdin.isTTY && process.stdout.isTTY);
        return await createFlow({ m, out, hasFlag, getArg, version, fetch, interactive: tty, ask: ask || prompt, openUrl });
      }
      case 'join': {
        const token = (args[2] && !args[2].startsWith('--') ? args[2] : null) || process.env.SPRAG_TEAM_TOKEN;
        if (!token) { console.error(m.noToken); return process.exit(2); }
        // A rejoin keeps the name this machine had before (`team leave` keeps it in team.json).
        let name = getArg('--name');
        if (!name) name = String(loadTeamState().displayName || '').trim() || memberId();
        out(m.willSend);
        out(m.asName(name));
        out(m.asDevice(memberId()));
        if (!hasFlag('--yes')) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error(m.needYes); return process.exit(2); }
          if (!(await confirm(m.ask))) { out(m.aborted); return undefined; }
        }
        const st = await joinTeam({ token, displayName: name, fetch, version });
        out(m.joined(st.teamName));
        if (st.orgName && st.seatsUsed != null && st.seatLimit != null) out(m.orgCreated(st.orgName, st.seatsUsed, st.seatLimit));
        if (MACHINE_NAME_RE.test(String(st.displayName || ''))) out(m.nameHint);
        return undefined;
      }
      case 'name':
      case 'rename': {
        const st = loadTeamState();
        if (!isJoined(st)) { console.error(m.needJoin); return process.exit(2); }
        const next = args.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
        if (!next) { out(`${m.name}: ${st.displayName}`); out(m.nameHint); return undefined; }
        if (teamSyncDisabled()) { out(m.disabled); return undefined; }
        try {
          out(m.renamed(await setDisplayName({ displayName: next, fetch })));
        } catch (e) {
          if (/Could not find the function|PGRST202/i.test(String(e && e.message))) { console.error(m.nameUnsupported); return process.exit(1); }
          throw e;
        }
        return undefined;
      }
      case 'leave':
        await leaveTeam();
        out(m.left);
        return undefined;
      case 'status': {
        const st = loadTeamState();
        if (!isJoined(st)) { out(m.notJoined); return undefined; }
        out(`${m.team}: ${st.teamName}`);
        if (st.orgName) out(`${m.org}: ${st.orgName}`);
        out(`${m.plan}: ${st.plan}`);
        out(`${m.capture}: ${st.promptCapture ? m.on : m.off}`);
        if (st.promptCapture) {
          out(st.lastPromptUploadAt ? m.lastPrompts(new Date(st.lastPromptUploadAt).toLocaleString(), st.lastPromptCount || 0) : m.noPrompts);
        }
        out(`${m.name}: ${st.displayName}`);
        if (MACHINE_NAME_RE.test(String(st.displayName || ''))) out(`  ${m.nameHint}`);
        // The standing behind the statusline chip, and what moving up takes
        // (src/team-standing.js). Nothing until the first sync has fetched one.
        for (const l of standingGuideLines(st.standing, { lang: userLanguage(), org: st.orgName || st.teamName || null, team: st.teamName || null })) out(l);
        out(st.lastSyncAt ? m.lastSync(new Date(st.lastSyncAt).toLocaleString(), st.lastSyncRows || 0) : m.neverSynced);
        if (st.lastError) out(isOrgExpiredError(st.lastError) ? m.orgExpired : `${m.lastError}: ${st.lastError}`);
        out(m.diagWaiting(readDiag().length, st.lastDiagAt ? new Date(st.lastDiagAt).toLocaleString() : m.diagNever));
        if (orgMinVersion(st)) out(m.orgMin(orgMinVersion(st), version));
        {
          const up = readOrgUpgrade();
          if (up.target) {
            if (orgUpgradeInFlight(up)) out(m.orgUpgradeRunning(up.target));
            else if (Number.isFinite(up.finishedAt)) {
              const when = new Date(up.finishedAt).toLocaleString();
              out(up.ok ? m.orgUpgradeOk(up.target, when) : m.orgUpgradeFailed(up.target, when, up.error || '-'));
            }
          }
        }
        if (hasFlag('--show-payload')) {
          out(`device: ${JSON.stringify(st.deviceInfo || deviceInfo())}`);
          out(JSON.stringify(await aggregateDaily(), null, 2));
          out(`${m.rulesPayload}: ${JSON.stringify(ruleStatsSummary(), null, 2)}`);
          out(`${m.diagPayload}: ${JSON.stringify(readDiag(), null, 2)}`);
          if (st.promptCapture) {
            const pend = await pendingPrompts();
            out(m.pendingPrompts(pend.count));
            if (pend.example) out(m.pendingExample(pend.example));
          }
        }
        return undefined;
      }
      case 'sync': {
        const rulesOnly = hasFlag('--rules-only');
        if (hasFlag('--background')) {
          if (!hasFlag('--prompts-only') && !rulesOnly) await autoJoin({ version });
          await syncTeam({ version, promptsOnly: hasFlag('--prompts-only'), rulesOnly });
          return undefined;
        }
        // Run by hand, --rules-only always pulls (no hourly gate).
        const r = await syncTeam({ force: hasFlag('--force') || rulesOnly, rulesOnly, version });
        if (hasFlag('--quiet')) return undefined;
        if (r.error) { console.error(r.error); return process.exit(1); }
        if (r.skipped) out(r.skipped === 'disabled' ? m.disabled : m.skipped(r.skipped));
        else if (r.rulesOnly) out(m.rulesPulled(r.rules));
        else out(m.synced(r.uploaded, r.rules, r.prompts));
        return undefined;
      }
      case 'rules': {
        let cache = null;
        try { cache = JSON.parse(readFileSync(teamRulesCachePath(), 'utf8')); } catch { /* none cached */ }
        if (formatRuleLines(cache).length === 0) { out(m.noRules); return undefined; }
        for (const line of formatRuleLines(cache)) out(line);
        return undefined;
      }
      case 'propose': {
        const text = args.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--scope').join(' ').trim();
        if (!text) { console.error(m.needText); return process.exit(2); }
        const scope = getArg('--scope') || 'ratchet';
        if (scope !== 'ratchet' && scope !== 'model') { console.error(m.badScope); return process.exit(2); }
        const st = loadTeamState();
        if (!isJoined(st)) { console.error(m.needJoin); return process.exit(2); }
        if (teamSyncDisabled()) { out(m.disabled); return undefined; }
        const id = await rpc('team_rule_propose', { member_key: st.memberKey, rule_text: text, scope });
        out(m.proposed(id));
        return undefined;
      }
      case 'town': {
        const st = loadTeamState();
        if (!isJoined(st)) { console.error(m.needJoin); return process.exit(1); }
        if (teamSyncDisabled()) { out(m.disabled); return undefined; }
        let reply;
        try {
          reply = await rpc('town_view_link', { member_key: st.memberKey }, { fetch });
        } catch (e) {
          const msg = String(e && e.message);
          if (/too many town links/i.test(msg)) { console.error(m.townRate); return process.exit(1); }
          if (/Could not find the function|PGRST202/i.test(msg)) { console.error(m.townUnsupported); return process.exit(1); }
          throw e;
        }
        const token = reply && typeof reply.token === 'string' ? reply.token : '';
        if (!TOWN_TOKEN_RE.test(token)) { console.error(m.townBadReply); return process.exit(1); }
        // The token rides in the fragment: the browser never sends it to the web server, and the page strips it from the address bar.
        const url = `${townUrl()}#t=${token}`;
        const when = new Date(reply.expires_at);
        out(m.townLink(url));
        if (!Number.isNaN(when.getTime())) out(m.townExpiry(when.toLocaleString()));
        if (!hasFlag('--no-open')) (openUrl || openInBrowser)(url);
        return undefined;
      }
      default:
        out(m.usage);
        return verb && verb !== 'help' ? process.exit(2) : undefined;
    }
  } catch (e) {
    console.error(isSeatLimitError(e) ? m.seatLimit : isOrgExpiredError(e) ? m.orgExpired : e.message);
    return process.exit(1);
  }
}
