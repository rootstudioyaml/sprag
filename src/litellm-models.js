/**
 * litellm-models: LiteLLM 게이트웨이의 `/model/info` 로부터 프로파일 ID → 모델
 * 계열 매핑을 가져와 profile-map.json의 gateway 절에 캐시합니다.
 *
 * 왜 이 모듈이 필요한가: model-alias.js는 트랜스크립트의 서브에이전트 실행
 * 기록을 모아 프로파일 ID의 역할(main/opus/sonnet/haiku)을 투표로 추정합니다.
 * 이 학습 경로는 조건이 까다로워서(explicit 3표 이상·80% 동의) 대부분의
 * 사용자에게서 매핑이 비어 있거나 늦게 채워집니다. 반면 LiteLLM
 * `GET /model/info`는 배포마다 litellm_params.model(ARN)과 model_name(계열이
 * 드러나는 이름)을 함께 돌려주므로, 게이트웨이가 이미 알고 있는 매핑을 굳이
 * 투표로 다시 추론할 필요가 없습니다. 이 모듈은 그 지름길을 구현합니다.
 *
 * 왜 키를 인자로만 받는가: apiKeyHelper가 토큰의 수명(TTL)을 소유합니다. 이
 * 모듈이 키를 파일이나 모듈 전역에 사본으로 두면 그 수명과 어긋나게 되므로,
 * 사용자 지시에 따라 이 파일은 resolveKey()를 호출하지 않고 항상 key 인자로
 * 전달받은 값만 요청 헤더에 씁니다. 키는 저장 객체·로그·에러 메시지 어디에도
 * 남기지 않습니다.
 *
 * 왜 렌더 경로가 이 모듈을 기다리지 않는가: litellm-budget.js와 같은 모양으로,
 * 네트워크 호출(refreshGatewayModelMap)은 갱신 경로(사람이 직접 실행하는
 * `sprag profile-map --refresh`, 또는 litellm-budget 갱신에 편승하는
 * maybeRefreshGatewayModelMap)에서만 일어납니다. statusline 렌더는
 * readGatewayModelMap로 캐시 파일만 읽으므로 이 모듈이 fetch를 하는 동안
 * 멈추는 일이 없습니다.
 */

import { gatewayBase } from './gateway-auth.js';
import { loadProfileMap, saveProfileMap, profileIdFrom, isGatewayModelId } from './model-alias.js';
import { isRecognizedModelId } from './cost.js';
import { debug } from './debug.js';

/** 게이트웨이 모델 맵의 신선도 기준. 배포 구성은 하루에 여러 번 바뀌지 않습니다. */
export const MODEL_MAP_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;

// litellm_params.model / model_info.base_model 앞에 붙는 공급자 접두어.
// `bedrock/converse/`가 `bedrock/`의 접두어이기도 하므로, 긴 쪽을 먼저 검사해야
// `converse/`가 그대로 남는 일이 없습니다.
const PROVIDER_PREFIXES = ['bedrock/converse/', 'bedrock/', 'openai/', 'vertex_ai/', 'anthropic/'];

/**
 * 후보 문자열에서 공급자 접두어와 끝의 대괄호 접미어를 뗍니다.
 *
 * 접미어를 떼는 이유: 트랜스크립트는 컨텍스트 창 표시를 위해
 * `ap-northeast-2.anthropic.claude-opus-5[1m]` 형태로 모델을 기록하지만,
 * `/model/info`가 돌려주는 model_name/litellm_params.model에는 그 접미어가
 * 없습니다. 접미어를 떼지 않으면 같은 모델을 가리키는 두 문자열이 서로 다른
 * 키로 취급되어 별칭 판정이 실패합니다.
 *
 * ARN을 리소스 부분으로 줄이는 이유: ARN 문자열에는 12자리 AWS 계정 ID가 들어
 * 있어서, 그것을 그대로 키나 별칭 값으로 쓰면 계정 ID가 profile-map.json에
 * 기록됩니다. 리소스 부분만 남기면 `foundation-model` ARN은 계열명
 * (`anthropic.claude-opus-5`)으로 줄어 별칭 값으로 쓸 수 있게 되고,
 * `application-inference-profile` ARN은 불투명한 프로파일 ID로 줄어
 * isRecognizedModelId()를 통과하지 못하므로 값이 아니라 키로만 쓰입니다.
 * 줄이지 않으면 isRecognizedModelId()가 계열명을 품은 ARN 전체를 "인식됨"으로
 * 판정해(cost.js의 정규식 한 줄이므로) 계정 ID가 값 쪽으로도 새어 나갑니다.
 */
function normalizeCandidate(id) {
  if (typeof id !== 'string' || !id) return '';
  let s = id;
  if (isGatewayModelId(s)) return profileIdFrom(s) || '';
  for (const prefix of PROVIDER_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  return s.replace(/\[[^\]]*\]$/, '');
}

/**
 * `/model/info` 응답에서 프로파일 ID(또는 계열명 없는 사내 별칭) → 모델 계열
 * 매핑을 뽑아냅니다. 순수 함수입니다: 네트워크·파일 I/O가 없고, 잘못된 입력에도
 * 던지지 않습니다.
 *
 * 항목마다 별칭 후보를 model_name → model_info.base_model →
 * litellm_params.model 순으로 검사해, 정규화 후 isRecognizedModelId()를
 * 통과하는 첫 후보를 그 항목의 별칭으로 채택합니다. 세 후보 모두 인식하지
 * 못하면 아무것도 기록하지 않고 model_name을 skipped에 넣습니다. 추측으로
 * 잘못된 가격표를 매다는 것이 미해석 상태로 남기는 것보다 나쁩니다.
 *
 * 채택된 별칭에 대해 최대 두 개의 키를 기록합니다: (a) litellm_params.model이
 * ARN이면 그 프로파일 ID, (b) model_name 자체가 별칭과 다르면(계열명이 없는
 * 사내 별칭 사례) 정규화한 model_name. 이미 있는 키는 덮어쓰지 않습니다.
 * 같은 프로파일 ID를 여러 배포 항목이 가리키면 첫 항목이 우선합니다.
 *
 * @param {unknown} payload `/model/info` 응답 본문
 * @returns {{aliases: Record<string,string>, skipped: string[], count: number}}
 */
export function deriveAliasesFromModelInfo(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : null;
  if (!data) return { aliases: {}, skipped: [], count: 0 };

  const aliases = {};
  const skipped = [];

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const modelName = typeof item.model_name === 'string' ? item.model_name : '';
    const baseModel = typeof item.model_info?.base_model === 'string' ? item.model_info.base_model : '';
    const rawModel = typeof item.litellm_params?.model === 'string' ? item.litellm_params.model : '';

    let alias = null;
    for (const candidate of [modelName, baseModel, rawModel]) {
      const normalized = normalizeCandidate(candidate);
      if (normalized && isRecognizedModelId(normalized)) {
        alias = normalized;
        break;
      }
    }

    if (!alias) {
      if (modelName) skipped.push(modelName);
      continue;
    }

    // (a) ARN 프로파일 ID. profileIdFrom은 원문(정규화 전) 문자열에서 뽑아야
    // 합니다. 정규화는 공급자 접두어를 떼지만 ARN 본문은 그대로 두므로 원문을
    // 넘겨도 동작하지만, 다른 후보에서 뽑은 alias와 혼동하지 않도록 항상
    // litellm_params.model 원문을 씁니다.
    const pid = profileIdFrom(rawModel);
    if (pid && !(pid in aliases)) aliases[pid] = alias;

    // (b) 계열명이 없는 사내 별칭(model_name). 이미 별칭 자체로 채택된
    // 경우(정규화한 model_name === alias)는 중복이므로 기록하지 않습니다.
    const normalizedName = normalizeCandidate(modelName);
    if (normalizedName && normalizedName !== alias && !(normalizedName in aliases)) {
      aliases[normalizedName] = alias;
    }
  }

  return { aliases, skipped, count: data.length };
}

/**
 * profile-map.json의 gateway 절을 읽습니다. base가 현재 gatewayBase(env)와
 * 다르면 다른 게이트웨이의 캐시이므로 null을 돌려줍니다. 예산 캐시(budgetWindow)
 * 와 같은 방식으로 게이트웨이 주소 단위로 격리합니다.
 *
 * @returns {{base:string, fetchedAt:string, aliases:Record<string,string>,
 *            skipped:string[], count:number}|null}
 */
export function readGatewayModelMap(env = process.env) {
  const base = gatewayBase(env);
  if (!base) return null;
  const gateway = loadProfileMap()?.gateway;
  if (!gateway || typeof gateway !== 'object' || gateway.base !== base) return null;
  return gateway;
}

/** base와 신선도(TTL) 기준으로 gateway 절이 오래됐는지 판정합니다 (내부 공용). */
function isStaleFor(gateway, base, now) {
  if (!base) return true;
  if (!gateway || typeof gateway !== 'object' || gateway.base !== base) return true;
  const fetchedAt = Date.parse(gateway.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return now - fetchedAt > MODEL_MAP_TTL_MS;
}

/**
 * gateway 절이 없거나, 다른 게이트웨이 것이거나, fetchedAt이 MODEL_MAP_TTL_MS
 * 보다 오래됐으면 true.
 */
export function isGatewayModelMapStale(env = process.env, now = Date.now()) {
  const base = gatewayBase(env);
  return isStaleFor(loadProfileMap()?.gateway, base, now);
}

/**
 * LiteLLM `GET {base}/model/info`를 호출해 gateway 절을 갱신합니다.
 *
 * key는 호출자가 이미 확보해 둔 값을 그대로 받습니다. 이 함수는 resolveKey()를
 * 부르지 않고, key가 없으면 즉시 null을 돌려줍니다(헬퍼를 다시 부르지 않도록
 * 하기 위함이며, 헬퍼가 Okta 로그인을 띄우는 배포에서 이 함수가 조용히 그
 * 팝업을 다시 띄우는 일이 없어야 합니다).
 *
 * 실패(비 200·타임아웃·파싱 실패)는 예외를 던지지 않고 debug()로만 남기며,
 * 이 경우 profile-map.json을 건드리지 않습니다. 부분 실패로 기존 gateway
 * 절을 지우면 다음 렌더가 이미 알던 매핑까지 잃습니다.
 *
 * @returns {Promise<{aliases:Record<string,string>, skipped:string[], count:number}|null>}
 */
export async function refreshGatewayModelMap({ base, key, fetchImpl = fetch } = {}) {
  if (!base || !key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetchImpl(`${base}/model/info`, {
        signal: controller.signal,
        headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      });
    } catch (e) {
      debug('litellm-models:fetch', e);
      return null;
    }
    if (!res.ok) {
      debug('litellm-models:fetch', new Error(`LiteLLM responded ${res.status}`));
      return null;
    }
    let payload;
    try {
      // 응답 본문을 debug로 덤프하지 않습니다. 마스킹되지 않은 필드가 섞여
      // 있을 가능성을 배제할 수 없고, 파싱 실패 로그는 예외 메시지만으로 충분합니다.
      payload = await res.json();
    } catch (e) {
      debug('litellm-models:parse', e);
      return null;
    }

    const result = deriveAliasesFromModelInfo(payload);
    // 200 응답이라도 본문 형태가 다르면 실패로 취급합니다. deriveAliases…는
    // data가 배열이 아니면 빈 결과를 돌려주는데, 그 빈 결과를 그대로 기록하면
    // 잘 채워져 있던 캐시가 지워집니다. 형태 불일치는 게이트웨이 구성이 바뀐
    // 신호이거나 다른 서비스의 응답이므로, 옛 답을 남겨 두는 편이 안전합니다.
    if (!Array.isArray(payload?.data)) {
      debug('litellm-models:shape', new Error('response has no data array'));
      return null;
    }
    const map = loadProfileMap();
    // 별칭을 하나도 못 뽑았는데 기존 맵에는 있었다면 덮어쓰지 않습니다. 키가
    // 사라지는 쪽이 오래된 키를 남겨 두는 쪽보다 나쁘고(해석이 통째로 unknown이
    // 됩니다), 이 상태는 대개 일시적인 구성 오류입니다.
    const had = map.gateway?.base === base ? Object.keys(map.gateway.aliases || {}).length : 0;
    if (Object.keys(result.aliases).length === 0 && had > 0) {
      debug('litellm-models:empty', new Error(`derived 0 aliases, keeping ${had} cached`));
      return null;
    }
    // 기존 gateway 객체를 통째로 갈아치우고, modelAliases/learned는 수정하지
    // 않습니다. saveProfileMap이 호출 즉시 모듈 캐시(cached)를 next로 갱신하므로
    // resetModelAliasCache를 따로 부를 필요가 없습니다.
    const next = {
      ...map,
      gateway: {
        base,
        fetchedAt: new Date().toISOString(),
        aliases: result.aliases,
        skipped: result.skipped,
        count: result.count,
      },
    };
    saveProfileMap(next);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * gateway 절이 stale할 때만 refreshGatewayModelMap을 호출합니다. base/key가
 * 없으면 호출 없이 null.
 *
 * litellm-budget의 --refresh 경로가 이미 얻어 둔 key를 재사용해 이 함수를
 * 호출하므로, apiKeyHelper는 그 갱신 경로 안에서 한 번만 실행됩니다.
 */
export async function maybeRefreshGatewayModelMap({ base, key, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!base || !key) return null;
  if (!isStaleFor(loadProfileMap()?.gateway, base, now)) return null;
  return refreshGatewayModelMap({ base, key, fetchImpl });
}
