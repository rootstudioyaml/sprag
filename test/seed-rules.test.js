/**
 * seed — the bundled starter rules are offered one at a time and every answer
 * sticks. Driven through the CLI against a throwaway HOME so the test exercises
 * what a real first session does: list, accept into a scope, decline, and see
 * the result land in the files the model reads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CLI_NAME } from '../src/cli-name.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');

function sandbox(lang = 'en') {
  const dir = mkdtempSync(join(tmpdir(), 'cts-seed-'));
  const home = join(dir, 'home');
  const state = join(dir, 'state');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(state, 'claude-token-saver'), { recursive: true });
  writeFileSync(join(state, 'claude-token-saver', 'config.json'), JSON.stringify({ language: lang }) + '\n');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: state,
    APPDATA: state,
    NO_COLOR: '1',
  };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 120_000 });
  return { dir, home, env, run };
}

test('seed lists every bundled preset on a fresh machine', () => {
  const s = sandbox();
  try {
    const out = s.run('seed');
    // Both kinds reach the user: tier-delegation rules and ratchet rules.
    assert.match(out, /\[run-t2\] T2 · "running commands \(build\/test\/git\)"/);
    assert.match(out, /\[fix-[0-9a-f]{6}\]/);
    const pending = Number(out.match(/seed — (\d+) preset/)[1]);
    assert.ok(pending >= 10, `expected the full preset set, got ${pending}`);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('accept registers a model preset and renders it into ratchet-model.md', () => {
  const s = sandbox();
  try {
    const out = s.run('seed', 'accept', 'run-t2', '--global');
    assert.match(out, /registered: run-t2 \[global\]/);
    const md = readFileSync(join(s.home, '.claude', 'ratchet-model.md'), 'utf8');
    assert.match(md, /Simple "running commands \(build\/test\/git\)" requests/);
    // A seeded rule must not claim recurrence it has never measured.
    assert.match(md, /preset \(curated\), registered \d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(md, /×0, err 0%/);
    // Answered once, never offered again.
    assert.doesNotMatch(s.run('seed'), /\[run-t2\]/);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('accept without a scope refuses instead of guessing', () => {
  const s = sandbox();
  try {
    assert.throws(() => s.run('seed', 'accept', 'run-t2'), /Scope required|적용 범위/);
    assert.ok(!existsSync(join(s.home, '.claude', 'ratchet-model.md')), 'nothing may be written');
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a ratchet preset lands in the global ratchet and a skip is permanent', () => {
  const s = sandbox();
  try {
    const id = s.run('seed').match(/\[(fix-[0-9a-f]{6})\]/)[1];
    s.run('seed', 'accept', id, '--global');
    assert.match(readFileSync(join(s.home, '.claude', 'ratchet.md'), 'utf8'), /## Rules/);

    const other = s.run('seed').match(/\[(fix-[0-9a-f]{6})\]/)[1];
    s.run('seed', 'skip', other);
    const after = s.run('seed');
    assert.doesNotMatch(after, new RegExp(`\\[${other}\\]`));
    assert.match(after, new RegExp(`${other}: skipped`));
    // reset brings the whole set back — the escape hatch for a wrong answer.
    s.run('seed', 'reset');
    assert.match(s.run('seed'), new RegExp(`\\[${other}\\]`));
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a preset is withheld when the user already has a rule of that shape', async () => {
  const s = sandbox();
  try {
    s.run('seed', 'accept', 'run-t2', '--global');
    // The user's own promote for the same tier+category must suppress the
    // sibling preset too — offering it would ignore state we can already see.
    const registry = JSON.parse(readFileSync(join(s.dir, 'state', 'claude-token-saver', 'model-rules.json'), 'utf8'));
    assert.equal(registry.rules.length, 1);
    assert.equal(registry.rules[0].origin, 'preset');
    assert.equal(registry.rules[0].signature, 'T2|run|preset');
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('the SessionStart offer carries no Korean for an English user, and Korean for a Korean one', () => {
  const en = sandbox('en');
  const ko = sandbox('ko');
  try {
    const enOut = execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
      env: en.env, encoding: 'utf8', input: '{"hook_event_name":"SessionStart"}', timeout: 120_000,
    });
    assert.ok(enOut.includes(`[${CLI_NAME} seed]`),
      'the offer is tagged with the command name the user would type');
    assert.doesNotMatch(enOut, /[가-힣]/, 'no Korean may leak into an English session context');

    const koOut = execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
      env: ko.env, encoding: 'utf8', input: '{"hook_event_name":"SessionStart"}', timeout: 120_000,
    });
    assert.match(koOut, /추천 룰/);
  } finally {
    rmSync(en.dir, { recursive: true, force: true });
    rmSync(ko.dir, { recursive: true, force: true });
  }
});

test('the offer leads with registering everything, in both languages', () => {
  // Ten-plus presets asked one at a time is a dozen prompts before the user gets
  // to their actual work, and the offer used to mention the bulk command only in
  // a trailing parenthesis — so the model dutifully walked them one by one and
  // never presented "all" as an option at all. Bulk goes first now; per-rule
  // stays available for whoever wants to read each one.
  //
  // Rendered through the CLI rather than by importing seedOfferBlock: the offer
  // reads real state, so an in-process call would see this machine's own answered
  // presets and find nothing to offer.
  for (const lang of ['ko', 'en']) {
    const s = sandbox(lang);
    try {
      const out = execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
        env: s.env, encoding: 'utf8', input: '{"hook_event_name":"SessionStart"}', timeout: 120_000,
      });
      const lines = out.split('\n');
      const idx = (needle) => lines.findIndex((l) => l.includes(needle));

      const all = idx('seed accept all --global');
      const project = idx('seed accept all --project');
      const one = idx('  3. ');
      const none = idx('seed skip all');
      for (const [name, i] of [['all --global', all], ['all --project', project], ['one at a time', one], ['skip all', none]]) {
        assert.ok(i >= 0, `${lang}: the offer must present "${name}"`);
      }
      assert.ok(all < project && project < one && one < none,
        `${lang}: choices must be ordered global, project, one-at-a-time, none`);

      // The count is interpolated, not spelled out: a stale literal would tell the
      // user a different number from the list printed right below it.
      const header = lines.find((l) => l.includes(`[${CLI_NAME} seed]`));
      assert.ok(header, `${lang}: the offer has a header`);
      const n = Number((header.match(/(\d+)/) || [])[1]);
      assert.ok(n > 1, `${lang}: the header states how many are pending`);
      const ordering = lines.find((l) => l.includes(`${CLI_NAME} seed accept all --global`));
      assert.ok(lines.some((l) => l !== header && l.includes(String(n))),
        `${lang}: the count appears again in the guidance rather than a hardcoded figure`);
      assert.ok(ordering, `${lang}: the bulk command is spelled out`);
    } finally {
      rmSync(s.dir, { recursive: true, force: true });
    }
  }
});

test('a rule line carries exactly one pair of quotes around the work type', () => {
  // The composed rule text already opens with its quoted work-type name, and the
  // offer wrapped it in another pair — `""명령 실행 …`.
  const s = sandbox('ko');
  try {
    const out = execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
      env: s.env, encoding: 'utf8', input: '{"hook_event_name":"SessionStart"}', timeout: 120_000,
    });
    const offer = out.slice(out.indexOf(`[${CLI_NAME} seed]`));
    assert.doesNotMatch(offer, /""/, 'no doubled quotes in the rendered offer');
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('every bundled preset is complete and both rule sets share one template', async () => {
  const { modelPresets, ratchetPresets } = await import('../src/seed-rules.js');
  const { modelRuleBaseText } = await import('../src/model-rules.js');
  const presets = modelPresets();
  assert.ok(presets.length > 0);
  const ids = new Set();
  for (const p of presets) {
    for (const k of ['id', 'tier', 'category', 'label', 'labelEn', 'agent', 'example', 'exampleEn']) {
      assert.ok(p[k], `preset ${p.id} is missing ${k}`);
    }
    assert.ok(['T1', 'T2'].includes(p.tier));
    assert.ok(p.budget && typeof p.budget.out === 'number');
    assert.ok(!ids.has(p.id), `duplicate preset id ${p.id}`);
    ids.add(p.id);
    // The English sentence must be English: the rule text is injected as
    // instructions, so a stray Korean label would flip a session's language.
    assert.doesNotMatch(modelRuleBaseText(p, 'en'), /[가-힣]/);
    assert.match(modelRuleBaseText(p, 'ko'), /[가-힣]/);
  }
  // Ratchet presets are bilingual for the same reason, with ids derived from
  // the Korean text so a reworded translation keeps the user's answer.
  for (const r of ratchetPresets('en')) {
    assert.doesNotMatch(r.text, /[가-힣]/, `preset ${r.id} has no English wording`);
  }
  const koIds = ratchetPresets('ko').map((r) => r.id);
  assert.deepEqual(ratchetPresets('en').map((r) => r.id), koIds);
});
