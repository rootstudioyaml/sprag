/**
 * Subcommand: profile-map. LiteLLM 게이트웨이의 프로파일 ID → 모델 계열 매핑을
 * 보여 주거나 갱신합니다.
 *
 *   sprag profile-map            # 캐시된 매핑을 사람이 읽을 수 있게 출력
 *   sprag profile-map --json     # profile-map.json 원본을 그대로 출력
 *   sprag profile-map --refresh  # LiteLLM GET /model/info 를 지금 호출해 캐시를 갱신
 *   sprag profile-map --quiet    # 위 어느 모드든 출력을 억제 (스크립트/자식 프로세스용)
 *
 * 왜 이 명령이 필요한가: model-alias.js 의 학습 경로(투표)는 서브에이전트
 * 실행이 MIN_VOTES 건 이상 쌓여야 판정이 서므로, 새 프로파일 ID 나 사용량이
 * 적은 티어는 오랫동안(또는 영원히) role=null 로 남는다. 반면 LiteLLM
 * `/model/info` 는 게이트웨이가 이미 알고 있는 배포 목록을 즉시 돌려주므로,
 * 이 명령으로 그 매핑을 캐시해 두면 학습을 기다릴 필요가 없다. 실제 판정은
 * model-alias.js 의 resolveModelAlias() 가 하고, 이 명령은 그 판정에 쓰이는
 * 세 출처(override/gateway/learned)를 사람이 확인할 수 있게 보여 줄 뿐이다.
 *
 * 왜 --refresh 에서만 resolveKey() 를 부르는가: apiKeyHelper 가 인증 토큰의
 * 수명(TTL)을 소유한다. 이 명령의 읽기 경로(플래그 없음/--json)는 캐시 파일만
 * 보므로 키가 전혀 필요 없고, --refresh 는 사람이 터미널에서 직접 실행하는
 * 경로라서 헬퍼가 Okta 로그인 창을 띄우더라도 괜찮다(사용자 지시). 얻은 키는
 * fetch 요청 헤더에만 쓰고, 화면에 출력하거나 파일에 쓰지 않는다.
 */

export async function run({ args, hasFlag }) {
  const { userLanguage } = await import('../config.js');
  const { loadProfileMap, aliasForRole, MIN_VOTES } = await import('../model-alias.js');
  const { gatewayBase, resolveKey } = await import('../gateway-auth.js');
  const { readGatewayModelMap, refreshGatewayModelMap } = await import('../litellm-models.js');

  const lang = userLanguage();
  const ko = lang === 'ko';
  const quiet = hasFlag('--quiet');
  const say = (line) => { if (!quiet) console.log(line); };

  const base = gatewayBase();
  if (!base) {
    // 오류가 아니다: 공식 API 를 직접 쓰는 사용자에게는 이 명령이 원래 할 일이
    // 없다. --refresh 와 --json 도 base 없이는 의미가 없으므로 여기서 함께
    // 걸러낸다.
    say(ko
      ? '게이트웨이가 감지되지 않았습니다 (ANTHROPIC_BASE_URL 필요). LiteLLM 등 게이트웨이 뒤에서 실행할 때만 쓰는 명령입니다.'
      : 'No gateway detected (ANTHROPIC_BASE_URL required). This command only matters behind a gateway such as LiteLLM.');
    return;
  }

  if (hasFlag('--refresh')) {
    const key = resolveKey();
    if (!key) {
      say(ko
        ? 'apiKeyHelper 가 토큰을 내주지 못했습니다. 인증을 마친 뒤 다시 실행하십시오.'
        : 'apiKeyHelper did not return a token. Authenticate, then run this again.');
      process.exitCode = 1;
      return;
    }
    const result = await refreshGatewayModelMap({ base, key });
    if (!result) {
      say(ko
        ? `LiteLLM 에서 모델 정보를 가져오지 못했습니다 (GET ${base}/model/info). CTS_DEBUG=1 로 다시 실행하면 원인이 보입니다.`
        : `Could not fetch model info from LiteLLM (GET ${base}/model/info). Re-run with CTS_DEBUG=1 to see why.`);
      process.exitCode = 1;
      return;
    }
    const resolved = Object.keys(result.aliases).length;
    say(ko
      ? `배포 ${result.count}건 중 ${resolved}개 키를 해석했습니다${result.skipped.length ? ` (미해석 ${result.skipped.length}건)` : ''}.`
      : `Resolved ${resolved} key(s) out of ${result.count} deployment(s)${result.skipped.length ? ` (${result.skipped.length} unresolved)` : ''}.`);
    if (result.skipped.length) {
      say(ko
        ? `  미해석 model_name: ${result.skipped.join(', ')}`
        : `  Unresolved model_name: ${result.skipped.join(', ')}`);
    }
    return;
  }

  const map = loadProfileMap();
  const gatewayMap = readGatewayModelMap();

  if (hasFlag('--json')) {
    say(JSON.stringify(map, null, 2));
    return;
  }

  say(ko ? `게이트웨이: ${base}` : `Gateway: ${base}`);

  if (gatewayMap) {
    const fetchedMs = Date.parse(gatewayMap.fetchedAt);
    const ageMin = Number.isFinite(fetchedMs) ? Math.max(0, Math.round((Date.now() - fetchedMs) / 60000)) : null;
    const resolved = Object.keys(gatewayMap.aliases || {}).length;
    say(ko
      ? `조회 ${ageMin === null ? '알 수 없음' : `${ageMin}분 전`} · 배포 ${gatewayMap.count}건 · 해석된 키 ${resolved}개`
      : `checked ${ageMin === null ? 'unknown' : `${ageMin}m ago`} · ${gatewayMap.count} deployment(s) · ${resolved} key(s) resolved`);
  } else {
    say(ko
      ? '게이트웨이 모델맵이 아직 없습니다. `sprag profile-map --refresh` 로 지금 가져오십시오.'
      : 'No gateway model map cached yet. Fetch it now with `sprag profile-map --refresh`.');
  }

  const overrideEntries = Object.entries(map.modelAliases || {});
  if (overrideEntries.length) {
    say(ko ? '\n사용자 매핑 (modelAliases):' : '\nUser overrides (modelAliases):');
    for (const [pattern, alias] of overrideEntries) {
      say(`  ${pattern} → ${alias} (override)`);
    }
  }

  const gwAliases = gatewayMap?.aliases || {};
  const learned = map.learned || {};
  // Set 으로 합치는 이유: 같은 프로파일 ID 가 두 출처 모두에 나타날 수 있고,
  // 그때 서로 다른 답을 준다면 그 자체가 사용자에게 알려야 할 신호다(학습이
  // 틀렸거나 게이트웨이 설정이 바뀌었다는 뜻).
  const keys = [...new Set([...Object.keys(gwAliases), ...Object.keys(learned)])].sort();

  if (keys.length) {
    say(ko ? '\n게이트웨이 · 학습 매핑:' : '\nGateway & learned mappings:');
    for (const key of keys) {
      const gwAlias = gwAliases[key];
      const entry = learned[key];

      if (gwAlias) {
        say(`  ${key} → ${gwAlias} (gateway)`);
        if (entry?.role) {
          const learnedAlias = aliasForRole(entry.role);
          if (learnedAlias && learnedAlias !== gwAlias) {
            say(ko
              ? `    ⚠ 학습 결과는 ${learnedAlias} 였습니다. 학습이 틀렸거나 게이트웨이 설정이 바뀌었을 수 있습니다.`
              : `    ⚠ the learned result was ${learnedAlias}. Either the learning was wrong, or the gateway config changed.`);
          }
        } else if (entry && !entry.role) {
          say(ko
            ? `    학습은 표 ${entry.total || 0}개로 판정 대기였지만, 게이트웨이가 이미 해석했으므로 더 이상 문제되지 않습니다.`
            : `    Learning was still undecided at ${entry.total || 0} vote(s), but the gateway already resolves this, so it is no longer an issue.`);
        }
        continue;
      }

      if (entry?.role) {
        const learnedAlias = aliasForRole(entry.role);
        say(learnedAlias
          ? `  ${key} → ${learnedAlias} (learned · ${entry.role})`
          : (ko ? `  ${key} → ${entry.role} 역할 · 별칭 미확정 (learned)` : `  ${key} → ${entry.role} role · alias undecided (learned)`));
      } else if (entry) {
        say(ko
          ? `  ${key} → 표 ${entry.total || 0}개 · 판정 대기 (기준 ${MIN_VOTES}개, learned)`
          : `  ${key} → ${entry.total || 0} vote(s) · undecided (needs ${MIN_VOTES}, learned)`);
      }
    }
  }

  if (!overrideEntries.length && !keys.length) {
    say(ko
      ? '\n등록된 매핑이 없습니다.'
      : '\nNo mappings recorded yet.');
  }

  if (gatewayMap?.skipped?.length) {
    say(ko
      ? `\n게이트웨이가 계열명을 알아내지 못한 배포: ${gatewayMap.skipped.join(', ')}.`
      : `\nDeployments the gateway could not name a family for: ${gatewayMap.skipped.join(', ')}.`);
    say(ko
      ? '  profile-map.json 의 modelAliases 에 해당 이름을 직접 매핑하십시오.'
      : '  Map those names directly under modelAliases in profile-map.json.');
  }
}
