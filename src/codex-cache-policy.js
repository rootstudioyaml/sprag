import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { codexUserDir } from './agent.js';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';
import { codexBudgetProvider, codexProviderKey } from './codex-budget.js';
import { codexCachePolicy } from './codex-cache.js';
import { PRICE_MAX_AGE_MS, gatewayPrices } from './gateway-prices.js';
import { OPENAI_LIST_PRICES, OPENAI_PRICES_CHECKED_AT } from './openai-prices.js';

export { PRICE_MAX_AGE_MS, rate, deploymentPrice, gatewayPrices, codexRunCost } from './gateway-prices.js';

export const CACHE_POLICY_MAX_AGE_MS = 300000;
const OPENAI_POLICY = 'https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime';
const BEDROCK_POLICY = 'https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html#prompt-caching-openai';

function deploymentPolicy(row) {
  const params = row?.litellm_params || {}, info = row?.model_info || {};
  const route = typeof params.model === 'string' ? params.model : '';
  const base = typeof info.base_model === 'string' ? info.base_model : route;
  const backend = /^bedrock(?:\/|_mantle\/)/.test(route) ? 'Bedrock'
    : /^(?:openai\/)?gpt-/.test(route) ? 'OpenAI' : null;
  if (!backend || info.supports_prompt_caching === false) return null;
  // An OpenAI-compatible server is not necessarily OpenAI, even with a GPT alias.
  if (backend === 'OpenAI' && params.api_base) {
    try { if (new URL(params.api_base).hostname !== 'api.openai.com') return null; }
    catch { return null; }
  }
  const model = backend === 'Bedrock'
    ? base.replace(/^bedrock(?:\/converse)?\//, '').replace(/^bedrock_mantle\//, '').replace(/^(?:(?:global|us|eu|apac)\.)?openai\./, '')
    : route.replace(/^openai\//, '');
  const seconds = codexCachePolicy(model);
  if (!seconds) return null;
  const options = params.prompt_cache_options;
  if (options != null && (typeof options !== 'object' || Array.isArray(options))) return null;
  if (options?.ttl != null && options.ttl !== '30m') return null;
  if (options?.mode != null && !['implicit', 'explicit'].includes(options.mode)) return null;
  if (params.prompt_cache_retention != null) return null;
  return { backend, model, seconds, mode: options?.mode || 'implicit',
    reference: backend === 'Bedrock' ? BEDROCK_POLICY : OPENAI_POLICY };
}

export function gatewayCachePolicies(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('LiteLLM model/info returned no model list');
  const groups = new Map();
  for (const row of payload.data) {
    if (typeof row?.model_name !== 'string' || row.model_name.length > 256) continue;
    const group = groups.get(row.model_name) || [];
    group.push(deploymentPolicy(row));
    groups.set(row.model_name, group);
  }
  // All deployments behind an alias must agree; load balancing must not change TTL.
  return Object.fromEntries([...groups].map(([name, policies]) => [name,
    policies[0] && policies.every((p) => JSON.stringify(p) === JSON.stringify(policies[0])) ? policies[0] : null]));
}

function cacheFile(provider, { home = codexUserDir(), dir = userDataDir() } = {}) {
  const key = createHash('sha256').update(JSON.stringify([resolve(home), provider.name, provider.base])).digest('hex').slice(0, 24);
  return join(dir, 'codex-cache-policy', `${key}.json`);
}

function gatewayProvider(session, opts) {
  if (!session?.provider || session.provider === 'openai') return null;
  return codexBudgetProvider({ ...opts, providerName: session.provider });
}

/** True when Codex's OpenAI provider talks to api.openai.com itself, not to a proxy. No config = direct. */
export function isDirectOpenAI(provider, { home = codexUserDir() } = {}) {
  if (provider !== 'openai') return false;
  try {
    let cfg = {};
    try { cfg = parse(readFileSync(join(home, 'config.toml'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') return false; }
    if (cfg.openai_base_url && new URL(cfg.openai_base_url).hostname !== 'api.openai.com') return false;
  } catch { return false; }
  return true;
}

/**
 * The price table a Codex provider's calls are billed by: OpenAI list prices for
 * direct calls, the gateway's own /model/info prices for a LiteLLM provider.
 * Never a fallback chain, so a model the gateway does not price stays unpriced.
 */
export function codexPriceBook(provider, litellm, opts = {}) {
  if (isDirectOpenAI(provider, opts)) return { source: 'list', provider: 'openai', checkedAt: OPENAI_PRICES_CHECKED_AT, prices: OPENAI_LIST_PRICES };
  if (litellm?.provider === provider) return { ...litellm, source: 'litellm' };
  return null;
}

function directPolicy(session, { home = codexUserDir(), now = Date.now() } = {}) {
  if (!codexCachePolicy(session?.model) || !isDirectOpenAI(session?.provider, { home })) return null;
  return { backend: 'OpenAI', model: session.model, seconds: codexCachePolicy(session.model),
    requestedModel: session.model, provider: session.provider, checkedAt: now, reference: OPENAI_POLICY };
}

function selectPolicy(snapshot, session, now) {
  if (!Number.isFinite(snapshot?.checkedAt) || snapshot.checkedAt > now || now - snapshot.checkedAt >= CACHE_POLICY_MAX_AGE_MS) return null;
  const policy = Object.hasOwn(snapshot.models || {}, session.model) ? snapshot.models[session.model] : null;
  if (!policy || !['OpenAI', 'Bedrock'].includes(policy.backend) || policy.seconds !== codexCachePolicy(policy.model) || !policy.seconds) return null;
  return { ...policy, requestedModel: session.model, provider: session.provider, checkedAt: snapshot.checkedAt };
}

/** Offline read for statuslines and diagnostics; no auth helper or network calls. */
export function readCodexCachePolicy(session, opts = {}) {
  const direct = directPolicy(session, opts);
  if (direct) return direct;
  const provider = gatewayProvider(session, opts);
  if (!provider) return null;
  try { return selectPolicy(JSON.parse(readFileSync(cacheFile(provider, opts), 'utf8')), session, opts.now ?? Date.now()); }
  catch { return null; }
}

/**
 * Offline price table for the configured gateway, from the snapshot the cache
 * policy refresh writes. Prices change rarely, so a week-old table still counts;
 * anything older reads as unknown rather than silently current.
 */
export function readCodexPrices({ provider, now = Date.now(), ...opts } = {}) {
  provider ??= codexBudgetProvider(opts);
  if (!provider) return null;
  try {
    const snapshot = JSON.parse(readFileSync(cacheFile(provider, opts), 'utf8'));
    if (!Number.isFinite(snapshot?.checkedAt) || snapshot.checkedAt > now || now - snapshot.checkedAt > PRICE_MAX_AGE_MS) return null;
    if (!snapshot.prices || typeof snapshot.prices !== 'object') return null;
    return { checkedAt: snapshot.checkedAt, provider: provider.name, base: provider.base, prices: snapshot.prices };
  } catch { return null; }
}

/** Fetch prices for the configured gateway without needing a session. */
export async function refreshCodexPrices({ provider = codexBudgetProvider(), fetchImpl = fetch, execute, ...opts } = {}) {
  if (!provider) throw new Error('No configured LiteLLM endpoint for Codex');
  await writeGatewaySnapshot(provider, { fetchImpl, execute, ...opts });
  return readCodexPrices({ provider, ...opts });
}

async function writeGatewaySnapshot(provider, { fetchImpl = fetch, execute, ...opts } = {}) {
  const key = await codexProviderKey(provider, { execute });
  let payload;
  try {
    const res = await fetchImpl(`${provider.base}/model/info`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!res.ok) throw new Error();
    payload = await res.json();
  } catch { throw new Error('LiteLLM model/info unavailable; cache policy was not verified'); }
  const now = opts.now ?? Date.now();
  let prices = null;
  try { prices = gatewayPrices(payload); } catch { /* Prices are optional; the policy stands alone. */ }
  const snapshot = { checkedAt: now, models: gatewayCachePolicies(payload), prices };
  const file = cacheFile(provider, opts);
  // Persist only policy and price fields, never raw model/info (which can contain secrets).
  mkdirSync(join(opts.dir || userDataDir(), 'codex-cache-policy'), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeViaTmp(tmp, file, JSON.stringify(snapshot) + '\n', { mode: 0o600 });
  return snapshot;
}

export async function refreshCodexCachePolicy(session, { fetchImpl = fetch, execute, ...opts } = {}) {
  const direct = directPolicy(session, opts);
  if (direct) return direct;
  const provider = gatewayProvider(session, opts);
  if (!provider) throw new Error('No configured LiteLLM endpoint for this session provider');
  const snapshot = await writeGatewaySnapshot(provider, { fetchImpl, execute, ...opts });
  return selectPolicy(snapshot, session, snapshot.checkedAt);
}

/** Refresh between frames. Each provider/model has its own in-flight lookup. */
export function createCodexCachePolicyReader({ refresh = refreshCodexCachePolicy, now = Date.now, ...opts } = {}) {
  const attempts = new Map();
  return function read(session) {
    const at = now();
    const policy = readCodexCachePolicy(session, { ...opts, now: at });
    if (policy || !session) return policy;
    const provider = gatewayProvider(session, opts);
    if (!provider) return null;
    const key = JSON.stringify([provider.name, provider.base, session.model]);
    const last = attempts.get(key);
    if (!last || (!last.pending && at - last.at >= CACHE_POLICY_MAX_AGE_MS)) {
      const attempt = { at, pending: true };
      attempts.set(key, attempt);
      Promise.resolve().then(() => refresh(session, { ...opts, now: at })).catch(() => {}).finally(() => { attempt.pending = false; });
    }
    return null;
  };
}
