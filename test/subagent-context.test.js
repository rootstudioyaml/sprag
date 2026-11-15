/**
 * subagent-context — the auto-mode delivery path of the delegation guard.
 *
 * In auto mode a PreToolUse hook may not change a call's input, so the guard
 * parks its appendix in a small queue and the SubagentStart hook hands it to
 * the subagent. These tests cover the queue itself, the decision that picks
 * the queue over a rewrite, the two CLI entry points, the installer entries,
 * and the Hangul-share gate on the Korean section that shares this change.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

import {
  enqueueSubagentContext, takeSubagentContext, SUBAGENT_CONTEXT_TTL_MS, SUBAGENT_CONTEXT_MAX,
} from '../src/subagent-context.js';
import {
  buildAppendix, decideForDelegation, formatHookOutput, hangulShare, KOREAN_SHARE_MIN,
} from '../src/delegation-guard.js';
import { isDelegationGuardHookCommand, isSubagentStartHookCommand } from '../src/installer.js';

const DELEGATION_MARKER = '<!-- sprag:delegation -->';
const ON = { delegate: { enabled: true } };
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const rm = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

const EMPTY_HOME = mkdtempSync(join(tmpdir(), 'sprag-home-'));
after(() => rm(EMPTY_HOME));

/** The parked entry files of a queue directory, parsed, oldest first. */
const QUEUE = 'subagent-context';
const queueNames = (dir) => {
  try { return readdirSync(join(dir, QUEUE)).sort(); } catch { return []; }
};
const queued = (dir) => queueNames(dir)
  .filter((n) => /^\d{15}-\d+-[0-9a-f]{8}\.json$/.test(n))
  .map((n) => JSON.parse(readFileSync(join(dir, QUEUE, n), 'utf8')));

const tempEnv = (home) => childEnv({
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, 'AppData', 'Roaming'),
  XDG_CONFIG_HOME: join(home, '.config'),
});

/* The queue: order, expiry, matching, bounds */

test('queue: two entries of one session and type come out oldest first, each once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 1_000_000;
    // Enqueued newest first on purpose: the order comes from `at`, not from the write order.
    assert.ok(enqueueSubagentContext({ session: 's1', type: 't1-worker', at: now - 10, text: 'second' }, { dir, now }));
    assert.ok(enqueueSubagentContext({ session: 's1', type: 't1-worker', at: now - 20, text: 'first' }, { dir, now }));
    assert.equal(takeSubagentContext({ session: 's1', type: 't1-worker' }, { dir, now })?.text, 'first');
    assert.equal(takeSubagentContext({ session: 's1', type: 't1-worker' }, { dir, now })?.text, 'second');
    assert.equal(takeSubagentContext({ session: 's1', type: 't1-worker' }, { dir, now }), null);
  } finally {
    rm(dir);
  }
});

test('queue: a different session or type does not match, and the entry stays for its owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 1_000_000;
    enqueueSubagentContext({ session: 's1', type: 'general-purpose', at: now, text: 'mine' }, { dir, now });
    assert.equal(takeSubagentContext({ session: 's2', type: 'general-purpose' }, { dir, now }), null);
    assert.equal(takeSubagentContext({ session: 's1', type: 't1-worker' }, { dir, now }), null);
    assert.equal(takeSubagentContext({ session: undefined, type: undefined }, { dir, now }), null);
    assert.equal(takeSubagentContext({ session: 's1', type: 'general-purpose' }, { dir, now })?.text, 'mine');
  } finally {
    rm(dir);
  }
});

test('queue: an entry older than the TTL is not delivered, one at the limit still is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    assert.equal(SUBAGENT_CONTEXT_TTL_MS, 120_000);
    const now = 5_000_000;
    enqueueSubagentContext({ session: 's', type: 'a', at: now - SUBAGENT_CONTEXT_TTL_MS - 1, text: 'stale' }, { dir, now: now - 1 });
    enqueueSubagentContext({ session: 's', type: 'a', at: now - SUBAGENT_CONTEXT_TTL_MS, text: 'edge' }, { dir, now: now - 1 });
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now })?.text, 'edge');
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now }), null);
    // A write drops what expired in the meantime.
    enqueueSubagentContext({ session: 's', type: 'a', at: now, text: 'fresh' }, { dir, now });
    enqueueSubagentContext({ session: 's', type: 'b', at: now + 200_000, text: 'later' }, { dir, now: now + 200_000 });
    assert.deepEqual(queued(dir).map((e) => e.text), ['later'], 'the 200-second-old entry went with the write');
  } finally {
    rm(dir);
  }
});

test('queue: at most the 20 newest entries are kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    assert.equal(SUBAGENT_CONTEXT_MAX, 20);
    const now = 1_000_000;
    for (let i = 0; i < 25; i += 1) {
      enqueueSubagentContext({ session: 's', type: 'a', at: now + i, text: `e${i}` }, { dir, now: now + i });
    }
    const left = queued(dir);
    assert.equal(left.length, 20);
    assert.equal(left[0].text, 'e5');
    assert.equal(left[19].text, 'e24');
  } finally {
    rm(dir);
  }
});

test('queue: a missing directory, corrupt entries and wrongly shaped bodies read as empty, and a write recovers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 1_000_000;
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now }), null, 'no directory');
    const base = join(dir, QUEUE);
    mkdirSync(base);
    const bodies = ['{not json', '[]', '{"session":"s"}', 'null', '{"session":"s","type":"a","at":"x","text":"t"}'];
    bodies.forEach((body, i) => {
      writeFileSync(join(base, `${String(now - i).padStart(15, '0')}-1-0000000${i}.json`), body);
    });
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now }), null);
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: now, text: 'x' }, { dir, now }));
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now })?.text, 'x');
  } finally {
    rm(dir);
  }
});

test('queue: a corrupt entry file is skipped by take and pruned once it has expired', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 9_000_000;
    const base = join(dir, QUEUE);
    mkdirSync(base);
    const corrupt = `${String(now - 10).padStart(15, '0')}-1-deadbeef.json`;
    const junkName = 'not-an-entry.json';
    writeFileSync(join(base, corrupt), '{half a fi');
    writeFileSync(join(base, junkName), '{}');
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: now, text: 'good' }, { dir, now }));
    // The corrupt file is older than the good one, so take meets it first and moves on.
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now })?.text, 'good');
    assert.ok(queueNames(dir).includes(corrupt), 'a fresh corrupt file is only skipped');
    assert.equal(queueNames(dir).includes(junkName), false, 'a name that does not parse counts as expired');
    const later = now + SUBAGENT_CONTEXT_TTL_MS + 5;
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: later, text: 'next' }, { dir, now: later }));
    assert.equal(queueNames(dir).includes(corrupt), false, 'pruned once expired');
    assert.equal(queueNames(dir).length, 1);
  } finally {
    rm(dir);
  }
});

test('queue: a claimed entry is not delivered again, and the claim file is pruned after the TTL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 7_000_000;
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: now, text: 'only' }, { dir, now }));
    const [name] = queueNames(dir);
    const base = join(dir, QUEUE);
    // Another process won the claim but has not deleted the entry yet.
    writeFileSync(join(base, `${name}.claim`), '');
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now }), null);
    assert.equal(queueNames(dir).length, 2, 'the claimed entry is left to its owner');
    const later = now + SUBAGENT_CONTEXT_TTL_MS + 1;
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: later, text: 'new' }, { dir, now: later }));
    assert.deepEqual(queued(dir).map((e) => e.text), ['new']);
    assert.equal(queueNames(dir).length, 1, 'the expired entry and its claim file were pruned');
  } finally {
    rm(dir);
  }
});

test('queue: the write goes through a temp file that is renamed away, and bad input never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', text: 'x' }, { dir }));
    assert.deepEqual(readdirSync(dir), [QUEUE], 'only the queue directory');
    const names = queueNames(dir);
    assert.equal(names.length, 1);
    assert.match(names[0], /^\d{15}-\d+-[0-9a-f]{8}\.json$/, 'no .tmp file left behind');
    assert.equal(enqueueSubagentContext(null, { dir }), false);
    assert.equal(enqueueSubagentContext({ session: '', type: 'a', text: 'x' }, { dir }), false);
    assert.equal(enqueueSubagentContext({ session: 's', type: 'a', text: '' }, { dir }), false);
    assert.equal(queueNames(dir).length, 1, 'rejected input wrote nothing');
    // A directory that cannot be created (a file is in the way) is a quiet false.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');
    assert.equal(enqueueSubagentContext({ session: 's', type: 'a', text: 'x' }, { dir: join(blocker, 'sub') }), false);
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir: join(blocker, 'sub') }), null);
  } finally {
    rm(dir);
  }
});

test('queue: an old single-file queue is removed on the next write and never read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const now = 1_000_000;
    const old = join(dir, 'subagent-context.json');
    writeFileSync(old, JSON.stringify({ entries: [{ session: 's', type: 'a', at: now, text: 'old' }] }));
    assert.equal(takeSubagentContext({ session: 's', type: 'a' }, { dir, now }), null, 'not read any more');
    assert.ok(enqueueSubagentContext({ session: 's', type: 'a', at: now, text: 'new' }, { dir, now }));
    assert.equal(existsSync(old), false);
  } finally {
    rm(dir);
  }
});

test('queue: parallel processes enqueue and take with nothing lost and nothing delivered twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const moduleUrl = JSON.stringify(new URL('../src/subagent-context.js', import.meta.url).href);
    const N = 8;
    const spawnAsync = (body) => new Promise((resolve) => {
      const script = `
        import { enqueueSubagentContext, takeSubagentContext } from ${moduleUrl};
        const dir = ${JSON.stringify(dir)};
        ${body}
      `;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (code) => resolve({ code, out: out.trim(), err }));
    });
    const runAll = (bodyFor) => Promise.all(Array.from({ length: N }, (_, i) => spawnAsync(bodyFor(i))));
    const expected = Array.from({ length: N }, (_, i) => `e${i}`);

    const put = await runAll((i) => `console.log(enqueueSubagentContext({ session: 'S', type: 'T', text: 'e${i}' }, { dir }));`);
    for (const r of put) assert.deepEqual([r.code, r.out], [0, 'true'], r.err);
    assert.deepEqual(queued(dir).map((e) => e.text).sort(), expected, 'every enqueue left its file');

    const got = await runAll(() => `const e = takeSubagentContext({ session: 'S', type: 'T' }, { dir }); console.log(e ? e.text : '');`);
    for (const r of got) assert.equal(r.code, 0, r.err);
    assert.deepEqual(got.map((r) => r.out).sort(), expected, 'each appendix delivered exactly once');
    assert.deepEqual(queued(dir), [], 'no entry left');
    assert.ok(queueNames(dir).every((n) => n.endsWith('.claim')), 'only claim files remain until the TTL prune');
  } finally {
    rm(dir);
  }
});

/* The decision */

const autoPayload = (over = {}, input = {}) => ({
  tool_name: 'Agent',
  session_id: 'sess-1',
  permission_mode: 'auto',
  tool_input: { prompt: 'summarize this file', subagent_type: 'general-purpose', ...input },
  ...over,
});

async function decide(payload, { registered = true } = {}) {
  const queueDir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const decision = await decideForDelegation(payload, {
      cfg: ON, home: EMPTY_HOME, routeCaps: null, queueDir, subagentStartRegistered: () => registered,
    });
    return { decision, queued: queued(queueDir) };
  } finally {
    rm(queueDir);
  }
}

test('auto mode with the SubagentStart hook registered: queued, no output, one entry holding the appendix', async () => {
  const before = Date.now();
  const { decision, queued } = await decide(autoPayload());
  assert.deepEqual(decision, { queued: true });
  assert.equal(formatHookOutput(decision), null);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].session, 'sess-1');
  assert.equal(queued[0].type, 'general-purpose');
  assert.ok(queued[0].at >= before);
  assert.ok(queued[0].text.startsWith(DELEGATION_MARKER));
  assert.match(queued[0].text, /## Bounds and output shape/);
});

test('auto mode queues under the call\'s subagent_type, and general-purpose when it names none', async () => {
  const named = await decide(autoPayload({}, { subagent_type: 't1-worker' }));
  assert.equal(named.queued[0].type, 't1-worker');
  const bare = await decide(autoPayload({ tool_input: { prompt: 'summarize this file' } }));
  assert.equal(bare.queued[0].type, 'general-purpose');
});

test('every other case keeps the rewrite exactly as before', async () => {
  const plain = await decide(autoPayload({ permission_mode: 'default' }));
  assert.ok(plain.decision.updatedInput.prompt.includes(DELEGATION_MARKER), 'not auto mode');
  assert.equal(plain.queued.length, 0);
  assert.ok(formatHookOutput(plain.decision));

  const unset = await decide(autoPayload({ permission_mode: undefined }));
  assert.ok(unset.decision.updatedInput, 'no permission_mode at all');

  const unregistered = await decide(autoPayload(), { registered: false });
  assert.ok(unregistered.decision.updatedInput.prompt.includes(DELEGATION_MARKER), 'hook not registered');
  assert.equal(unregistered.queued.length, 0);

  const noSession = await decide(autoPayload({ session_id: undefined }));
  assert.ok(noSession.decision.updatedInput, 'nothing for the SubagentStart side to match on');

  // An effort raise needs updatedInput.effort, so it cannot ride the queue.
  const raise = await decide(autoPayload({}, { model: 'sonnet' }));
  assert.equal(raise.decision.updatedInput.effort, 'high');
  assert.equal(raise.queued.length, 0);
});

test('auto mode: a model raise keeps the rewrite as well', async () => {
  const JUDGE = 'Audit the login flow and list what is unsafe, with a recommendation for each.';
  const countsDir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  const queueDir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const decision = await decideForDelegation(autoPayload({}, { prompt: JUDGE, model: 'sonnet' }), {
      cfg: ON, home: EMPTY_HOME, routeCaps: null, countsDir, queueDir, subagentStartRegistered: () => true,
    });
    assert.equal(decision.queued, undefined);
    assert.equal(decision.updatedInput.model, 'opus');
    assert.equal(queueNames(queueDir).length, 0, 'nothing was queued');
  } finally {
    rm(countsDir);
    rm(queueDir);
  }
});

test('formatHookOutput: a decision without updatedInput prints nothing', () => {
  assert.equal(formatHookOutput({ queued: true }), null);
  assert.equal(formatHookOutput({}), null);
  assert.ok(formatHookOutput({ updatedInput: { prompt: 'x' } }));
});

/* The Korean gate */

test('hangulShare counts letters only, and is 0 without any', () => {
  assert.equal(hangulShare(''), 0);
  assert.equal(hangulShare('1234 !?/ src/a.js'.replace(/[A-Za-z]/g, '')), 0);
  assert.equal(hangulShare('한국어'), 1);
  assert.equal(hangulShare('ab한글'), 0.5);
  assert.equal(hangulShare('ㄱㅏ ab'), 0.5, 'compatibility jamo count as Hangul');
  assert.equal(hangulShare(null), 0);
  assert.equal(KOREAN_SHARE_MIN, 0.1);
});

test('Korean gate: share decides, the .ko. and "in Korean" signals still work', async () => {
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: true } };
  const ask = (prompt) => buildAppendix({ tool_name: 'Task', tool_input: { prompt } }, { cfg, home: EMPTY_HOME });
  const SECTION = /## Korean style guidance/;

  assert.match(await ask('한국어로 보고하십시오.'), SECTION);

  // About 3,000 English letters with one quoted Korean phrase: share ~0.001.
  const english = 'Investigate the failing build and report which step breaks. '.repeat(52);
  const quoted = `${english}The error message reads "파일을 찾을 수 없습니다".`;
  assert.ok(hangulShare(quoted) < 0.05);
  assert.doesNotMatch(await ask(quoted), SECTION);

  // Korean prose around code paths: the paths are Latin letters, share lands near 0.3.
  const mixed = '다음 파일을 수정하고 테스트를 확인하십시오: src/delegation-guard.js, src/commands/delegate.js, src/installer.js';
  const share = hangulShare(mixed);
  assert.ok(share >= 0.25 && share <= 0.4, `share ${share}`);
  assert.match(await ask(mixed), SECTION);

  assert.match(await ask('Rewrite docs/COMMANDS.ko.md from the English original'), SECTION);
  assert.match(await ask('Write the release note in Korean'), SECTION);
  assert.doesNotMatch(await ask('Investigate the failing build, no Korean here'), SECTION);
});

/* Installer entries */

const installerUrl = JSON.stringify(new URL('../src/installer.js', import.meta.url).href);

function runInstaller(home, body) {
  const script = `
    import { installDelegationGuardHook, removeDelegationGuardHook, subagentStartHookRegistered, uninstallAll } from ${installerUrl};
    import { readFileSync } from 'node:fs';
    import { homedir } from 'node:os';
    import { join } from 'node:path';
    // homedir(), not process.env.HOME: the installer resolves ~/.claude that way.
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
    ${body}
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: tempEnv(home) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim());
}

test('the two hook commands never read as each other', () => {
  assert.equal(isDelegationGuardHookCommand('sprag delegate --hook'), true);
  assert.equal(isDelegationGuardHookCommand('sprag delegate --subagent-start'), false);
  assert.equal(isSubagentStartHookCommand('sprag delegate --subagent-start'), true);
  assert.equal(isSubagentStartHookCommand('sprag delegate --hook'), false);
  assert.equal(isSubagentStartHookCommand('other-tool delegate --subagent-start'), false);
  assert.equal(isSubagentStartHookCommand(undefined), false);
});

test('install twice leaves one SubagentStart entry; remove takes ours and keeps a foreign hook', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const foreign = { type: 'command', command: 'somebody-elses-start-hook' };
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { SubagentStart: [{ hooks: [foreign] }] } }, null, 2) + '\n');

    const out = runInstaller(home, `
      const steps = [];
      steps.push(subagentStartHookRegistered());
      steps.push(installDelegationGuardHook().action);
      steps.push(installDelegationGuardHook().action);
      steps.push(settings().hooks.SubagentStart);
      steps.push(subagentStartHookRegistered());
      steps.push(removeDelegationGuardHook().action);
      steps.push(settings().hooks);
      steps.push(subagentStartHookRegistered());
      console.log(JSON.stringify(steps));
    `);
    const [before, first, second, startList, registered, removed, hooksAfter, registeredAfter] = out;
    assert.equal(before, false);
    assert.equal(first, 'updated');
    assert.equal(second, 'exists');
    assert.equal(startList.length, 2, 'the foreign group plus one of ours');
    const ours = startList.flatMap((m) => m.hooks).filter((h) => /delegate --subagent-start$/.test(h.command));
    assert.equal(ours.length, 1);
    assert.equal(ours[0].timeout, 10);
    assert.equal(startList.some((m) => m.matcher !== undefined && m.hooks.some((h) => /subagent-start/.test(h.command))), false, 'no matcher: all agent types');
    assert.equal(registered, true);
    assert.equal(removed, 'removed');
    assert.deepEqual(hooksAfter, { SubagentStart: [{ hooks: [foreign] }] }, 'only the foreign hook is left, PreToolUse key gone');
    assert.equal(registeredAfter, false);
  } finally {
    rm(dir);
  }
});

test('remove: another tool\'s hook in the same SubagentStart group survives, and an emptied key is dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const neighbour = { type: 'command', command: 'some-other-tool watch --start' };
    const out = runInstaller(home, `
      const { writeFileSync } = await import('node:fs');
      installDelegationGuardHook();
      const s = settings();
      s.hooks.SubagentStart[0].hooks.push(${JSON.stringify(neighbour)});
      writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\\n');
      const steps = [removeDelegationGuardHook().action, settings().hooks.SubagentStart];
      // A second guard install, then remove again: now the key holds only ours.
      writeFileSync(settingsPath, '{}\\n');
      installDelegationGuardHook();
      removeDelegationGuardHook();
      steps.push(settings());
      console.log(JSON.stringify(steps));
    `);
    assert.equal(out[0], 'removed');
    assert.deepEqual(out[1], [{ hooks: [neighbour] }]);
    assert.deepEqual(out[2], { hooks: {} }, 'the empty SubagentStart and PreToolUse keys are gone');
  } finally {
    rm(dir);
  }
});

test('install refuses a SubagentStart that is not an array and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settingsPath = join(home, '.claude', 'settings.json');
    const original = JSON.stringify({ hooks: { SubagentStart: 'nope' } }, null, 2) + '\n';
    writeFileSync(settingsPath, original);
    const res = runInstaller(home, 'console.log(JSON.stringify(installDelegationGuardHook()));');
    assert.equal(res.action, 'skipped');
    assert.match(res.reason, /hooks\.SubagentStart is not an array/);
    assert.equal(readFileSync(settingsPath, 'utf8'), original);
  } finally {
    rm(dir);
  }
});

test('uninstall removes our SubagentStart hook and keeps a foreign one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const foreign = { type: 'command', command: 'somebody-elses-start-hook' };
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { SubagentStart: [{ hooks: [foreign] }] } }) + '\n');
    const out = runInstaller(home, `
      installDelegationGuardHook();
      uninstallAll();
      console.log(JSON.stringify(settings().hooks));
    `);
    assert.deepEqual(out, { SubagentStart: [{ hooks: [foreign] }] });
  } finally {
    rm(dir);
  }
});

/* The CLI entry points, end to end */

test('delegate --subagent-start prints the SubagentStart JSON once, then nothing; malformed input prints nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const env = tempEnv(home);
    const run = (sub, input) => spawnSync(process.execPath, [CLI, 'delegate', sub], { encoding: 'utf8', env, input });

    assert.equal(run('on').status, 0);

    // PreToolUse side, auto mode: nothing on stdout (no updatedInput), text queued.
    const hook = run('--hook', JSON.stringify(autoPayload({ session_id: 'live-1' }, { subagent_type: 't1-worker' })));
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout, '', 'auto mode must not change the input');

    // A different session or type gets nothing and leaves the entry alone.
    assert.equal(run('--subagent-start', JSON.stringify({ session_id: 'other', agent_type: 't1-worker' })).stdout, '');
    assert.equal(run('--subagent-start', JSON.stringify({ session_id: 'live-1', agent_type: 'general-purpose' })).stdout, '');

    const got = run('--subagent-start', JSON.stringify({ session_id: 'live-1', agent_type: 't1-worker', hook_event_name: 'SubagentStart' }));
    assert.equal(got.status, 0, got.stderr);
    const parsed = JSON.parse(got.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
    assert.ok(parsed.hookSpecificOutput.additionalContext.startsWith(DELEGATION_MARKER));
    assert.match(parsed.hookSpecificOutput.additionalContext, /## Bounds and output shape/);

    const again = run('--subagent-start', JSON.stringify({ session_id: 'live-1', agent_type: 't1-worker' }));
    assert.equal(again.status, 0);
    assert.equal(again.stdout, '', 'a second start of the same type gets nothing');

    for (const stdin of ['', 'not json at all', '{"session_id"', '{}']) {
      const r = run('--subagent-start', stdin);
      assert.equal(r.status, 0, `exit code for ${JSON.stringify(stdin)}: ${r.stderr}`);
      assert.equal(r.stdout, '', `stdout for ${JSON.stringify(stdin)} must be empty`);
    }

    // Outside auto mode the old rewrite is unchanged.
    const plain = run('--hook', JSON.stringify(autoPayload({ permission_mode: 'default' })));
    assert.ok(JSON.parse(plain.stdout).hookSpecificOutput.updatedInput.prompt.includes(DELEGATION_MARKER));

    // Status shows the new hook.
    const status = run('');
    assert.match(status.stdout, /SubagentStart hook: registered|SubagentStart 훅: 등록됨/);
  } finally {
    rm(dir);
  }
});

test('auto mode without the SubagentStart hook in settings.json falls back to the rewrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-sc-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const env = tempEnv(home);
    const r = spawnSync(process.execPath, [CLI, 'delegate', '--hook'], {
      encoding: 'utf8', env, input: JSON.stringify(autoPayload()),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout).hookSpecificOutput.updatedInput.prompt.includes(DELEGATION_MARKER));
  } finally {
    rm(dir);
  }
});
