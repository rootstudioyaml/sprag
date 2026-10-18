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
import { userInfo } from 'node:os';
import { userLanguage } from '../config.js';
import {
  loadTeamState, isJoined, joinTeam, leaveTeam, syncTeam, autoJoin, aggregateDaily, rpc,
  teamRulesCachePath, teamSyncDisabled, requestSignInCode, verifySignInCode, createTeam,
} from '../team-sync.js';

const T = {
  en: {
    usage: [
      'Usage: sprag team <command>',
      '  create [--email <e>] [--name <n>] [--code <6 digits>] [--no-join]   create a team (you become the owner)',
      '  join [token] [--name <n>] [--yes]   join a team (token or SPRAG_TEAM_TOKEN)',
      '  leave                                leave the team and stop uploading',
      '  status [--show-payload]              membership, last sync, what is sent',
      '  sync [--force]                       upload aggregates and pull team rules now',
      '  rules                                show cached team rules',
      '  propose <text> [--scope ratchet|model]   propose a rule to the team',
    ].join('\n'),
    willSend: 'Joining uploads daily aggregates only, per local day:\n  - spend (USD)\n  - savings (USD)\n  - delegation run counts\n  - model-family share\nNo prompts, file paths or transcripts are sent.',
    asName: (n) => `Display name: ${n}`,
    ask: 'Join? [y/N] ',
    needYes: 'Not a terminal. Re-run with --yes to confirm: sprag team join <token> --yes',
    noToken: 'Missing invite token. Pass it as an argument or set SPRAG_TEAM_TOKEN.',
    aborted: 'Not joined.',
    joined: (n) => `Joined team "${n}". Check it with: sprag team status`,
    left: 'Left the team. Nothing is uploaded any more.',
    notJoined: 'Not in a team. Join with: sprag team join <token>',
    team: 'Team', plan: 'Plan', capture: 'Prompt capture', name: 'Display name',
    lastSync: (t, n) => `Last sync: ${t} (${n} rows)`,
    neverSynced: 'Last sync: never',
    lastError: 'Last error',
    on: 'on', off: 'off',
    disabled: 'Team sync is disabled (CTS_NO_TEAM_SYNC=1).',
    skipped: (s) => `Skipped: ${s}`,
    synced: (u, r) => `Synced: ${u} day rows uploaded, ${r} team rules.`,
    noRules: 'No team rules yet.',
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
      '  create [--email <e>] [--name <이름>] [--code <6자리>] [--no-join]   팀 만들기 (만든 사람이 소유자)',
      '  join [토큰] [--name <이름>] [--yes]   팀에 참여 (토큰 또는 SPRAG_TEAM_TOKEN)',
      '  leave                                  팀에서 나가고 업로드 중단',
      '  status [--show-payload]                참여 상태, 마지막 동기화, 보내는 내용',
      '  sync [--force]                         지금 집계를 올리고 팀 규칙을 받기',
      '  rules                                  받아 둔 팀 규칙 보기',
      '  propose <내용> [--scope ratchet|model]   팀에 규칙 제안',
    ].join('\n'),
    willSend: '참여하면 로컬 날짜별 하루 단위 집계만 올라갑니다.\n  - 지출(USD)\n  - 절감(USD)\n  - 위임 실행 횟수\n  - 모델 계열 비중\n프롬프트, 파일 경로, 대화 기록은 보내지 않습니다.',
    asName: (n) => `표시 이름: ${n}`,
    ask: '참여할까요? [y/N] ',
    needYes: '터미널이 아닙니다. 확인하려면 --yes 를 붙여 다시 실행하세요: sprag team join <토큰> --yes',
    noToken: '초대 토큰이 없습니다. 인자로 넘기거나 SPRAG_TEAM_TOKEN 을 설정하세요.',
    aborted: '참여하지 않았습니다.',
    joined: (n) => `팀 "${n}" 에 참여했습니다. 확인: sprag team status`,
    left: '팀에서 나왔습니다. 이제 아무것도 업로드하지 않습니다.',
    notJoined: '참여한 팀이 없습니다. 참여하려면: sprag team join <토큰>',
    team: '팀', plan: '플랜', capture: '프롬프트 수집', name: '표시 이름',
    lastSync: (t, n) => `마지막 동기화: ${t} (${n}행)`,
    neverSynced: '마지막 동기화: 아직 없음',
    lastError: '마지막 오류',
    on: '켜짐', off: '꺼짐',
    disabled: '팀 동기화가 꺼져 있습니다 (CTS_NO_TEAM_SYNC=1).',
    skipped: (s) => `건너뜀: ${s}`,
    synced: (u, r) => `동기화 완료: ${u}일치 집계 업로드, 팀 규칙 ${r}개.`,
    noRules: '아직 팀 규칙이 없습니다.',
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

  let email = getArg('--email');
  let name = getArg('--name');
  const code = getArg('--code');
  if (code !== undefined && code !== null && !CODE_RE.test(String(code))) { console.error(m.badCode); return process.exit(2); }
  if (!email && interactive) email = await ask(m.askEmail);
  if (!email) { console.error(m.needEmail); return process.exit(2); }
  if (!EMAIL_RE.test(email)) { console.error(m.badEmail); return process.exit(2); }

  let osName = 'my';
  try { osName = userInfo().username || 'my'; } catch { /* no passwd entry */ }
  const defaultName = `${osName}'s team`;

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
  const team = await createTeam({ name, accessToken, userId, fetch });
  out(m.created(team.name || name));
  out(`${m.inviteToken}: ${team.inviteToken}`);
  out(`${m.memberCmd}: npm i -g sprag-cli@latest && sprag team join ${team.inviteToken}`);
  out(`${m.orgLine}: export SPRAG_TEAM_TOKEN=${team.inviteToken}`);
  out(m.dashboard(email));

  if (noJoin) { out(m.noJoinNote); return undefined; }
  let display = 'member';
  try { display = userInfo().username || 'member'; } catch { /* no passwd entry */ }
  await joinTeam({ token: team.inviteToken, displayName: display, fetch, version });
  if (!teamSyncDisabled()) {
    const r = await syncTeam({ force: true, fetch, version });
    if (r.error) console.error(m.syncFailed(r.error));
    else if (!r.skipped) out(m.synced(r.uploaded, r.rules));
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
        if (!name) { try { name = userInfo().username; } catch { name = 'member'; } }
        out(m.willSend);
        out(m.asName(name));
        if (!hasFlag('--yes')) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error(m.needYes); return process.exit(2); }
          if (!(await confirm(m.ask))) { out(m.aborted); return undefined; }
        }
        const st = await joinTeam({ token, displayName: name, version });
        out(m.joined(st.teamName));
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
        out(`${m.plan}: ${st.plan}`);
        out(`${m.capture}: ${st.promptCapture ? m.on : m.off}`);
        out(`${m.name}: ${st.displayName}`);
        out(st.lastSyncAt ? m.lastSync(new Date(st.lastSyncAt).toLocaleString(), st.lastSyncRows || 0) : m.neverSynced);
        if (st.lastError) out(`${m.lastError}: ${st.lastError}`);
        if (hasFlag('--show-payload')) out(JSON.stringify(await aggregateDaily(), null, 2));
        return undefined;
      }
      case 'sync': {
        if (hasFlag('--background')) {
          await autoJoin({ version });
          await syncTeam({ version });
          return undefined;
        }
        const r = await syncTeam({ force: hasFlag('--force'), version });
        if (hasFlag('--quiet')) return undefined;
        if (r.error) { console.error(r.error); return process.exit(1); }
        if (r.skipped) out(r.skipped === 'disabled' ? m.disabled : m.skipped(r.skipped));
        else out(m.synced(r.uploaded, r.rules));
        return undefined;
      }
      case 'rules': {
        let cache = null;
        try { cache = JSON.parse(readFileSync(teamRulesCachePath(), 'utf8')); } catch { /* none cached */ }
        const rules = cache && Array.isArray(cache.rules) ? cache.rules : [];
        if (rules.length === 0) { out(m.noRules); return undefined; }
        for (const r of rules) out(`- [${r.scope}] ${r.text}`);
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
    console.error(e.message);
    return process.exit(1);
  }
}
