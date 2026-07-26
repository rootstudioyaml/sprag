import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeScanCachePath } from '../src/route-scan.js';
import { modelRulesPath } from '../src/model-rules.js';
import { briefStatePath } from '../src/brief.js';
import { userDataDir } from '../src/paths.js';

/**
 * Every state file must resolve through paths.js. Three modules used to carry
 * their own copy of the resolver that honored XDG_CONFIG_HOME on Linux only —
 * so on macOS/Windows an XDG override moved config.json and the session cache
 * while leaving route-scan.json, model-rules.json, and brief-state.json behind
 * in the platform default. CI on macOS/Windows is what surfaced it; these
 * assertions are what keep a fourth copy from reappearing.
 */
const PATHS = [
  ['route-scan.json', routeScanCachePath],
  ['model-rules.json', modelRulesPath],
  ['brief-state.json', briefStatePath],
];

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('XDG_CONFIG_HOME relocates every state file on every platform', () => {
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevAppData = process.env.APPDATA;
  process.env.XDG_CONFIG_HOME = '/xdg-sandbox';
  process.env.APPDATA = '/appdata-should-lose';
  try {
    for (const platform of ['linux', 'darwin', 'win32']) {
      withPlatform(platform, () => {
        // Compared against userDataDir() rather than a literal so the
        // assertion stays about "same resolver", not about separators.
        for (const [name, resolve] of PATHS) {
          const p = resolve();
          assert.ok(p.startsWith(userDataDir()), `${name} must live under userDataDir() on ${platform}: ${p}`);
          assert.ok(p.endsWith(name), `${name} resolved to ${p} on ${platform}`);
          assert.ok(p.includes('xdg-sandbox'), `XDG_CONFIG_HOME ignored for ${name} on ${platform}: ${p}`);
        }
      });
    }
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
  }
});

test('all state files share one directory', () => {
  const dirs = new Set(PATHS.map(([, resolve]) => resolve().replace(/[\\/][^\\/]+$/, '')));
  assert.equal(dirs.size, 1, `state files split across directories: ${[...dirs].join(', ')}`);
  assert.equal([...dirs][0], userDataDir());
});
