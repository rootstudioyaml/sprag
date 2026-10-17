// Minimum retention windows, not exact expiration timestamps. Gateway aliases
// require a resolved deployment before applying a provider's documented policy.
// https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime
export function codexCachePolicy(model) {
  return /^gpt-(?:5\.6(?:-(?:sol|terra|luna))?|6-(?:astra|sol|luna))(?:-\d{4}-\d{2}-\d{2})?$/i.test(model || '') ? 1800 : null;
}

export function parseCodexCacheTtl(value) {
  if (value === 'auto' || value === 'off') return value;
  const match = /^(\d+)(m|h)$/.exec(value || '');
  const seconds = match ? Number(match[1]) * (match[2] === 'h' ? 3600 : 60) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 86400) {
    throw new Error('Cache TTL expects auto, off, or 1m through 24h (for example 30m). This changes the display estimate, not provider retention.');
  }
  return seconds;
}

export function codexCacheTimer(session, { now = Date.now(), ttl = 'auto', policy } = {}) {
  if (ttl === 'off') return null;
  const activity = session?.cacheActivity;
  const at = activity?.at ? new Date(activity.at).getTime() : NaN;
  const sameModel = activity?.model === session?.model;
  if (!Number.isFinite(at) || at > now || !sameModel || activity?.provider !== session?.provider) {
    return { text: 'Cache timer n/a', tone: 90, source: 'unavailable' };
  }
  const elapsed = Math.floor((now - at) / 1000);
  const configured = Number.isSafeInteger(ttl) && ttl >= 60 && ttl <= 86400;
  const resolved = policy && policy.requestedModel === session.model && policy.provider === session.provider &&
    ['OpenAI', 'Bedrock'].includes(policy.backend) && policy.seconds === codexCachePolicy(policy.model) &&
    Number.isFinite(policy.checkedAt) && now >= policy.checkedAt && now - policy.checkedAt < 300000;
  const direct = policy === undefined && session.provider === 'openai' && codexCachePolicy(session.model);
  const seconds = configured ? ttl : resolved ? policy.seconds : direct;
  if (!seconds) return { text: `Cache age ${clock(elapsed)} / TTL unknown`, tone: 90, source: 'age', elapsed };
  const remaining = Math.max(0, seconds - elapsed);
  const source = configured ? 'configured estimate' : `${resolved ? policy.backend : 'OpenAI'} 30m`;
  const text = remaining > 0 ? `Cache ${clock(remaining)} (${source})` : `Cache window elapsed (${source}; expiry unknown)`;
  return { text, tone: remaining <= 0 ? 90 : remaining <= 60 ? 31 : remaining <= 300 ? 33 : 32,
    source: configured ? 'configured' : 'provider-policy', seconds, elapsed, remaining };
}

function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
