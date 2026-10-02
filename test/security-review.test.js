import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-security-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');

const { isTrustedProject, keyFromApiKeyHelper } = await import('../src/gateway-auth.js');
const doc2md = createRequire(import.meta.url)('../src/doc2md.cjs');

after(() => rmSync(home, { recursive: true, force: true }));

/** A project whose settings carry a helper that leaves a marker when it runs. */
function project(name, file = 'settings.json') {
  const root = join(home, name);
  const marker = join(root, 'helper-ran');
  mkdirSync(join(root, '.claude'), { recursive: true });
  // A script file instead of `node -e`: nested quoting does not survive cmd.exe.
  const helper = join(root, 'helper.cjs');
  writeFileSync(helper, `require('fs').writeFileSync(${JSON.stringify(marker)}, '1'); console.log('token-from-${name}');\n`);
  writeFileSync(join(root, '.claude', file), JSON.stringify({ apiKeyHelper: `node "${helper}"` }));
  return { root, marker };
}

const trust = (...roots) => writeFileSync(join(home, '.claude.json'),
  JSON.stringify({ projects: Object.fromEntries(roots.map((r) => [r, { hasTrustDialogAccepted: true }])) }));

test('a project counts as trusted only when Claude Code recorded the trust dialog for it or a parent', () => {
  const { root } = project('trust-check');
  assert.equal(isTrustedProject(root), false, 'no ~/.claude.json at all');
  writeFileSync(join(home, '.claude.json'), '{not json');
  assert.equal(isTrustedProject(root), false, 'an unreadable record is not trust');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [root]: { hasTrustDialogAccepted: false } } }));
  assert.equal(isTrustedProject(root), false);
  trust(root);
  assert.equal(isTrustedProject(root), true);
  assert.equal(isTrustedProject(join(root, 'packages', 'inner')), true, 'trusting a folder covers what is inside it');
  assert.equal(isTrustedProject(join(home, 'trust-check-sibling')), false);
});

test('an apiKeyHelper in project settings does not run in a folder the user has not trusted', () => {
  for (const file of ['settings.json', 'settings.local.json']) {
    const { root, marker } = project(`cloned-${file}`, file);
    trust(join(home, 'some-other-project'));
    assert.equal(keyFromApiKeyHelper(root), null);
    assert.equal(existsSync(marker), false, `${file}: the repository's command must not have run`);

    trust(root);
    assert.equal(keyFromApiKeyHelper(root), `token-from-cloned-${file}`);
    assert.equal(existsSync(marker), true);
  }
});

test('the user-level apiKeyHelper still runs wherever the CLI is started', () => {
  const { root, marker } = project('untrusted-with-user-helper');
  rmSync(join(home, '.claude.json'), { force: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: `node -e "console.log('user-token')"` }));
  assert.equal(keyFromApiKeyHelper(root), 'user-token');
  assert.equal(existsSync(marker), false);
  rmSync(join(home, '.claude', 'settings.json'));
});

test('the doc2md hook answers the permission question only when it refuses', () => {
  const note = JSON.parse(doc2md.formatHookOutput({ deny: false, reason: '[doc2md] could not convert, reading the original' }));
  assert.deepEqual(note.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    additionalContext: '[doc2md] could not convert, reading the original',
  });
  assert.equal('permissionDecision' in note.hookSpecificOutput, false, 'a note must not approve the call');

  const refusal = JSON.parse(doc2md.formatHookOutput({ deny: true, reason: 'read the converted file' }));
  assert.deepEqual(refusal.hookSpecificOutput, {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'read the converted file',
  });
  assert.equal(doc2md.formatHookOutput(null), null);
});

test('a sensitive-pattern document is noted, not approved', (t) => {
  const dir = mkdtempSync(join(home, 'docs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'passwords.xlsx');
  writeFileSync(file, 'PK');
  const decision = doc2md.decideForRead({ tool_name: 'Read', tool_input: { file_path: file } });
  if (!decision) return; // nothing to say is also not an approval
  const out = JSON.parse(doc2md.formatHookOutput(decision)).hookSpecificOutput;
  assert.notEqual(out.permissionDecision, 'allow');
});
