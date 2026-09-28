import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'smol-toml';
import { codexUserDir } from './agent.js';
import { pickBudgetSource } from './litellm-budget.js';

const run = promisify(execFile);

export function codexBudgetProvider({ home = codexUserDir(), env = process.env, providerName } = {}) {
  try {
    const cfg = parse(readFileSync(join(home, 'config.toml'), 'utf8'));
    const profile = cfg.profiles?.[cfg.profile] || {};
    const name = providerName || profile.model_provider || cfg.model_provider;
    const provider = cfg.model_providers?.[name];
    if (!provider || !/litellm/i.test(`${name} ${provider.name || ''}`)) return null;
    const url = new URL(provider.base_url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    url.search = ''; url.hash = '';
    return { name, base: url.toString().replace(/\/$/, ''),
      key: provider.env_key ? env[provider.env_key] : null,
      command: provider.auth?.command,
      args: provider.auth?.args || [] };
  } catch { return null; }
}

export async function codexProviderKey(provider, { execute = run } = {}) {
  let key = provider.key;
  if (!key && typeof provider.command === 'string') {
    try {
      const result = await execute(provider.command, provider.args, { encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 });
      key = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    } catch { throw new Error('Codex provider authentication helper failed'); }
  }
  if (!key) throw new Error('Codex provider credentials unavailable');
  return key;
}

export async function fetchCodexBudget(provider, { fetchImpl = fetch, execute = run, now = Date.now() } = {}) {
  const key = await codexProviderKey(provider, { execute });
  // Tokens stay in memory and headers, never in argv, state files or errors.
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };
  const get = async (path) => {
    try {
      const res = await fetchImpl(`${provider.base}${path}`, { headers, signal: AbortSignal.timeout(5000), redirect: 'error' });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const [keyResponse, userResponse] = await Promise.all([get('/key/info'), get('/user/info')]);
  if (!keyResponse && !userResponse) throw new Error('LiteLLM budget endpoints unavailable');
  const budget = pickBudgetSource(keyResponse?.info, userResponse);
  return budget ? { ...budget, checkedAt: now } : null;
}

// Refresh between frames without delaying terminal paint. Cache no credentials.
export function createCodexBudgetReader({ provider = codexBudgetProvider, fetchBudget = fetchCodexBudget, now = Date.now } = {}) {
  let base, snapshot = null, pending = false, checked = -Infinity;
  return function read() {
    const cfg = provider();
    if (!cfg) { base = null; snapshot = null; return null; }
    if (cfg.base !== base) { base = cfg.base; snapshot = null; checked = -Infinity; }
    if (!pending && now() - checked >= 300000) {
      checked = now(); pending = true;
      const requestedBase = base;
      Promise.resolve().then(() => fetchBudget(cfg)).then((value) => {
        if (base === requestedBase) snapshot = value;
      }).catch(() => {}).finally(() => { pending = false; });
    }
    return snapshot;
  };
}
