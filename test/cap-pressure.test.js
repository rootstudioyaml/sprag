/**
 * Usage-limit pressure in the delegation hint. The prompt hook used to say the
 * same thing at 94% of the weekly limit as at 5%; capPressure reads the
 * statusline snapshot and routeHint ends with one more line when a window is
 * running low. The line changes how readily the model delegates, never the
 * target tier, the caps, or the requests that stay on the top tier.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

// caps-cache resolves its file when it loads, so the sandbox comes first.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-cap-pressure-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;
const stateDir = join(home, 'config', 'claude-token-saver');
mkdirSync(stateDir, { recursive: true });

const { capPressure, loadRecentSnapshot, CAP_PRESSURE_HIGH, CAP_PRESSURE_CRITICAL } = await import('../src/caps-cache.js');
const { routeHint, pressureLine } = await import('../src/route-inject.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const snap = (...windows) => ({ caps: { windows }, model: null });
const win = (key, usedPct) => ({ key, usedPct, resetsAt: null });
const writeCaps = (dir, windows, capturedAt = Date.now()) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'last-caps.json'), JSON.stringify({ capturedAt, caps: windows ? { windows } : null, model: null }) + '\n');
};

test('thresholds are 70 and 90, and the boundaries fall on the higher side', () => {
  assert.equal(CAP_PRESSURE_HIGH, 70);
  assert.equal(CAP_PRESSURE_CRITICAL, 90);
  const level = (pct) => capPressure({ snapshot: snap(win('five_hour', pct)) }).level;
  assert.equal(level(69), 'normal');
  assert.equal(level(70), 'high');
  assert.equal(level(89), 'high');
  assert.equal(level(90), 'critical');
  assert.equal(level(100), 'critical');
});

test('the busiest window decides, and its key and source are reported', () => {
  const p = capPressure({ snapshot: snap(win('five_hour', 20), win('seven_day', 93), win('x_window', 50)) });
  assert.deepEqual(p, { level: 'critical', pct: 93, key: 'seven_day', source: 'subscription' });
});

test('no snapshot, no windows, or no usable percentage gives null', () => {
  assert.equal(capPressure({ snapshot: null }), null);
  assert.equal(capPressure({ snapshot: { caps: null, model: 'x' } }), null);
  assert.equal(capPressure({ snapshot: snap() }), null);
  assert.equal(capPressure({ snapshot: snap(win('five_hour', null), win('seven_day', undefined), { key: 'a', usedPct: 'NaN' }) }), null);
  // A window with a number still counts next to one without.
  assert.equal(capPressure({ snapshot: snap(win('five_hour', null), win('seven_day', 80)) }).key, 'seven_day');
});

test('a snapshot older than five minutes is dropped, so the default reads null', () => {
  writeCaps(stateDir, [win('seven_day', 95)], Date.now() - 6 * 60 * 1000);
  assert.equal(loadRecentSnapshot(), null);
  assert.equal(capPressure(), null);
  writeCaps(stateDir, [win('seven_day', 95)]);
  assert.equal(capPressure().level, 'critical');
});

test('a per-model window counts only for that model family, and for every session when the family is unknown', () => {
  const s = snap(win('five_hour', 10), win('seven_day_opus', 95), win('seven_day_sonnet', 40));
  assert.equal(capPressure({ snapshot: s, sessionModel: 'claude-sonnet-5-5' }).key, 'seven_day_sonnet');
  assert.equal(capPressure({ snapshot: s, sessionModel: 'claude-sonnet-5-5' }).level, 'normal');
  assert.equal(capPressure({ snapshot: s, sessionModel: 'Opus 4.7' }).key, 'seven_day_opus');
  assert.equal(capPressure({ snapshot: s, sessionModel: 'Fable 5.1' }).key, 'five_hour');
  assert.equal(capPressure({ snapshot: s }).key, 'seven_day_opus', 'unknown model keeps every window');
  assert.equal(capPressure({ snapshot: s, sessionModel: 'prod-large' }).key, 'seven_day_opus', 'an opaque gateway alias has no family');
  // Windows without a family are never filtered out.
  assert.equal(capPressure({ snapshot: snap(win('seven_day', 91)), sessionModel: 'claude-haiku-4-5' }).level, 'critical');
});

test('the LiteLLM budget is an ordinary window with source litellm', () => {
  const p = capPressure({ snapshot: snap({ key: 'litellm_budget', usedPct: 72, spend: 72, maxBudget: 100 }) });
  assert.deepEqual(p, { level: 'high', pct: 72, key: 'litellm_budget', source: 'litellm' });
  const both = capPressure({ snapshot: snap(win('seven_day', 30), { key: 'litellm_budget', usedPct: 96 }) });
  assert.equal(both.source, 'litellm');
});

const rules = [
  { category: 'check', tier: 'T2', agent: 't2-explore', budget: { calls: 8, out: 1500 } },
];
const PROMPT = '지금 실행 중인 버전이 뭔지 확인해줘';
const hint = (opts) => routeHint(PROMPT, { rules, lang: 'ko', root: home, ...opts });

test('a high or critical pressure ends the hint with one line, in the window label the statusline uses', () => {
  const plain = hint();
  assert.ok(plain);
  assert.equal(hint({ pressure: null }), plain, 'no pressure is the hint as it was');
  assert.equal(hint({ pressure: { level: 'normal', pct: 69, key: 'five_hour', source: 'subscription' } }), plain);

  const high = hint({ pressure: { level: 'high', pct: 72.4, key: 'seven_day', source: 'subscription' } });
  assert.equal(high, `${plain}\n한도 압박: 7D 72%. 판단이 애매하면 위임하십시오.`);

  const crit = hint({ pressure: { level: 'critical', pct: 94, key: 'seven_day_opus', source: 'subscription' } });
  assert.equal(crit, `${plain}\n한도 위험: 7D-O 94%. 여러 단계 작업도 위임 대상으로 보고, 메인 모델을 바꾸는 것(/model)도 사용자에게 제안하십시오.`);

  const budget = hint({ pressure: { level: 'high', pct: 80, key: 'litellm_budget', source: 'litellm' } });
  assert.match(budget, /한도 압박: BUDGET 80%\./);

  const en = routeHint(PROMPT, { rules, lang: 'en', root: home, pressure: { level: 'critical', pct: 91, key: 'five_hour', source: 'subscription' } });
  assert.match(en, /\nUsage limit critical: 5H 91%\. .*\(\/model\)\.$/);
  assert.match(routeHint(PROMPT, { rules, lang: 'en', root: home, pressure: { level: 'high', pct: 70, key: 'five_hour' } }),
    /\nUsage limit pressure: 5H 70%\. When in doubt, delegate\.$/);
});

test('the Korean pressure lines carry no em dash', () => {
  for (const level of ['high', 'critical']) {
    assert.doesNotMatch(pressureLine({ level, pct: 95, key: 'seven_day' }, { lang: 'ko' }), /—/);
  }
});

test('the pressure line leaves the target and caps alone and never appears on a quiet or escalated request', () => {
  const pressure = { level: 'critical', pct: 99, key: 'seven_day', source: 'subscription' };
  const withLine = hint({ pressure });
  assert.ok(withLine.startsWith(hint()), 'the hint text itself is unchanged');
  // Design, security and deploy requests stay silent whatever the pressure.
  for (const text of ['보안 취약점 있는지 확인해줘', '배포 전에 상태 확인해줘', '이 구조를 새로 설계해줘']) {
    assert.equal(routeHint(text, { rules, lang: 'ko', root: home, pressure }), null, text);
  }
  // So does a request no rule covers.
  assert.equal(routeHint('zzzz qqqq wwww eeee rrrr', { rules, lang: 'ko', root: home, pressure }), null);
});

test('the brief hook appends the line from a fresh snapshot, and without one prints the old hint byte for byte', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-cap-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const hHome = join(dir, 'home');
  const state = join(dir, 'state');
  const sdir = join(state, 'claude-token-saver');
  const project = join(dir, 'project');
  for (const d of [join(hHome, '.claude'), sdir, project]) mkdirSync(d, { recursive: true });
  writeFileSync(join(sdir, 'config.json'), JSON.stringify({ language: 'ko' }) + '\n');
  writeFileSync(join(sdir, 'model-rules.json'), JSON.stringify({ rules }) + '\n');

  const run = (prompt) => execFileSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: project,
    env: childEnv({ HOME: hHome, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', SPRAG_NO_UPDATE_CHECK: '1' }),
    input: JSON.stringify({ session_id: 'cap-hook', prompt, cwd: project }),
    encoding: 'utf8',
  });

  const base = run(PROMPT);
  assert.match(base, /위임 룰/);
  assert.doesNotMatch(base, /한도/);

  writeCaps(sdir, [win('five_hour', 12), win('seven_day', 75)]);
  assert.equal(run(PROMPT), `${base.trimEnd()}\n한도 압박: 7D 75%. 판단이 애매하면 위임하십시오.\n`);

  writeCaps(sdir, [win('seven_day', 96)]);
  assert.match(run(PROMPT), /\n한도 위험: 7D 96%\. /);

  // A stale snapshot and an escalated request both leave the output alone.
  writeCaps(sdir, [win('seven_day', 96)], Date.now() - 10 * 60 * 1000);
  assert.equal(run(PROMPT), base);
  writeCaps(sdir, [win('seven_day', 96)]);
  assert.doesNotMatch(run('보안 취약점 있는지 확인해줘'), /한도/);
});

test('the statusline writes the LiteLLM budget into last-caps.json, which is where the hook reads it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-cap-litellm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const hHome = join(dir, 'home');
  const state = join(dir, 'state');
  const sdir = join(state, 'claude-token-saver');
  const proj = join(hHome, '.claude', 'projects', '-gw');
  for (const d of [sdir, proj]) mkdirSync(d, { recursive: true });
  const base = 'http://127.0.0.1:9';
  // A fresh check stamp keeps the statusline from spawning a refresh child.
  writeFileSync(join(sdir, 'litellm-budget.json'), JSON.stringify({ base, checkedAt: Date.now(), source: 'key', spend: 85, maxBudget: 100, budgetResetAt: null }) + '\n');
  writeFileSync(join(proj, 'sess-gw.jsonl'), JSON.stringify({
    type: 'assistant', sessionId: 'sess-gw', timestamp: new Date().toISOString(),
    message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 1 } },
  }) + '\n');

  execFileSync(process.execPath, [CLI, '--statusline'], {
    cwd: dir,
    env: childEnv({ HOME: hHome, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', SPRAG_NO_UPDATE_CHECK: '1',
      ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'test-token' }),
    input: JSON.stringify({ model: { display_name: 'Sonnet 5.5' }, session_id: 'sess-gw' }),
    encoding: 'utf8',
  });

  const saved = JSON.parse(readFileSync(join(sdir, 'last-caps.json'), 'utf8'));
  const w = saved.caps && saved.caps.windows.find((x) => x.key === 'litellm_budget');
  assert.ok(w, 'the budget window is in the snapshot');
  assert.equal(Math.round(w.usedPct), 85);
  assert.deepEqual(capPressure({ snapshot: { caps: saved.caps } }), { level: 'high', pct: w.usedPct, key: 'litellm_budget', source: 'litellm' });
});
