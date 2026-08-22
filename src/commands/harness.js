/**
 * Subcommand: harness — manage the project's CLAUDE.md harness rules.
 *   claude-token-saver harness init       # write CLAUDE.md (5 sections) + ratchet.md
 *   claude-token-saver harness uninit     # remove harness block from CLAUDE.md (backup kept)
 *   claude-token-saver harness check      # show 🅷 N/5 + which sections are missing
 *   claude-token-saver harness promote "<rule>"  # append a rule to ratchet.md
 *   claude-token-saver harness pull [--global|--project]  # register the package's curated preset rules (default global)
 *   claude-token-saver harness off | on   # toggle the statusline 🅷 segment
 */

import { debug } from '../debug.js';

export async function run({ args, hasFlag }) {
    const sub = args[1];
    // Scope flags for init/uninit/check (same convention as promote/list/rm):
    //   --global | --project | --scope=global|project | --scope global|project
    const parseHarnessScope = (argv, dflt) => {
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--global') return 'global';
        if (a === '--project') return 'project';
        if (a === '--scope' && (argv[i + 1] === 'global' || argv[i + 1] === 'project')) return argv[i + 1];
        if (a.startsWith('--scope=')) {
          const v = a.slice('--scope='.length);
          if (v === 'global' || v === 'project') return v;
        }
      }
      return dflt;
    };
    const { harnessInit, harnessUninit, harnessStatus, harnessPromote, harnessPull, harnessListRules, harnessRmRule, harnessPrune, ratchetSizeStatus, RATCHET_TOKEN_BUDGET, contextWeightStatus, CLAUDE_MD_TOKEN_BUDGET, findProjectRoot } =
      await import('../harness.js');
    const { HARNESS_SECTIONS } = await import('../harness-templates.js');
    const { loadConfig, saveConfig, userLanguage } = await import('../config.js');
    const lang = userLanguage();

    if (!sub || sub === 'check') {
      const scope = parseHarnessScope(args.slice(2), 'auto'); // auto = project, else global fallback
      const root = findProjectRoot();
      const s = harnessStatus(root, { scope });
      // Only call out "covered by global" when we *fell back* to it (auto), not
      // when the user explicitly asked for the global scope.
      const via = (scope === 'auto' && s.source === 'global') ? ' (covered by global ~/.claude/CLAUDE.md)' : '';
      console.log(`🅷 ${s.configured}/${s.total} — ${s.file}${via}`);
      console.log(`CLAUDE.md: ${s.hasFile ? 'present' : 'missing'}` +
        (s.hasFile ? `, harness block: ${s.hasBlock ? 'yes' : 'no'}` : '') + ` [${s.source}]`);
      if (s.missing.length) {
        console.log('Missing sections:');
        for (const id of s.missing) {
          const sec = HARNESS_SECTIONS.find((x) => x.id === id);
          console.log(`  - ${id}: ${sec ? sec.heading.replace(/^#+\s*/, '') : ''}`);
        }
        console.log('\nRun: claude-token-saver harness init        (this project)');
        console.log('  or: claude-token-saver harness init --global  (all projects, ~/.claude/CLAUDE.md)');
      } else {
        console.log('All 5 harness sections present. ✅');
      }
      // Sections can all be present while ratchet.md still never reaches the
      // model — blocks written before v3.6.3 have no `@` import line.
      if (s.hasBlock && !(s.hasRatchetImport && s.hasModelRatchetImport)) {
        const dead = [!s.hasRatchetImport && 'ratchet.md', !s.hasModelRatchetImport && 'ratchet-model.md'].filter(Boolean).join(' + ');
        console.log(`\n⚠ ${dead} is NOT loaded into sessions — the harness block has no \`@\` import line for it.`);
        console.log('  Those rules are being written to a file nothing reads.');
        console.log(`  Fix: claude-token-saver harness init${s.source === 'global' ? ' --global' : ''}   (updates the block in place)`);
      }
      // Imported ratchets are charged on every request, so their size matters.
      // Static `@` imports cannot be filtered at load time — the only lever is
      // fewer rules, hence the prune pointer rather than a "filter" suggestion.
      for (const sc of ['project', 'global']) {
        const size = ratchetSizeStatus({ scope: sc });
        if (!size.count) continue;
        const line = `ratchet.md [${sc}]: ${size.count} rules, ~${size.tokens} tok/request`;
        if (size.overBudget) {
          console.log(`\n⚠ ${line} — over the ~${RATCHET_TOKEN_BUDGET} token budget.`);
          console.log(`  Trim: claude-token-saver harness prune${sc === 'global' ? ' --global' : ''} --older-than 6 --dry-run`);
          console.log('  (project-specific rules belong in --project scope, not global.)');
        } else {
          console.log(`${line}`);
        }
      }
      // Advisory context-weight facts (never counted in 🅷 N/5): CLAUDE.md is
      // charged on every request, and without a .claudeignore Claude Code can
      // pull build artifacts and vendored code into context during searches.
      try {
        const w = contextWeightStatus({ root });
        if (w.claudeMd) {
          const line = `CLAUDE.md size: ~${w.claudeMd.tokens} tok/request (${w.claudeMd.path})`;
          if (w.claudeMd.overBudget) {
            console.log(`\n⚠ ${line} — over the ~${CLAUDE_MD_TOKEN_BUDGET} token guideline.`);
            console.log('  Keep rules and file pointers here; move documentation into files it points to.');
          } else {
            console.log(line);
          }
        }
        console.log(`.claudeignore: ${w.hasClaudeIgnore ? 'present' : 'absent — consider adding one so searches skip build output, vendored code, and large data files'}`);
      } catch (e) {
        debug('harness:context-weight', e);
      }
      return;
    }

    if (sub === 'init') {
      const scope = parseHarnessScope(args.slice(2), 'project'); // default project (back-compat)
      const force = hasFlag('--force');
      const r = harnessInit({ force, scope });
      console.log(`Scope: ${scope}${scope === 'global' ? '  (~/.claude/CLAUDE.md — applies to all projects)' : `  (${r.root})`}`);
      for (const p of r.backedUp) console.log(`Backed up: ${p}`);
      for (const p of r.wrote) console.log(`Wrote:     ${p}`);
      for (const p of r.skipped) console.log(`Skipped:   ${p}`);
      console.log('\n🅷 Harness initialized. Statusline will show 🅷 5/5 on next refresh.');
      return;
    }

    if (sub === 'promote') {
      // Parse scope flags before stripping. Accepts: --global, --project,
      //   --scope=global|project, --scope global|project
      const promoteArgs = args.slice(2);
      let scope = null;
      const scopeFlags = new Set();
      for (let i = 0; i < promoteArgs.length; i++) {
        const a = promoteArgs[i];
        if (a === '--global') { scope = 'global'; scopeFlags.add(i); }
        else if (a === '--project') { scope = 'project'; scopeFlags.add(i); }
        else if (a === '--scope' && promoteArgs[i + 1]) {
          const v = promoteArgs[i + 1];
          if (v !== 'global' && v !== 'project') {
            console.error(`Invalid --scope value: ${v} (expected "global" or "project")`);
            process.exit(1);
          }
          scope = v; scopeFlags.add(i); scopeFlags.add(i + 1); i++;
        } else if (a.startsWith('--scope=')) {
          const v = a.slice('--scope='.length);
          if (v !== 'global' && v !== 'project') {
            console.error(`Invalid --scope value: ${v} (expected "global" or "project")`);
            process.exit(1);
          }
          scope = v; scopeFlags.add(i);
        }
      }
      const raw = promoteArgs.filter((_, i) => !scopeFlags.has(i)).join(' ').trim();
      if (!raw) {
        console.error('Usage: claude-token-saver harness promote [--global|--project] <N>  # from statusline 🅷⚠ ratchet? #N');
        console.error('   or: claude-token-saver harness promote [--global|--project] "<rule text>"');
        process.exit(1);
      }
      let rule = raw;
      // Numeric arg → look up candidate #N from analyzer state and turn its
      // detected error pattern into a starter ratchet rule. Saves the user
      // from retyping the error; they can edit ratchet.md afterward.
      if (/^\d+$/.test(raw)) {
        const n = parseInt(raw, 10);
        const analyzer = await import('../harness-analyzer.cjs');
        const a = analyzer.default || analyzer;
        const state = a.readState();
        const list = (state && state.ratchetCandidates) || [];
        const cand = list.find((c) => c.id === n);
        if (!cand) {
          console.error(`No ratchet candidate #${n} in state. Run \`harness analyze\` or wait for the hook to populate it.`);
          if (list.length) {
            console.error('Available candidates:');
            for (const c of list) console.error(`  #${c.id} (×${c.count}): ${c.pattern}`);
          }
          process.exit(1);
        }
        rule = `반복 감지 ×${cand.count}: ${cand.pattern} — TODO: 원인·예방책 한 줄로`;
      }
      // R-prefixed arg → route-scan delegation candidate (statusline `route? R<N>`).
      // The rule text is pre-generated by the scan; promoting also resolves the
      // candidate so the chip stops and rescans don't resurface it.
      let routeCandidateId = null;
      let routeCandidate = null;
      if (/^[Rr]\d+$/.test(raw)) {
        const n = parseInt(raw.slice(1), 10);
        const rs = await import('../route-scan.js');
        const cand = (rs.openCandidates(rs.readRouteScan()) || []).find((c) => c.id === n);
        if (!cand) {
          console.error(`No open route candidate R${n}. Run: claude-token-saver route-scan`);
          process.exit(1);
        }
        rule = lang === 'ko' ? cand.rule : (cand.ruleEn || cand.rule);
        routeCandidateId = n;
        routeCandidate = cand;
        if (!scope) {
          console.error(`Route candidate R${n} requires an explicit scope (suggested: --${cand.suggestedScope}).`);
          console.error('Ask the user, then pass --project or --global.');
          process.exit(1);
        }
      }
      // Scope resolution: explicit flag wins. Otherwise prompt interactively
      // when running on a TTY; in non-TTY (CI/scripts) require an explicit
      // flag so the choice is never silently made for the caller.
      if (!scope) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const readline = await import('node:readline');
          const { homedir: hd } = await import('node:os');
          const { findProjectRoot: fpr } = await import('../harness.js');
          const projPath = `${fpr()}/.claude/ratchet.md`;
          const globPath = `${hd()}/.claude/ratchet.md`;
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const ask = (q) => new Promise((res) => rl.question(q, res));
          console.log('Where should this rule live?');
          console.log(`  [1] project  (${projPath})`);
          console.log(`  [2] global   (${globPath})`);
          const ans = (await ask('Choose [1/2] (default 1): ')).trim();
          rl.close();
          scope = (ans === '2' || ans.toLowerCase() === 'global' || ans.toLowerCase() === 'g')
            ? 'global' : 'project';
        } else {
          console.error('Scope required in non-interactive mode.');
          console.error('Pass --project or --global (or --scope=project|global).');
          process.exit(1);
        }
      }
      // Route candidates become MODEL-FITTING rules: they live in a
      // tool-managed block (separate from user-authored ratchet rules) and
      // keep updating from subsequent logs — recurrence counts, error rates,
      // rule-health — on every rescan.
      if (routeCandidate) {
        const rs = await import('../route-scan.js');
        const mr = await import('../model-rules.js');
        // A --project rule must land in THE project the pattern was detected
        // in, not the cwd's. Old caches without projectPath: verify cwd match.
        let targetRoot = null;
        if (scope === 'project') {
          if (routeCandidate.projectPath) {
            targetRoot = findProjectRoot(routeCandidate.projectPath);
          } else if (rs.mungeProjectPath(findProjectRoot()) === routeCandidate.project) {
            targetRoot = findProjectRoot();
          } else {
            console.error(`Route candidate R${routeCandidateId} was detected in another project (${routeCandidate.project}),`);
            console.error('but this cached scan predates project-path tracking.');
            console.error('Re-scan to capture it, then promote again:');
            console.error('  claude-token-saver route-scan --refresh');
            process.exit(1);
          }
        }
        const entry = mr.addModelRule({
          signature: routeCandidate.signature,
          tier: routeCandidate.tier || 'T2',
          category: routeCandidate.category,
          label: routeCandidate.label,
          labelEn: routeCandidate.labelEn,
          agent: routeCandidate.agent,
          scope,
          targetRoot,
          project: routeCandidate.project,
          rule: lang === 'ko' ? routeCandidate.rule : (routeCandidate.ruleEn || routeCandidate.rule),
          example: routeCandidate.example,
          count: routeCandidate.count,
          // Calibrated budget snapshot — ratchet-model.md restates it when it
          // merges a category's T2 and T1 rules into one conditional rule.
          budget: routeCandidate.budget || null,
          promotedAt: new Date().toISOString().slice(0, 10),
          lastSeen: new Date().toISOString().slice(0, 10),
        });
        const written = mr.syncAllFiles();
        rs.resolveCandidate(routeCandidateId);
        console.log(`Model-fitting rule registered [${scope}${targetRoot ? ` → ${targetRoot}` : ''}] (tier ${entry.tier}):`);
        console.log(`  - ${entry.rule}`);
        for (const p of written) console.log(`  ratchet-model.md updated: ${p}`);
        console.log(lang === 'ko'
          ? `(route candidate R${routeCandidateId} resolved — 다음 세션부터 자동 위임, 이후 스캔마다 로그 기반 갱신됩니다)`
          : `(route candidate R${routeCandidateId} resolved — delegation applies from the next session, refreshed from logs on every rescan)`);
        console.log(lang === 'ko'
          ? '룰 목록/제거: claude-token-saver route-scan rules [rm <N>]'
          : 'List / remove: claude-token-saver route-scan rules [rm <N>]');
        // Event-triggered refresh: establish the new rule's stat baseline
        // right away instead of waiting for the next data-gated rescan.
        try {
          const { spawn } = await import('node:child_process');
          spawn(process.execPath, [process.argv[1], 'route-scan', '--refresh', '--quiet'],
            { detached: true, stdio: 'ignore' }).unref();
        } catch (e) { debug('promote:spawn-refresh', e); /* baseline arrives on the next gated rescan */ }
        return;
      }
      const r = harnessPromote(rule, { scope });
      console.log(`Appended to ${r.path} [${r.scope}]:`);
      console.log(`  - ${rule}`);
      if (/^\d+$/.test(raw)) {
        console.log(lang === 'ko'
          ? '\n👉 ratchet.md를 열어 TODO 부분을 실제 룰로 다듬어주세요.'
          : '\n👉 Open ratchet.md and turn the TODO into the actual rule.');
      }
      return;
    }

    if (sub === 'analyze') {
      // Run the analyzer once against the most recent session JSONL under
      // ~/.claude/projects/ and dump the resulting state. Useful for users
      // who don't have the hook installed but want to see warnings.
      const analyzer = await import('../harness-analyzer.cjs');
      const { analyzeTranscript, writeState } = analyzer.default || analyzer;
      const { readdirSync, statSync } = await import('node:fs');
      const { join: pj } = await import('node:path');
      const { homedir } = await import('node:os');
      const dir = pj(homedir(), '.claude', 'projects');
      let latest = null;
      let latestMtime = 0;
      try {
        for (const subdir of readdirSync(dir)) {
          const full = pj(dir, subdir);
          if (!statSync(full).isDirectory()) continue;
          for (const f of readdirSync(full)) {
            if (!f.endsWith('.jsonl')) continue;
            const fp = pj(full, f);
            const m = statSync(fp).mtimeMs;
            if (m > latestMtime) { latestMtime = m; latest = fp; }
          }
        }
      } catch (e) { debug('harness:analyze-scan', e); }
      if (!latest) {
        console.error('No session transcripts found under ~/.claude/projects/');
        process.exit(1);
      }
      const state = analyzeTranscript(latest, { cwd: process.cwd() });
      if (state) writeState(state);
      console.log(JSON.stringify(state, null, 2));
      return;
    }

    if (sub === 'uninit' || sub === 'remove') {
      const scope = parseHarnessScope(args.slice(2), 'project');
      const purgeRatchet = args.includes('--purge-ratchet');
      const r = harnessUninit({ purgeRatchet, scope });
      console.log(`Scope: ${scope}${scope === 'global' ? '  (~/.claude/CLAUDE.md)' : `  (${r.root})`}`);
      r.removed.forEach((f) => console.log(`  removed: ${f}`));
      r.backedUp.forEach((f) => console.log(`  backup:  ${f}`));
      r.skipped.forEach((f) => console.log(`  skip:    ${f}`));
      if (r.removed.length === 0) console.log('Nothing to remove.');
      return;
    }

    if (sub === 'pull') {
      // Register the package's curated preset rules (presets/ratchet-rules.md)
      // into the user's ratchet — global by default (they're tool/environment
      // rules, and a project ratchet inherits global anyway). Strictly opt-in:
      // install/init never auto-injects rules.
      const scope = parseHarnessScope(args.slice(2), 'global');
      const r = harnessPull({ scope });
      console.log(`Curated preset rules → ${r.path} [${r.scope}]`);
      if (r.added.length) {
        console.log(`✅ ${r.added.length}/${r.presets} rule(s) registered:`);
        for (const t of r.added) console.log(`  - ${t}`);
      } else {
        console.log(`No new rules — all ${r.presets} presets already registered.`);
      }
      if (r.skippedRules && r.added.length) console.log(`   (${r.skippedRules} already present — skipped)`);
      console.log(lang === 'ko'
        ? '\n필요 없는 룰은 언제든: claude-token-saver harness list / rm <N>'
        : '\nDrop any rule you do not want: claude-token-saver harness list / rm <N>');
      return;
    }

    if (sub === 'list' || sub === 'ls') {
      const wantGlobal = hasFlag('--global');
      const wantProject = hasFlag('--project') || !wantGlobal;
      const print = (scope) => {
        const { path, rules } = harnessListRules({ scope });
        if (!rules.length) {
          console.log(`No ratchet rules in ${path} [${scope}]`);
          return;
        }
        console.log(`📋 Ratchet rules [${scope}] — ${path}\n`);
        for (const r of rules) console.log(`  #${r.index}  ${r.text}`);
        console.log('');
      };
      if (wantProject) print('project');
      if (wantGlobal) print('global');
      console.log('Remove with: claude-token-saver harness rm [--global|--project] <N>');
      console.log('Archive in bulk:  claude-token-saver harness prune [--global] [--tag <t>] [--older-than <months>] [--dry-run]');
      return;
    }

    if (sub === 'prune') {
      const pruneScope = parseHarnessScope(args.slice(2), 'project');
      const argv = args.slice(2);
      const valueOf = (flag) => {
        const i = argv.indexOf(flag);
        if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
        const eq = argv.find((a) => a.startsWith(flag + '='));
        return eq ? eq.slice(flag.length + 1) : null;
      };
      const months = valueOf('--older-than');
      if (months !== null && !/^\d+$/.test(months)) {
        console.error(`Invalid --older-than value: ${months} (expected a number of months)`);
        process.exit(1);
      }
      const r = harnessPrune({
        scope: pruneScope,
        tag: valueOf('--tag'),
        olderThanMonths: months ? parseInt(months, 10) : null,
        dryRun: hasFlag('--dry-run'),
      });
      if (!r.ok) { console.error(r.error); process.exit(1); }
      if (!r.pruned.length) { console.log(`Nothing matched — ${r.path} unchanged.`); return; }
      console.log(`${r.dryRun ? 'Would prune' : 'Pruned'} ${r.pruned.length} rule(s) from ${r.path}:`);
      for (const p of r.pruned) console.log(`  #${p.index}  ${p.text.slice(0, 100)}`);
      if (!r.dryRun) {
        console.log(`\nArchived to: ${r.archive}   (backup: ${r.backup})`);
        console.log('Archived rules are NOT loaded into sessions — paste one back into ratchet.md to restore it.');
      }
      return;
    }

    if (sub === 'rm') {
      const rmScope = hasFlag('--global') ? 'global' : 'project';
      const rmArgs = args.slice(2).filter((a) => a !== '--global' && a !== '--project');
      const raw = (rmArgs[0] || '').trim();
      if (!/^\d+$/.test(raw)) {
        console.error('Usage: claude-token-saver harness rm [--global|--project] <N>   # N from `harness list`');
        process.exit(1);
      }
      const n = parseInt(raw, 10);
      // ⚠️ Heads-up before deletion. Ratchet's value is one-way accumulation —
      // dropping a rule is sometimes right, but more often the rule is just
      // too narrow. Surface the alternative loudly here.
      if (lang === 'ko') {
        console.log('⚠️  주의: ratchet 룰 삭제는 신중하게.');
        console.log('   같은 실수가 또 발생할 가능성이 큽니다. 보통은 "조건이 너무 좁아서"');
        console.log('   문제가 되는 경우가 많아요. 지우기 전에 한 번 더 검토하세요:');
        console.log('   - 룰이 너무 광범위해서 정상 케이스도 막나? → 조건을 좁혀서 다듬기');
        console.log('   - 룰이 너무 좁아서 거의 발동 안 되나? → 그냥 두기 (비용 0)');
        console.log('   - 정말 잘못된 룰이라 확신? → 그때만 삭제');
      } else {
        console.log('⚠️  Careful: removing a ratchet rule is rarely the fix.');
        console.log('   The mistake it guards against tends to come back. Usually the');
        console.log('   problem is that the rule is worded too narrowly. Check first:');
        console.log('   - Too broad, blocking legitimate cases? → tighten the condition');
        console.log('   - Too narrow, almost never fires? → leave it (it costs nothing)');
        console.log('   - Genuinely wrong? → only then delete it');
      }
      console.log('');
      const r = harnessRmRule(n, { scope: rmScope });
      if (!r.ok) {
        console.error(`❌ ${r.error}`);
        if (r.rules) {
          console.error('Available:');
          for (const x of r.rules) console.error(`  #${x.index}  ${x.text}`);
        }
        process.exit(1);
      }
      console.log(`✅ Removed #${n}: ${r.removed.text}`);
      console.log(`   Backup: ${r.backup}`);
      console.log(`   복구: cp "${r.backup}" "${r.path}"`);
      return;
    }

    if (sub === 'off' || sub === 'on') {
      const cfg = loadConfig();
      cfg.harness = cfg.harness || {};
      cfg.harness.enabled = sub === 'on';
      saveConfig(cfg);
      console.log(`Statusline 🅷 segment: ${sub}`);
      return;
    }

    console.error(`Unknown harness subcommand: ${sub}`);
    console.error('Usage: claude-token-saver harness [check|init|uninit [--purge-ratchet]|promote "<rule>"|pull [--global|--project]|list|rm <N>|prune [--tag <t>] [--older-than <months>] [--dry-run]|off|on]');
    process.exit(1);
}
