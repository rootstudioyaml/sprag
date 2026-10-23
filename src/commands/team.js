/**
 * team — `sprag team <create|join|leave|status|sync|rules|propose>`.
 *
 * The opt-in team layer. `join` shows exactly what will be uploaded (daily
 * aggregates only) and asks before enrolling. `sync --background` is what the
 * SessionStart hook's detached child runs: auto-join from SPRAG_TEAM_TOKEN,
 * then upload and pull, printing nothing. All network access goes through
 * rpc() in src/team-sync.js. Exit codes: 0 ok, 1 error, 2 usage.
 */

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { userLanguage } from '../config.js';
import { pendingPrompts } from '../team-prompts.js';
import { memberId } from '../member-id.js';
import {
  loadTeamState, deviceInfo, isJoined, joinTeam, leaveTeam, syncTeam, autoJoin, aggregateDaily, rpc,
  teamRulesCachePath, teamSyncDisabled, requestSignInCode, verifySignInCode, createTeam, isSeatLimitError,
} from '../team-sync.js';

const T = {
  en: {
    usage: [
      'Usage: sprag team <command>',
      '  create [--email <e>] [--name <n>] [--code <6 digits>] [--org <org-id>] [--no-join]   create a team (you become the owner)',
      '  join [token] [--name <n>] [--yes]   join a team (token or SPRAG_TEAM_TOKEN)',
      '  leave                                leave the team and stop uploading',
      '  status [--show-payload]              membership, last sync, what is sent',
      '  sync [--force] [--rules-only]        upload aggregates, prompts (Enterprise capture) and pull rules now',
      '                                       (--rules-only: pull organization and team rules only, upload nothing)',
      '  rules                                show cached organization and team rules',
      '  propose <text> [--scope ratchet|model]   propose a rule to the team',
    ].join('\n'),
    willSend: 'Joining uploads daily aggregates only, per local day:\n  - spend (USD)\n  - savings (USD)\n  - delegation run counts\n  - model-family share\nNo prompts, file paths or transcripts are sent.',
    asName: (n) => `Display name: ${n}`,
    asDevice: (d) => `Machine ID: ${d} (lets the organization count this machine once if it joins again)`,
    ask: 'Join? [y/N] ',
    needYes: 'Not a terminal. Re-run with --yes to confirm: sprag team join <token> --yes',
    noToken: 'Missing invite token. Pass it as an argument or set SPRAG_TEAM_TOKEN.',
    aborted: 'Not joined.',
    joined: (n) => `Joined team "${n}". Check it with: sprag team status`,
    seatLimit: 'This organization has no free seat. Ask your organization owner or admin to add seats, then join again.',
    org: 'Organization',
    seats: (u, l) => `${u}/${l} seats used`,
    orgCreated: (n, u, l) => `Organization: ${n}${u != null && l != null ? ` (${u}/${l} seats used)` : ''}`,
    badOrg: '--org needs an organization id.',
    noOrgCreate: 'Only Sprag opens new organizations. Pass --org <id> for an organization you administer (the id is on the dashboard), or write to sales@sprag.io to open one.',
    left: 'Left the team. Nothing is uploaded any more.',
    notJoined: 'Not in a team. Join with: sprag team join <token>',
    team: 'Team', plan: 'Plan', capture: 'Prompt capture', name: 'Display name',
    lastSync: (t, n) => `Last sync: ${t} (${n} rows)`,
    neverSynced: 'Last sync: never',
    lastError: 'Last error',
    on: 'on', off: 'off',
    lastPrompts: (t, n) => `Last prompt upload: ${t} (${n} prompts)`,
    noPrompts: 'Last prompt upload: never',
    pendingPrompts: (n) => `Prompts waiting to upload: ${n}`,
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
    createUsage: 'Usage: sprag team create --email <e> --name "<team name>" [--code <6 digits>] [--no-join]',
    badEmail: 'That does not look like an email address.',
    badCode: 'The code is 6 digits, like 123456.',
    needEmail: 'Missing --email. Usage: sprag team create --email <e> --name "<team name>"',
    needName: 'Missing --name. Usage: sprag team create --email <e> --name "<team name>" --code <6 digits>',
    alreadyJoined: (n) => `This machine is already in team "${n}". Run \`sprag team leave\` first, or pass --no-join.`,
    askEmail: 'Your email: ',
    askCode: 'Code from the email (6 digits): ',
    askTeamName: (d) => `Team name [${d}]: `,
    codeSent: (e) => `A 6-digit code was sent to ${e} (valid 15 minutes).`,
    rerun: (e, n) => `Then run: sprag team create --email ${e} --name "${n}" --code <code>`,
    created: (n) => `Created team "${n}".`,
    inviteToken: 'Invite token',
    memberCmd: 'Member command',
    orgLine: 'Organization env',
    dashboard: (e) => `Dashboard: https://sprag.io/team/ (sign in with ${e})`,
    noJoinNote: 'This machine did not join (--no-join).',
    syncFailed: (e) => `Team created, but the first sync failed: ${e}`,
  },
  ko: {
    usage: [
      '사용법: sprag team <명령>',
      '  create [--email <e>] [--name <이름>] [--code <6자리>] [--org <조직 ID>] [--no-join]   팀 만들기 (만든 사람이 조직 오너)',
      '  join [토큰] [--name <이름>] [--yes]   팀에 참여 (토큰 또는 SPRAG_TEAM_TOKEN)',
      '  leave                                  팀에서 나가고 업로드 중단',
      '  status [--show-payload]                참여 상태, 마지막 동기화, 보내는 내용',
      '  sync [--force] [--rules-only]          지금 집계를 올리고 규칙을 받기',
      '                                         (--rules-only: 조직·팀 규칙만 받고 아무것도 올리지 않음)',
      '  rules                                  받아 둔 조직·팀 규칙 보기',
      '  propose <내용> [--scope ratchet|model]   팀에 규칙 제안',
    ].join('\n'),
    willSend: '참여하면 로컬 날짜별 하루 단위 집계만 올라갑니다.\n  - 지출(USD)\n  - 절감(USD)\n  - 위임 실행 횟수\n  - 모델 계열 비중\n프롬프트, 파일 경로, 대화 기록은 보내지 않습니다.',
    asName: (n) => `표시 이름: ${n}`,
    asDevice: (d) => `기기 ID: ${d} (다시 참여해도 조직이 이 컴퓨터를 한 좌석으로 셉니다)`,
    ask: '참여할까요? [y/N] ',
    needYes: '터미널이 아닙니다. 확인하려면 --yes 를 붙여 다시 실행하세요: sprag team join <토큰> --yes',
    noToken: '초대 토큰이 없습니다. 인자로 넘기거나 SPRAG_TEAM_TOKEN 을 설정하세요.',
    aborted: '참여하지 않았습니다.',
    joined: (n) => `팀 "${n}" 에 참여했습니다. 확인: sprag team status`,
    seatLimit: '이 조직에 남은 좌석이 없습니다. 조직 오너나 어드민에게 좌석 추가를 요청한 뒤 다시 참여하세요',
    org: '조직',
    seats: (u, l) => `좌석 ${u}/${l} 사용 중`,
    orgCreated: (n, u, l) => `조직: ${n}${u != null && l != null ? ` (좌석 ${u}/${l} 사용 중)` : ''}`,
    badOrg: '--org 에는 조직 ID 가 필요합니다',
    noOrgCreate: '새 조직은 Sprag가 개설합니다. 관리하는 조직이 있으면 --org <ID> 를 붙여 주세요(ID 는 대시보드에 있습니다). 조직 개설은 sales@sprag.io 로 문의해 주세요.',
    left: '팀에서 나왔습니다. 이제 아무것도 업로드하지 않습니다.',
    notJoined: '참여한 팀이 없습니다. 참여하려면: sprag team join <토큰>',
    team: '팀', plan: '플랜', capture: '프롬프트 수집', name: '표시 이름',
    lastSync: (t, n) => `마지막 동기화: ${t} (${n}행)`,
    neverSynced: '마지막 동기화: 아직 없음',
    lastError: '마지막 오류',
    on: '켜짐', off: '꺼짐',
    lastPrompts: (t, n) => `마지막 프롬프트 업로드: ${t} (${n}건)`,
    noPrompts: '마지막 프롬프트 업로드: 아직 없음',
    pendingPrompts: (n) => `업로드 대기 중인 프롬프트: ${n}건`,
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
    createUsage: '사용법: sprag team create --email <e> --name "<팀 이름>" [--code <6자리>] [--no-join]',
    badEmail: '이메일 주소 형식이 아닙니다',
    badCode: '코드는 123456 같은 6자리 숫자입니다',
    needEmail: '--email 이 없습니다. 사용법: sprag team create --email <e> --name "<팀 이름>"',
    needName: '--name 이 없습니다. 사용법: sprag team create --email <e> --name "<팀 이름>" --code <6자리>',
    alreadyJoined: (n) => `이 PC는 이미 팀 "${n}" 에 참여 중입니다. 먼저 \`sprag team leave\` 를 실행하거나 --no-join 을 붙이세요`,
    askEmail: '이메일: ',
    askCode: '메일로 받은 코드 (6자리): ',
    askTeamName: (d) => `팀 이름 [${d}]: `,
    codeSent: (e) => `${e} 로 6자리 코드를 보냈습니다 (15분간 유효)`,
    rerun: (e, n) => `받은 코드로 다시 실행하세요: sprag team create --email ${e} --name "${n}" --code <코드>`,
    created: (n) => `팀 "${n}" 을 만들었습니다`,
    inviteToken: '초대 토큰',
    memberCmd: '멤버용 명령',
    orgLine: '조직 환경 변수',
    dashboard: (e) => `대시보드: https://sprag.io/team/ (${e} 로 로그인)`,
    noJoinNote: '이 PC는 참여하지 않았습니다 (--no-join)',
    syncFailed: (e) => `팀은 만들어졌지만 첫 동기화에 실패했습니다: ${e}`,
  },
};

/**
 * `sprag team rules` lines: `- [org · model] text`, organization rules first.
 * Rows without a level (older servers) are team rules. Removed ids are skipped.
 */
export function formatRuleLines(cache) {
  const removed = new Set(Array.isArray(cache?.removed) ? cache.removed : []);
  const rules = (Array.isArray(cache?.rules) ? cache.rules : [])
    .filter((r) => r && typeof r.text === 'string' && r.text.trim() && !removed.has(r.id));
  const org = rules.filter((r) => r.level === 'org');
  const team = rules.filter((r) => r.level !== 'org');
  return [...org, ...team].map((r) =>
    `- [${r.level === 'org' ? 'org' : 'team'} · ${r.scope === 'model' ? 'model' : 'ratchet'}] ${r.text.trim().replace(/\s*\n\s*/g, ' ')}`);
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
const CODE_RE = /^\d{6}$/;

/** `sprag team create`: sign in by emailed code, insert the team, join as first member. */
async function createFlow({ m, out, hasFlag, getArg, version, fetch, interactive, ask }) {
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
    if (!interactive) {
      await requestSignInCode({ email, fetch });
      out(m.codeSent(email));
      out(m.rerun(email, name || defaultName));
      return undefined;
    }
    await requestSignInCode({ email, fetch });
    out(m.codeSent(email));
    useCode = await ask(m.askCode);
    if (!CODE_RE.test(useCode)) { console.error(m.badCode); return process.exit(2); }
  }
  if (!name && interactive) name = (await ask(m.askTeamName(defaultName))) || defaultName;
  if (!name) { console.error(m.needName); return process.exit(2); }

  const { accessToken, userId } = await verifySignInCode({ email, code: useCode, fetch });
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

export async function run({ args, hasFlag, getArg, version, fetch, interactive, ask }) {
  const m = T[userLanguage()] || T.en;
  const verb = args[1];
  const out = (s) => console.log(s);

  try {
    switch (verb) {
      case 'create': {
        const tty = interactive !== undefined ? interactive : !!(process.stdin.isTTY && process.stdout.isTTY);
        return await createFlow({ m, out, hasFlag, getArg, version, fetch, interactive: tty, ask: ask || prompt });
      }
      case 'join': {
        const token = (args[2] && !args[2].startsWith('--') ? args[2] : null) || process.env.SPRAG_TEAM_TOKEN;
        if (!token) { console.error(m.noToken); return process.exit(2); }
        let name = getArg('--name');
        if (!name) name = memberId();
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
        out(st.lastSyncAt ? m.lastSync(new Date(st.lastSyncAt).toLocaleString(), st.lastSyncRows || 0) : m.neverSynced);
        if (st.lastError) out(`${m.lastError}: ${st.lastError}`);
        if (hasFlag('--show-payload')) {
          out(`device: ${JSON.stringify(st.deviceInfo || deviceInfo())}`);
          out(JSON.stringify(await aggregateDaily(), null, 2));
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
      default:
        out(m.usage);
        return verb && verb !== 'help' ? process.exit(2) : undefined;
    }
  } catch (e) {
    console.error(isSeatLimitError(e) ? m.seatLimit : e.message);
    return process.exit(1);
  }
}
