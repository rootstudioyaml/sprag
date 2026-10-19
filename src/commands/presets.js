/**
 * Subcommand: presets — which presets this machine uses, and fetching them.
 *
 *   sprag presets [status]        source, version, fetch times, signing key, next check
 *   sprag presets sync [--force]  fetch the published bundle now (read-only)
 *   sprag presets show [--json]   the effective ratchet, model-routing and agent presets
 *
 * The published bundle comes from the /ops console and applies only when its
 * signature verifies; otherwise the presets bundled with this version are used.
 */

const REASONS = {
  en: {
    'no-cache': 'no published bundle has been fetched yet',
    disabled: 'remote presets are off (SPRAG_NO_PRESET_SYNC=1 or SPRAG_NO_UPDATE_CHECK=1)',
    'no-keys': 'no signing keys yet: this version ships no public key, so a published bundle is not applied',
    unsigned: 'the published bundle is not signed',
    'unknown-kid': 'the bundle is signed with a key this version does not know',
    'bad-sig': 'the signature does not match the bundle',
    'min-cli': 'the bundle needs a newer sprag (min_cli)',
    format: 'the bundle format is newer than this version understands',
    shape: 'the bundle is malformed',
    'too-large': 'the bundle is larger than 200 KB',
    older: 'the bundle is older than the one already in use',
  },
  ko: {
    'no-cache': '아직 받아 온 게시 번들이 없습니다',
    disabled: '원격 프리셋이 꺼져 있습니다 (SPRAG_NO_PRESET_SYNC=1 또는 SPRAG_NO_UPDATE_CHECK=1)',
    'no-keys': '아직 서명 키가 없습니다. 이 버전에 공개 키가 들어 있지 않아 게시 번들을 적용하지 않습니다',
    unsigned: '게시 번들에 서명이 없습니다',
    'unknown-kid': '이 버전이 모르는 키로 서명된 번들입니다',
    'bad-sig': '서명이 번들 내용과 맞지 않습니다',
    'min-cli': '더 새 버전의 sprag 가 필요한 번들입니다 (min_cli)',
    format: '이 버전이 읽지 못하는 새 번들 형식입니다',
    shape: '번들 형식이 잘못됐습니다',
    'too-large': '번들이 200 KB 를 넘습니다',
    older: '이미 쓰고 있는 번들보다 오래된 번들입니다',
  },
};

function when(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function run({ args, hasFlag }) {
  const sub = args[1] || 'status';
  const { userLanguage } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const R = REASONS[ko ? 'ko' : 'en'];
  const why = (r) => R[r] || r;
  const src = await import('../presets-source.js');
  const sync = await import('../preset-sync.js');
  const { PRESET_SIGNING_KEYS } = await import('../preset-sign.js');

  if (sub === 'sync') {
    const res = await sync.syncPresets({ force: hasFlag('--force') });
    if (hasFlag('--background')) return;
    const v = res.version ? `v${res.version}` : '';
    const lines = {
      disabled: ko ? `받지 않았습니다. ${R.disabled}` : `Not fetched: ${R.disabled}`,
      none: ko ? '서버에 게시된 프리셋 번들이 없습니다. 패키지에 들어 있는 프리셋을 씁니다' : 'Nothing is published on the server. The bundled presets stay in use.',
      current: ko ? `이미 최신입니다 (${v})` : `Already current (${v}).`,
      updated: ko ? `${v} 을 받았습니다. 다음 세션부터 적용됩니다` : `Fetched ${v}. It applies from the next session start.`,
      rejected: ko ? `${v} 을 받았지만 적용하지 않습니다. ${why(res.reason)}` : `Fetched ${v} but did not apply it: ${why(res.reason)}.`,
      error: ko ? `가져오지 못했습니다 (${res.reason}). 패키지에 들어 있는 프리셋을 계속 씁니다` : `Could not fetch (${res.reason}). The presets in use stay as they are.`,
    };
    console.log(lines[res.status] || res.status);
    if (res.status === 'error') process.exitCode = 1;
    return;
  }

  if (sub === 'show') {
    const out = {
      source: src.presetSource(),
      ratchet_rules: src.ratchetPresetEntries(),
      model_rules: src.modelPresets(),
      agents: src.agentDefinitions(),
    };
    if (hasFlag('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
    const s = out.source;
    console.log(s.kind === 'remote'
      ? (ko ? `출처: 게시 번들 v${s.version}` : `Source: published bundle v${s.version}`)
      : (ko ? `출처: sprag ${src.cliVersion()} 동봉 프리셋` : `Source: bundled with sprag ${src.cliVersion()}`));
    console.log('');
    console.log(ko ? `래칫 프리셋 ${out.ratchet_rules.length}건` : `Ratchet presets (${out.ratchet_rules.length})`);
    for (const r of out.ratchet_rules) {
      const text = (ko ? r.ko : r.en).replace(/\s+/g, ' ');
      console.log(`  [${r.id}]${r.agents ? ` (${r.agents.join(', ')})` : ''} ${text.length > 110 ? text.slice(0, 109) + '…' : text}`);
    }
    console.log('');
    console.log(ko ? `모델 라우팅 프리셋 ${out.model_rules.length}건` : `Model-routing presets (${out.model_rules.length})`);
    for (const m of out.model_rules) {
      console.log(`  [${m.id}] ${m.tier} · ${ko ? m.label : m.labelEn} → ${m.agent}`);
    }
    console.log('');
    console.log(ko ? `위임 에이전트 ${out.agents.length}개` : `Delegation agents (${out.agents.length})`);
    for (const a of out.agents) {
      console.log(`  ${a.name}  model=${a.model} effort=${a.effort} tools=${a.tools.join(', ')}`);
    }
    return;
  }

  if (sub !== 'status') {
    console.error(ko ? '사용법: sprag presets [status|sync [--force]|show [--json]]' : 'Usage: sprag presets [status|sync [--force]|show [--json]]');
    process.exitCode = 2;
    return;
  }

  const cache = src.readRemoteCache();
  const s = src.presetSource();
  const disabled = src.presetSyncDisabled();
  const lines = [];
  if (s.kind === 'remote') {
    lines.push(ko ? `프리셋 출처: 게시 번들 v${s.version} (받은 시각 ${when(s.fetchedAt)})`
      : `Presets source: published bundle v${s.version} (fetched ${when(s.fetchedAt)})`);
  } else {
    lines.push(ko ? `프리셋 출처: sprag ${src.cliVersion()} 동봉 프리셋 (대체 경로)`
      : `Presets source: bundled with sprag ${src.cliVersion()} (fallback)`);
    // Nothing applied but something was fetched: the rejection is the answer.
    const reason = s.reason === 'no-cache' && cache.rejected && cache.rejected.reason ? cache.rejected.reason : s.reason;
    lines.push(ko ? `  이유: ${why(reason)}` : `  Why: ${why(reason)}`);
  }
  // Signing key status, independent of whether anything has been fetched.
  const seenKid = (cache.bundle && cache.bundle.sig && cache.bundle.sig.kid) || null;
  let keyLine;
  if (PRESET_SIGNING_KEYS.length === 0) {
    keyLine = ko ? '서명 키: 아직 없음. 공개 키가 들어간 버전이 나오기 전까지 게시 번들을 적용하지 않습니다'
      : 'Signing keys: none yet. Published bundles are not applied until a release ships the public key.';
  } else if (s.kind === 'remote') {
    keyLine = ko ? `서명 키: 정상 (${s.kid})` : `Signing key: ok (${s.kid})`;
  } else if (seenKid && !PRESET_SIGNING_KEYS.some((k) => k.kid === seenKid)) {
    keyLine = ko ? `서명 키: 모르는 키 (${seenKid})` : `Signing key: unknown kid (${seenKid})`;
  } else {
    keyLine = ko ? `서명 키: ${PRESET_SIGNING_KEYS.map((k) => k.kid).join(', ')}` : `Signing keys: ${PRESET_SIGNING_KEYS.map((k) => k.kid).join(', ')}`;
  }
  lines.push(keyLine);
  if (cache.rejected && cache.rejected.version != null) {
    lines.push(ko ? `마지막으로 거절한 번들: v${cache.rejected.version} (${why(cache.rejected.reason)})`
      : `Last rejected: v${cache.rejected.version} (${why(cache.rejected.reason)})`);
  }
  if (cache.lastError && cache.lastError.message) {
    lines.push(ko ? `마지막 오류: ${cache.lastError.message} (${when(cache.lastError.at)})`
      : `Last error: ${cache.lastError.message} (${when(cache.lastError.at)})`);
  }
  lines.push(ko ? `마지막 확인: ${when(cache.checkedAt) || '없음'}` : `Last check: ${when(cache.checkedAt) || 'never'}`);
  if (disabled) {
    lines.push(ko ? '다음 확인: 꺼져 있음' : 'Next check: off');
  } else {
    const next = sync.nextPresetCheckAt(cache);
    lines.push(!next || next <= Date.now()
      ? (ko ? '다음 확인: 다음 세션 시작 때' : 'Next check: at the next session start')
      : (ko ? `다음 확인: ${when(next)} 이후 세션 시작 때` : `Next check: at the first session start after ${when(next)}`));
  }
  console.log(lines.join('\n'));
}
