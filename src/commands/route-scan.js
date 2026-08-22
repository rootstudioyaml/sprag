/**

 */

import { readStdinJson } from '../stdin-payload.js';
import { debug } from '../debug.js';

export async function run({ args, hasFlag, numArg }) {
    const rs = await import('../route-scan.js');
    const { userLanguage } = await import('../config.js');
    const lang = userLanguage();

    // route-scan savings — the delegation ledger behind the statusline's
    // "Routing saved" headline. The headline is one number; this is the
    // evidence for it: which rule fired, which model the work moved off, and
    // which model actually ran it.
    if (args[1] === 'savings') {
      const { loadLedger, delegationSavedTotals } = await import('../savings-ledger.js');
      const events = Object.entries(loadLedger().events)
        .map(([key, e]) => ({ key, ...e }))
        .sort((a, b) => b.ts - a.ts);
      if (events.length === 0) {
        console.log(lang === 'ko'
          ? '기록된 라우팅 절감 없음. 승격된 룰이 실제로 위임을 일으킨 뒤 `route-scan --refresh` 를 돌리면 채워집니다.'
          : 'No routing savings recorded yet. Promote a rule, let it delegate, then run `route-scan --refresh`.');
        return;
      }
      const t = delegationSavedTotals();
      const money = (v) => `$${v.toFixed(2)}`;
      // Lifetime leads (it is what the breakdown below adds up to); the
      // rolling windows follow as context rather than as competing headlines.
      console.log(lang === 'ko'
        ? `🔀 라우팅 절감 누적 ${money(t.total)}  (최근 7일 ${money(t.week)} · 30일 ${money(t.month)})`
        : `🔀 Routing saved, lifetime ${money(t.total)}  (last 7d ${money(t.week)} · 30d ${money(t.month)})`);

      // Per model-pair rollup first: the "what moved where" question is what
      // this view exists to answer, and it is easier to read than the log.
      const pairs = new Map();
      for (const e of events) {
        const k = `${e.from || '?'} → ${e.to || '?'}`;
        const p = pairs.get(k) || { runs: 0, usd: 0 };
        p.runs += 1;
        p.usd += Number(e.usd) || 0;
        pairs.set(k, p);
      }
      console.log('');
      console.log(lang === 'ko' ? '모델 이동별:' : 'By model change:');
      for (const [k, p] of [...pairs].sort((a, b) => b[1].usd - a[1].usd)) {
        const runs = lang === 'ko' ? `${p.runs}회` : `${p.runs} run${p.runs === 1 ? '' : 's'}`;
        console.log(`  ${k}  —  ${runs}, ${money(p.usd)}`);
      }

      console.log('');
      console.log(lang === 'ko' ? '실행별 (최근순):' : 'By run (newest first):');
      for (const e of events) {
        const when = new Date(e.ts).toISOString().slice(0, 10);
        console.log(`  ${when}  ${money(Number(e.usd) || 0).padStart(7)}  ${e.from || '?'} → ${e.to || '?'}`);
        console.log(`            ${lang === 'ko' ? '룰' : 'rule'}: ${e.rule || '(unattributed)'}`);
      }
      console.log('');
      console.log(lang === 'ko'
        ? '금액은 "룰 승격 전 그 유형을 처리하던 모델"과 실제 실행 모델의 가격 차이입니다 (토큰 수는 고정 가정).'
        : 'Each amount is the price gap between the model that handled this category before the rule and the model that actually ran it (token counts held constant).');
      return;
    }

    // route-scan rules [rm <N>] — the model-fitting rule registry (rules
    // promoted from candidates; auto-refreshed from logs on every rescan).
    if (args[1] === 'rules') {
      const mr = await import('../model-rules.js');
      if (args[2] === 'rm') {
        const n = parseInt(args[3], 10);
        const removed = Number.isFinite(n) ? mr.removeModelRule(n) : null;
        if (!removed) {
          console.error('Usage: claude-token-saver route-scan rules rm <N>   # N from `route-scan rules`');
          process.exit(1);
        }
        // A target whose last rule was removed gets its (tool-owned) file deleted.
        mr.syncAllFiles({ previousPaths: [mr.modelRatchetPathFor(removed.scope, removed.targetRoot)] });
        console.log(`Removed model-fitting rule #${n}: ${removed.rule}`);
        return;
      }
      const { rules } = mr.loadModelRules();
      if (rules.length === 0) {
        console.log(lang === 'ko' ? '등록된 모델 피팅 룰 없음.' : 'No model-fitting rules registered.');
        return;
      }
      console.log(lang === 'ko' ? '📐 모델 피팅 룰 (로그 기반 자동 갱신):' : '📐 Model-fitting rules (auto-refreshed from logs):');
      rules.forEach((r, i) => {
        const health = r.status === 'review'
          ? (lang === 'ko' ? '  ⚠ 에러율 초과 — 재검토 필요' : '  ⚠ error rate over threshold — needs review')
          : '';
        const stat = lang === 'ko'
          ? `${r.tier} (${rs.tierLabel(r.tier)}) · ${rs.scopeLabel(r.scope)} · 반복 ${r.count || 0}회 · 에러율 ${Math.round((r.errRate || 0) * 100)}%`
          : `${r.tier} (${rs.tierLabel(r.tier, 'en')}) · ${rs.scopeLabel(r.scope, 'en')} · seen ×${r.count || 0} · err ${Math.round((r.errRate || 0) * 100)}%`;
        console.log(`  #${i + 1} ${stat}${health}`);
        // Measured outcome of the rule actually firing, plus what it saved.
        // A rule with no measured delegations shows "—", never "$0.00": the
        // two mean opposite things (no data vs. data showing no value).
        const measured = r.delegatedRuns
          ? (lang === 'ko'
            ? `실제 위임 ${r.delegatedRuns}건 · 에러율 ${Math.round((r.delegatedErrRate || 0) * 100)}% · 절감 ~$${(r.savedUsd || 0).toFixed(2)}`
            : `measured ×${r.delegatedRuns} · err ${Math.round((r.delegatedErrRate || 0) * 100)}% · saved ~$${(r.savedUsd || 0).toFixed(2)}`)
          : (lang === 'ko' ? '실제 위임 기록 — (아직 없음)' : 'measured delegations — (none yet)');
        console.log(`      ${measured}`);
        // Same composer the md file uses, so what is listed here is exactly
        // what the model reads.
        console.log(`      ${mr.composeRuleText(r.rule, r, lang)}`);
      });
      console.log(lang === 'ko'
        ? '\n제거: claude-token-saver route-scan rules rm <N>'
        : '\nRemove with: claude-token-saver route-scan rules rm <N>');
      return;
    }

    if (args[1] === 'dismiss') {
      const n = parseInt(args[2], 10);
      if (!Number.isFinite(n)) {
        console.error('Usage: claude-token-saver route-scan dismiss <N>   # N from `route? R<N>`');
        process.exit(1);
      }
      const cand = rs.resolveCandidate(n);
      if (!cand) {
        console.error(`No route candidate R${n}. Run: claude-token-saver route-scan`);
        process.exit(1);
      }
      console.log(lang === 'ko'
        ? `R${n} 무시 처리: ${cand.label} (${cand.project}) — 재스캔에도 다시 뜨지 않습니다.`
        : `Dismissed R${n}: ${cand.label} (${cand.project}) — won't resurface on rescans.`);
      return;
    }

    // --hook: SessionStart hook mode. Never scans inline (session start must
    // stay fast) — reads the cache, kicks a detached refresh when stale, and
    // prints delegation-candidate context for the new session.
    if (hasFlag('--hook')) {
      const hookCtx = readStdinJson() || {};
      let cache = rs.readRouteScan();
      if (await rs.shouldRescan(cache)) {
        try {
          const { spawn } = await import('node:child_process');
          spawn(process.execPath, [process.argv[1], 'route-scan', '--refresh', '--quiet'],
            { detached: true, stdio: 'ignore' }).unref();
        } catch (e) { debug('route-scan:spawn-refresh', e); /* stale cache is still usable below */ }
      }
      const open = rs.openCandidates(cache);
      // Rule text shown to the model must be composed the same way the md file
      // composes it, budget clause included — otherwise the briefing promises
      // one rule and the file carries another.
      const mrHook = await import('../model-rules.js');
      const composed = (base, c) => mrHook.composeRuleText(base, c, lang);
      // Registered rules whose delegated-category error rate crossed the
      // health threshold since promotion — the user approved these, so a
      // status change must be briefed, not just written into the md file.
      let reviewRules = [];
      try {
        const mr = mrHook;
        reviewRules = mr.loadModelRules().rules
          .map((r, i) => ({ ...r, n: i + 1 }))
          .filter((r) => r.status === 'review');
      } catch (e) { debug('route-scan:load-rules', e); /* candidate briefing still goes out */ }
      // Korean writing guidance, when the user enabled it. Printed before the
      // route-scan briefing and independently of it: the style has to reach a
      // session even when there is no candidate to report, which is the usual
      // case. Injecting here rather than through a separate hook keeps it on
      // one SessionStart round-trip and one cached prefix.
      let koreanBlock = null;
      try {
        const { koreanStyleInjection } = await import('../korean-style.js');
        koreanBlock = koreanStyleInjection();
      } catch (e) { debug('route-scan:korean-style', e); /* style is optional */ }

      if (open.length === 0 && reviewRules.length === 0) {
        if (koreanBlock) console.log(koreanBlock);
        return; // nothing else to inject
      }
      // This text is injected straight into the model's context, so it must
      // follow the user's configured language — a Korean-only briefing in an
      // English session steers the whole first response into Korean.
      const lines = [];
      if (open.length > 0) {
        if (lang === 'ko') {
          lines.push(`[claude-token-saver route-scan] 최근 ${cache.days}일 세션에서 비싼 모델(opus/fable)이 반복 처리해 온, 더 싼 모델로 넘겨도 되는 작업이 감지되었습니다.`);
          lines.push('(R<N>은 후보 번호, T2/T1은 난이도 등급입니다 — 사용자에게 전달할 때는 코드가 아니라 아래 풀어쓴 설명으로 브리핑하세요)');
        } else {
          lines.push(`[claude-token-saver route-scan] Over the last ${cache.days} days, expensive models (opus/fable) repeatedly handled work that a cheaper model could take.`);
          lines.push('(R<N> is the candidate id, T2/T1 the difficulty tier — brief the user with the spelled-out wording below, not the codes.)');
        }
        for (const c of open) {
          const tier = c.tier || 'T2';
          const label = lang === 'ko' ? c.label : (c.labelEn || c.label);
          const rule = composed(lang === 'ko' ? c.rule : (c.ruleEn || c.rule), c);
          if (lang === 'ko') {
            lines.push(`  후보 R${c.id} — "${label}" 유형, ${c.count}회 반복 (프로젝트: ${c.project})`);
            lines.push(`      판정: ${tier} (${rs.tierLabel(tier)}) → ${c.agent} 서브에이전트 위임 권장 · 적용 범위 제안: ${rs.scopeLabel(c.suggestedScope)}`);
            lines.push(`      예시 요청: "${c.example}"`);
            lines.push(`      등록 시 ratchet-model.md에 기록될 룰: "${rule}"`);
          } else {
            lines.push(`  Candidate R${c.id} — "${label}", seen ×${c.count} (project: ${c.project})`);
            lines.push(`      verdict: ${tier} (${rs.tierLabel(tier, 'en')}) → delegate to the ${c.agent} subagent · suggested scope: ${rs.scopeLabel(c.suggestedScope, 'en')}`);
            lines.push(`      example request: "${c.example}"`);
            lines.push(`      rule that would be written to ratchet-model.md: "${rule}"`);
          }
        }
        if (lang === 'ko') {
          lines.push('등록하면 다음 세션부터 자동 위임됩니다. 사용자에게 등록 여부를 물을 때 위 룰 원문을 그대로 보여주고, 적용 범위까지 확인한 뒤 실행하세요:');
          lines.push('  claude-token-saver harness promote R<N> --project|--global   # 적용 범위는 반드시 사용자에게 확인');
          lines.push('  claude-token-saver route-scan dismiss <N>                    # 사용자가 원치 않으면');
        } else {
          lines.push('Once registered, delegation happens automatically from the next session. Show the user the rule text verbatim, confirm the scope with them, then run:');
          lines.push('  claude-token-saver harness promote R<N> --project|--global   # ALWAYS confirm the scope with the user first');
          lines.push('  claude-token-saver route-scan dismiss <N>                    # if they do not want it');
        }
      }
      if (reviewRules.length > 0) {
        lines.push(lang === 'ko'
          ? '[claude-token-saver rule-health] 사용자가 승인한 위임 룰 중, 위임 대상 유형의 최근 에러율이 기준(20%)을 넘어 재검토가 필요한 룰이 있습니다 — 사용자에게 브리핑하고 조건 좁히기/제거를 상의하세요:'
          : '[claude-token-saver rule-health] Some user-approved delegation rules now exceed the 20% error-rate threshold for their delegated category — brief the user and discuss narrowing or removing them:');
        for (const r of reviewRules) {
          // Say WHICH signal tripped: a measured delegation failure rate is a
          // much stronger claim than the shape-based proxy, and the user's
          // decision (narrow vs. remove) depends on knowing which it is.
          const measured = r.healthSource === 'delegated';
          const rate = Math.round(((measured ? r.delegatedErrRate : r.errRate) || 0) * 100);
          const evidence = lang === 'ko'
            ? (measured ? `실제 위임 ${r.delegatedRuns}건 실측 에러율 ${rate}%` : `유형 에러율 ${rate}% (형태 기반 추정)`)
            : (measured ? `${rate}% measured across ${r.delegatedRuns} real delegations` : `${rate}% for the category (shape-based proxy)`);
          lines.push(lang === 'ko'
            ? `  룰 #${r.n} (${r.tier} ${rs.tierLabel(r.tier)} · ${rs.scopeLabel(r.scope)}) — ${evidence}`
            : `  rule #${r.n} (${r.tier} ${rs.tierLabel(r.tier, 'en')} · ${rs.scopeLabel(r.scope, 'en')}) — ${evidence}`);
          lines.push(`      "${r.rule}"`);
        }
        lines.push(lang === 'ko'
          ? '  제거: claude-token-saver route-scan rules rm <N>'
          : '  remove with: claude-token-saver route-scan rules rm <N>');
      }
      lines.push(lang === 'ko'
        ? '위 내용은 사용자의 첫 메시지 주제와 무관하더라도(단순 인사여도) 첫 응답 말미에 `※ [claude-token-saver]` 라벨을 달아 요약 브리핑하세요 — 사용자가 물어볼 때까지 기다리지 말 것.'
        : 'Summarize the above at the end of your first response under a `※ [claude-token-saver]` label, even if the user\'s first message is unrelated (a bare greeting counts) — do not wait to be asked.');
      // Style first, briefing second: the briefing is Korean prose too, so the
      // guidance has to be in context before the model reads it.
      if (koreanBlock) console.log(koreanBlock + '\n');
      console.log(lines.join('\n'));
      // Record what was actually briefed so the UserPromptSubmit brief hook
      // suppresses exactly these — a candidate landing after this read (e.g.
      // the detached rescan above finishing) still gets briefed next prompt.
      try {
        const { seedSessionBriefed } = await import('../brief.js');
        seedSessionBriefed(hookCtx.session_id, [
          ...open.map((c) => `route|${c.signature}`),
          ...reviewRules.map((r) => `health|${r.signature}|${r.scope}`),
        ]);
      } catch (e) { debug('route-scan:seed-briefed', e); /* worst case is one duplicate brief */ }
      return;
    }

    const days = numArg('--days', { dflt: 14, min: 0 });
    let cache = rs.readRouteScan();
    if (hasFlag('--refresh') || (cache && cache.days !== days) || await rs.shouldRescan(cache, { days })) {
      cache = await rs.runRouteScan({ days });
    }
    if (hasFlag('--quiet')) return;
    if (hasFlag('--json')) {
      console.log(JSON.stringify(cache, null, 2));
      return;
    }
    const easyPct = cache.totalEpisodes ? Math.round(cache.easyEpisodes / cache.totalEpisodes * 100) : 0;
    console.log(lang === 'ko'
      ? `route-scan — 최근 ${cache.days}일: 에피소드 ${cache.totalEpisodes}건 중 easy ${cache.easyEpisodes}건 (${easyPct}%)  [스캔: ${cache.scannedAt}]`
      : `route-scan — last ${cache.days}d: ${cache.easyEpisodes}/${cache.totalEpisodes} episodes easy (${easyPct}%)  [scanned: ${cache.scannedAt}]`);
    const open = rs.openCandidates(cache);
    if (open.length === 0) {
      console.log(lang === 'ko'
        ? '위임 후보 없음 (반복 3회 미만이거나 이미 처리됨).'
        : 'No delegation candidates (below recurrence threshold or already resolved).');
      (await import('../first-run-note.js')).printOnce('route-scan', lang);
      return;
    }
    console.log(lang === 'ko' ? '\n위임 후보 (R<N>=후보 번호, T2/T1=난이도 등급):' : '\nDelegation candidates (R<N> = candidate id, T2/T1 = difficulty tier):');
    for (const c of open) {
      const tier = c.tier || 'T2';
      if (lang === 'ko') {
        console.log(`  R${c.id}  "${c.label}" ×${c.count}회 [${c.project}]`);
        console.log(`       판정: ${tier} (${rs.tierLabel(tier)}) → ${c.agent} 위임 권장 · 적용 범위 제안: ${rs.scopeLabel(c.suggestedScope)}`);
      } else {
        console.log(`  R${c.id}  "${c.labelEn || c.label}" ×${c.count} [${c.project}]`);
        console.log(`       verdict: ${tier} (${rs.tierLabel(tier, 'en')}) → delegate to ${c.agent} · suggested scope: ${rs.scopeLabel(c.suggestedScope, 'en')}`);
      }
      console.log(`       ${lang === 'ko' ? '예시' : 'example'}: "${c.example}"`);
      const mrList = await import('../model-rules.js');
      const base = lang === 'ko' ? c.rule : (c.ruleEn || c.rule);
      console.log(`       ${lang === 'ko' ? '룰' : 'rule'}: ${mrList.composeRuleText(base, c, lang)}`);
    }
    console.log('');
    console.log(lang === 'ko' ? '등록 / 무시:' : 'Promote / dismiss:');
    console.log('  claude-token-saver harness promote R<N> --project|--global');
    console.log('  claude-token-saver route-scan dismiss <N>');
    // 최초 1회만 — 매번 찍으면 도구가 광고판이 된다 (CTS_NO_NOTE=1 로 끔)
    (await import('../first-run-note.js')).printOnce('route-scan', lang);
    return;
}
