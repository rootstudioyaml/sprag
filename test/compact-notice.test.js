/**
 * The context warning at 95% used to be relayed "at the end of the answer". In a
 * turn with many tool calls, compaction runs before the answer ends, so the user
 * was told "95%, compaction soon" after the context had already shrunk. Three
 * parts fix it, and this file pins each one:
 *  - the 95% item goes in its own block that asks to be relayed first;
 *  - a SessionStart hook for source "compact" says the earlier warning is stale;
 *  - the installer registers that hook as its own group, and the handler it
 *    registers is the one that answers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

async function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-compact-notice-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  return { dir, home, cfg: join(dir, 'cfg') };
}

const briefEnv = (sb) => ({
  XDG_CONFIG_HOME: sb.cfg,
  HOME: sb.home,
  USERPROFILE: sb.home,
  ANTHROPIC_MODEL: 'claude-opus-5',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined,
});

const usage = (n) => JSON.stringify({ message: { usage: { input_tokens: n } } }) + '\n';

test('a 95% crossing is delivered under the urgent header, an 80% crossing under the normal one', async () => {
  const { runBrief, BRIEF_HEADER, URGENT_BRIEF_HEADER } = await import('../src/brief.js');
  const sb = sandbox();
  const tx = join(sb.dir, 't.jsonl');
  try {
    await withEnv(briefEnv(sb), async () => {
      writeFileSync(tx, usage(195_000)); // 97.5% of 200k, tier 2
      const urgent = await runBrief({ sessionId: 'sess-urgent', transcriptPath: tx, root: sb.home });
      assert.ok(urgent.startsWith(URGENT_BRIEF_HEADER), urgent);
      assert.ok(!urgent.includes(BRIEF_HEADER), 'a lone 95% item has no normal block');
      assert.match(urgent, /95%/);

      writeFileSync(tx, usage(170_000)); // 85%, tier 1
      const normal = await runBrief({ sessionId: 'sess-normal', transcriptPath: tx, root: sb.home });
      assert.ok(normal.startsWith(BRIEF_HEADER), normal);
      assert.ok(!normal.includes(URGENT_BRIEF_HEADER));
      assert.match(normal, /80%/);
    });
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a 95% item and another item fire together: both blocks, urgent first', async () => {
  const { runBrief, BRIEF_HEADER, URGENT_BRIEF_HEADER } = await import('../src/brief.js');
  const sb = sandbox();
  const tx = join(sb.dir, 't.jsonl');
  const started = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(tx, [
    JSON.stringify({ type: 'user', timestamp: started, message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 195_000 } } }),
  ].join('\n') + '\n');
  try {
    await withEnv(briefEnv(sb), async () => {
      const out = await runBrief({ sessionId: 'sess-both', transcriptPath: tx, root: sb.home });
      const u = out.indexOf(URGENT_BRIEF_HEADER);
      const n = out.indexOf(BRIEF_HEADER);
      assert.equal(u, 0, 'the urgent block comes first');
      assert.ok(n > u, 'the normal block follows');
      assert.match(out.slice(0, n), /95%/);
      assert.doesNotMatch(out.slice(0, n), /핸드오프/, 'the age item is not in the urgent block');
      assert.match(out.slice(n), /핸드오프/);
      assert.ok(out.slice(0, n).endsWith('\n\n'), 'the two blocks are separated by a blank line');
    });
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the context items are worded so they stay true and carry no em dash', async () => {
  const { runBrief } = await import('../src/brief.js');
  const sb = sandbox();
  const tx = join(sb.dir, 't.jsonl');
  const settings = join(sb.home, '.claude', 'settings.json');
  const seen = [];
  try {
    for (const capped of [false, true]) {
      writeFileSync(settings, JSON.stringify(capped ? { model: 'claude-opus-5[1m]', autoCompactWindow: 400_000 } : {}));
      await withEnv({ ...briefEnv(sb), ANTHROPIC_MODEL: undefined }, async () => {
        const prev = process.cwd();
        process.chdir(sb.home);
        try {
          for (const [tokens, pct] of [[capped ? 390_000 : 195_000, '95%'], [capped ? 330_000 : 170_000, '80%']]) {
            writeFileSync(tx, usage(tokens));
            const out = await runBrief({ sessionId: `sess-${capped}-${pct}`, transcriptPath: tx, root: sb.home });
            assert.match(out, new RegExp(pct), out);
            seen.push(out);
          }
        } finally { process.chdir(prev); }
      });
    }
    assert.equal(seen.length, 4);
    for (const out of seen) {
      assert.doesNotMatch(out, /곧 자동 압축/);
      assert.ok(!out.includes('—'), 'no em dash');
    }
    assert.match(seen[0], /이 답변이 끝나기 전에 자동 압축이 돌 수 있고 그때 앞부분 맥락이 요약으로 줄어듭니다/);
    assert.match(seen[2], /이어서 할 일을 지금 파일에 적어 두면 압축 뒤에도 안전합니다/);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('compactionNotice answers from the recorded tier and never writes the state', async () => {
  const { compactionNotice, briefStatePath } = await import('../src/brief.js');
  const sb = sandbox();
  try {
    await withEnv({ XDG_CONFIG_HOME: sb.cfg }, async () => {
      assert.equal(compactionNotice({ sessionId: 's-none', lang: 'ko' }), null, 'no state file');
      assert.equal(compactionNotice({ lang: 'ko' }), null, 'no session id');

      mkdirSync(dirname(briefStatePath()), { recursive: true });
      writeFileSync(briefStatePath(), '{not json');
      assert.equal(compactionNotice({ sessionId: 's-1', lang: 'ko' }), null, 'corrupt state');

      const state = JSON.stringify({ sessions: {
        's-0': { ts: Date.now(), ctxTier: 0, briefed: [] },
        's-1': { ts: Date.now(), ctxTier: 1, briefed: [] },
        's-2': { ts: Date.now(), ctxTier: 2, briefed: [] },
      } }) + '\n';
      writeFileSync(briefStatePath(), state);
      assert.equal(compactionNotice({ sessionId: 'unknown', lang: 'ko' }), null);
      assert.equal(compactionNotice({ sessionId: 's-0', lang: 'ko' }), null);
      for (const id of ['s-1', 's-2']) {
        const ko = compactionNotice({ sessionId: id, lang: 'ko' });
        assert.match(ko, /^✇ \[sprag\] 방금 이 세션의 대화가 압축됐습니다\./);
        assert.match(ko, /아직 사용자에게 전하지 않았다면 전하지 마십시오/);
        const en = compactionNotice({ sessionId: id, lang: 'en' });
        assert.match(en, /^✇ \[sprag\] This session's conversation was just compacted\./);
        assert.match(en, /if you have not relayed it to the user yet, do not/);
      }
      assert.equal(readFileSync(briefStatePath(), 'utf8'), state, 'the state file is byte-for-byte unchanged');
    });
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── the CLI handler ─────────────────────────────────────────────────────────

function hook(sb, flag, input) {
  return execFileSync(process.execPath, [CLI, 'route-scan', flag], {
    env: childEnv({ HOME: sb.home, XDG_CONFIG_HOME: sb.cfg, APPDATA: sb.cfg, NO_COLOR: '1', SPRAG_LANG: 'en', SPRAG_NO_ROUTE_SCAN: '1' }),
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
}

function recordTier(sb, sessionId, ctxTier) {
  const dir = join(sb.cfg, 'claude-token-saver');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief-state.json'), JSON.stringify({
    sessions: { [sessionId]: { ts: Date.now(), ctxTier, briefed: [] } },
  }) + '\n');
}

test('route-scan --hook-compact prints the notice only for a compaction of a warned session', () => {
  const sb = sandbox();
  try {
    recordTier(sb, 'S', 2);
    const notice = hook(sb, '--hook-compact', JSON.stringify({ session_id: 'S', source: 'compact' }));
    assert.match(notice, /This session's conversation was just compacted/);
    assert.equal(hook(sb, '--hook-compact', JSON.stringify({ session_id: 'S', source: 'startup' })), '');
    assert.equal(hook(sb, '--hook-compact', JSON.stringify({ session_id: 'other', source: 'compact' })), '');
    assert.equal(hook(sb, '--hook-compact', 'garbage, not json'), '');
    // A payload without `source` is treated as a compaction.
    assert.match(hook(sb, '--hook-compact', JSON.stringify({ session_id: 'S' })), /just compacted/);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── the installer ───────────────────────────────────────────────────────────

function install(sb) {
  execFileSync(process.execPath, [CLI, 'install'], {
    env: childEnv({ HOME: sb.home, XDG_CONFIG_HOME: sb.cfg, APPDATA: sb.cfg, NO_COLOR: '1', SPRAG_LANG: 'en',
      SPRAG_NO_DOC2MD: '1', SPRAG_NO_KOREAN: '1', SPRAG_NO_CODEX: '1' }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  return JSON.parse(readFileSync(join(sb.home, '.claude', 'settings.json'), 'utf8'));
}

const compactGroups = (settings) => (settings.hooks.SessionStart || []).filter((m) =>
  (m.hooks || []).some((h) => /route-scan --hook-compact(?![\w-])/.test(h.command || '')));

test('install registers the compact group beside startup|clear, once, and uninstall removes it', () => {
  const sb = sandbox();
  const settingsPath = join(sb.home, '.claude', 'settings.json');
  // The older shape: only the startup|clear group, holding a hook that is not ours.
  const oldGroup = {
    matcher: 'startup|clear',
    hooks: [
      { type: 'command', command: 'sprag route-scan --hook', timeout: 10 },
      { type: 'command', command: 'their-session-hook', timeout: 5 },
    ],
  };
  writeFileSync(settingsPath, JSON.stringify({ hooks: { SessionStart: [oldGroup] } }, null, 2));
  try {
    const first = install(sb);
    const groups = compactGroups(first);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, 'compact');
    assert.equal(groups[0].hooks.length, 1);
    assert.deepEqual(first.hooks.SessionStart[0], oldGroup, 'the existing group is deep-equal to what it was');

    const second = install(sb);
    assert.deepEqual(second.hooks.SessionStart, first.hooks.SessionStart, 'a second install adds nothing');

    execFileSync(process.execPath, [CLI, 'uninstall'], {
      env: childEnv({ HOME: sb.home, XDG_CONFIG_HOME: sb.cfg, APPDATA: sb.cfg, NO_COLOR: '1', SPRAG_LANG: 'en' }),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const commands = JSON.stringify(after.hooks || {});
    assert.doesNotMatch(commands, /route-scan --hook-compact/);
    assert.match(commands, /their-session-hook/, 'the hook that is not ours stays');
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a fresh install registers matcher "compact" and the installed command reaches the handler', () => {
  const sb = sandbox();
  try {
    const settings = install(sb);
    const groups = compactGroups(settings);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, 'compact');
    const startup = settings.hooks.SessionStart.filter((m) => m.matcher === 'startup|clear');
    assert.equal(startup.length, 1, 'the startup|clear group is registered as before');
    assert.ok(!startup[0].hooks.some((h) => /--hook-compact/.test(h.command || '')));

    // Drift guard: take the flag from the command the installer wrote and run
    // the CLI with it, so a renamed flag on either side fails here.
    const command = groups[0].hooks[0].command;
    const flag = (command.match(/route-scan (--[\w-]+)/) || [])[1];
    assert.equal(flag, '--hook-compact', command);
    recordTier(sb, 'S', 1);
    const out = hook(sb, flag, JSON.stringify({ session_id: 'S', source: 'compact' }));
    assert.match(out, /just compacted/);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
