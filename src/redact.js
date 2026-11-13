/**
 * redact — the one place that masks secrets and personal data.
 *
 * Two callers need the same answer to "does this text hold a secret": the
 * Enterprise prompt uploader (team-prompts.js, masks right before upload) and
 * every place sprag writes a user's words into a local file (the rule examples
 * in model-rules.json and ratchet-model.md, the candidates route-scan caches).
 * Claude Code's "don't ask again" has stored approved commands, passwords
 * included, in .claude/settings.local.json and pushed them to public GitHub
 * (Apiiro, 2026-11-05), so a local file is not private just because it is
 * local. permission-secrets.js reuses findSecrets for the approval lists.
 *
 * Every secret shape is one entry in SECRET_RULES, and findSecrets,
 * redactSecrets and maskPreview all read that table, so they cannot disagree.
 * Conservative on purpose: over-masking a look-alike is fine, leaving a real
 * token is not. Prose such as "token budget is 8000" must stay untouched.
 */

import { homedir } from 'node:os';

const REDACTED = '[redacted]';

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gd;
// key block cut off by the end of the text (a prompt, or an 80-char excerpt)
const PRIVATE_KEY_CUT = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z ]*PRIVATE KEY-----)[\s\S]*$/gd;

const FLAG_NAME = '--[a-z0-9-]*?(?:password|passwd|passphrase|pwd|token|secret|api-?key)';
// A value that is only a word cannot be told from prose ("--token budget"): demand a digit or symbol and 6+ chars.
const looksLikeValue = (v) => {
  const bare = v.replace(/^["']|["']$/g, '');
  return bare.length >= 6 && /[^A-Za-z]/.test(bare) && !/^[$<{-]/.test(bare);
};
const notReference = (v) => !/^["']?[$<{-]/.test(v) && v !== REDACTED;

/** @type {{kind: string, re: RegExp, group?: number, ok?: (value: string, match: RegExpExecArray) => boolean}[]} */
const SECRET_RULES = [
  { kind: 'private-key', re: PRIVATE_KEY_BLOCK },
  { kind: 'private-key', re: PRIVATE_KEY_CUT },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/gd },
  { kind: 'api-key', re: /\bsk-[A-Za-z0-9_-]{20,}/gd },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/gd },
  { kind: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/gd },
  { kind: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}/gd },
  { kind: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gd },
  { kind: 'slack-token', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/gd },
  { kind: 'slack-token', re: /\bxapp-\d-[A-Za-z0-9-]{10,}/gd },
  { kind: 'npm-token', re: /\bnpm_[A-Za-z0-9]{30,}/gd },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}/gd },
  { kind: 'google-refresh-token', re: /(?<![\w/])1\/\/[0-9A-Za-z_-]{40,}/gd },
  { kind: 'google-access-token', re: /\bya29\.[A-Za-z0-9_-]{30,}/gd },
  { kind: 'google-client-secret', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/gd },
  { kind: 'stripe-key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/gd },
  { kind: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{30,}/gd },
  { kind: 'pypi-token', re: /\bpypi-AgEI[A-Za-z0-9_-]{20,}/gd },
  { kind: 'supabase-token', re: /\bsbp_[a-f0-9]{40}\b/gd },
  { kind: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/gd },
  { kind: 'shopify-token', re: /\bshp(?:at|ss|ca|pa)_[a-f0-9]{32}\b/gd },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gd },
  // Authorization headers
  { kind: 'bearer', re: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gid, group: 1 },
  { kind: 'basic-auth', re: /\bBasic\s+([A-Za-z0-9+/]{12,}={0,2})(?![\w+/])/gd, group: 1, ok: (v) => /[0-9+/=]/.test(v) },
  // scheme://user:password@host (a $VAR or <placeholder> password is not a secret)
  { kind: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/?#'"]+:([^\s@/?#'"]+)@/gd, group: 1, ok: (v) => !/^[$<{]/.test(v) },
  // curl -u user:password
  { kind: 'basic-auth', re: /\bcurl\b[^\n|;&]*?\s(?:-u|--user)\s+['"]?[^\s:'"]+:([^\s'"]+)/gd, group: 1, ok: (v) => !/^[$<{]/.test(v) },
  // --password=value, --api-key=value, --refresh-token=value
  { kind: 'cli-flag', re: new RegExp(`(?<![\\w-])${FLAG_NAME}=("[^"\\n]*"|'[^'\\n]*'|[^\\s"']+)`, 'gid'), group: 1, ok: notReference },
  // --password value (separated by space)
  { kind: 'cli-flag', re: new RegExp(`(?<![\\w-])${FLAG_NAME}[ \\t]+("[^"\\n]*"|'[^'\\n]*'|[^\\s"']+)`, 'gid'), group: 1, ok: looksLikeValue },
  // NAME_KEY=value, PGPASSWORD=value, apiToken = "value" (not --max-tokens=1024)
  {
    kind: 'env-assignment',
    re: /(?<![\w-])[A-Za-z0-9_]*(?:KEY|TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIALS?)[A-Za-z0-9_]*\s*=(?![=>])\s*("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gid,
    group: 1,
    ok: (v) => notReference(v) && v.replace(/^["']|["']$/g, '') !== '',
  },
];

function* matchSpans(text) {
  for (const { kind, re, group = 0, ok } of SECRET_RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex += 1; continue; }
      const idx = m.indices[group];
      if (idx && (!ok || ok(m[group] ?? '', m))) yield { kind, start: idx[0], end: idx[1] };
    }
  }
}

/**
 * Where secrets sit in `text`: [{ kind, start, end }], sorted, overlaps merged
 * (the first kind found wins). The value itself is never returned, so a caller
 * can print or log the result without leaking it.
 */
export function findSecrets(text) {
  const s = String(text ?? '');
  const spans = [...matchSpans(s)].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp.start <= last.end) { last.end = Math.max(last.end, sp.end); continue; }
    merged.push({ ...sp });
  }
  return merged;
}

/** Replace obvious secrets with "[redacted]". Conservative: it may over-redact, never under-redact these shapes. */
export function redactSecrets(text) {
  const s = String(text ?? '');
  const spans = findSecrets(s);
  if (!spans.length) return s;
  let out = '';
  let at = 0;
  for (const { start, end } of spans) {
    out += s.slice(at, start) + REDACTED;
    at = end;
  }
  return out + s.slice(at);
}

/**
 * A preview that is safe to print: secrets become "[redacted]", then the text
 * is cut to `max` characters. Masking comes first so a cut never leaves half a token.
 */
export function maskPreview(text, max = Infinity) {
  const one = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, Math.max(0, max - 1))}…`;
}

/** An example excerpt for a rule file: personal data and secrets masked first, then cut to `max` characters. */
export function safeExcerpt(text, max = 80) {
  const masked = redactSecrets(redactPersonal(text)).replace(/\s+/g, ' ');
  return masked.slice(0, max);
}

// ---------------------------------------------------------------------------
// Personal data (PII) redaction. Typed markers: [redacted:email] [redacted:phone] [redacted:rrn] [redacted:card].
// Tuned for coding prompts: a miss is acceptable, a mangled code snippet is not.
// ---------------------------------------------------------------------------

const MARK_EMAIL = '[redacted:email]';
const MARK_PHONE = '[redacted:phone]';
const MARK_RRN = '[redacted:rrn]';
const MARK_CARD = '[redacted:card]';

// local@a.b.tld: dotted domain, TLD of 2+ letters. `react@18.3.1` has no letter TLD; the `git@github.com` SSH remote user is skipped in the callback.
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g;
// asset names such as logo@2x.png and a version with a prerelease tag such as react@18.3.1-beta.abc are not addresses
const looksLikeAssetOrVersion = (domain) => { const first = domain.split('.')[0]; return !/[A-Za-z]/.test(first) || /^\d+x$/i.test(first); };

const PHONE_RES = [
  // mobile: 010 / 011 / 016 / 017 / 018 / 019, separators optional
  /(?<![\w.])01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\w)/g,
  // international form of a mobile number: +82 10 ..., +82-10-..., +82 (0)10 ...
  /(?<![\w])\+82[-. ]?(?:\(0\)[-. ]?)?10[-. ]?\d{3,4}[-. ]?\d{4}(?!\w)/g,
  // landline and 070: area code only when joined by hyphens, so plain digit runs stay untouched
  /(?<![\w-])0(?:[2-6][0-9]?|70)-\d{3,4}-\d{4}(?![\w-])/g,
];

// YYMMDD-GXXXXXX, G is 1-8 (birth century and sex, foreigners 5-8); month and day are range-checked below
const RRN_RE = /(?<![\w-])(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[- ][1-8]\d{6}(?!\w)/g;

// grouped (4-4-4-4, 4-4-4-4-3, 4-6-5) or contiguous 15-16 digits
const CARD_RE = /(?<![\w-])(?:\d{4}([ -])\d{4}\1\d{4}\1\d{4}(?:\1\d{3})?|\d{4}([ -])\d{6}\2\d{5}|\d{15,16})(?![\w-])/g;
const CARD_IIN_RE = /^(?:4|5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720|3[457]|6011|65|9)/;

function luhnOk(digits) {
  let sum = 0;
  for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Network addresses, URLs and file paths. Text that leaves the machine (diagnostics, Enterprise prompt capture)
// must not map a customer's internal network or directory layout.
// ---------------------------------------------------------------------------

// Network addresses without a scheme. A network error's cause names the proxy or
// host it could not reach ("connect ECONNREFUSED 10.20.30.40:3128", "getaddrinfo
// ENOTFOUND proxy.corp.local"), and that maps a customer's internal network. None
// of it leaves the machine: addresses, hosts after a network error code, hosts in
// a certificate mismatch and hosts under a private suffix all become `<host>`.
// sprag's own public endpoints stay, so a failing team sync is still readable.
const IPV4_RE = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?![\w.])/g;
const IPV6_BRACKET_RE = /\[[0-9a-f:.]*:[0-9a-f:.]*\](?::\d{1,5})?/gi;
const IPV6_FULL_RE = /(?<![\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\w:])/gi;
const IPV6_SHORT_RE = /(?<![\w:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])/gi;
const NET_CODE_HOST_RE = /\b(getaddrinfo\s+[A-Z_]+|ENOTFOUND|EAI_AGAIN|EAI_NONAME|EAI_FAIL|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|EPIPE)(\s+)([^\s,;)'"]+)/g;
const CERT_HOST_RE = /\b(Host|DNS|IP Address|servername)(:\s*)([^\s,;)'"]+)/g;
const ATTEMPTED_RE = /(attempted address(?:es)?:\s*)([^,;)]+)/gi;
// Only a host-shaped token: oauth-budget writes "fetch failed (TypeError)", an error name to keep.
const FETCH_HOST_RE = /(fetch failed \()((?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d{1,5})?|localhost(?::\d{1,5})?)(?=[,)])/gi;
const PRIVATE_HOST_RE = /(?<![\w.-])(?:[a-z0-9-]+\.)+(?:local|localdomain|internal|intranet|corp|lan|home\.arpa|private)(?::\d{1,5})?(?![\w-])/gi;
// sprag's own public endpoints: naming them reveals nothing about the customer.
// Only sprag's own endpoints and fixed public services. A wildcard such as *.supabase.co or github.com
// would let a customer's own project ref or `github.com/<org>/<repo>` through.
const PUBLIC_HOST_RE = /^(?:hiycfjwswtkixyoqkznm\.supabase\.co|(?:www\.)?sprag\.io|registry\.npmjs\.org|(?:www\.)?npmjs\.com|(?:api|docs|www)\.anthropic\.com|(?:docs\.)?claude\.com)(?::\d{1,5})?$/i;
const maskHost = (h) => (PUBLIC_HOST_RE.test(h) ? h : '<host>');

/** Every network address in `s` as `<host>`, sprag's public endpoints kept. */
export function maskNetwork(s) {
  return String(s ?? '')
    .replace(NET_CODE_HOST_RE, (_, code, sp, h) => code + sp + maskHost(h.replace(/[.:]+$/, '')))
    .replace(CERT_HOST_RE, (_, k, sep, h) => k + sep + maskHost(h.replace(/\.$/, '')))
    .replace(ATTEMPTED_RE, (_, lead) => `${lead}<host>`)
    .replace(FETCH_HOST_RE, (_, lead, h) => lead + maskHost(h))
    .replace(PRIVATE_HOST_RE, '<host>')
    .replace(IPV6_BRACKET_RE, '<host>')
    .replace(IPV4_RE, '<host>')
    .replace(IPV6_FULL_RE, '<host>')
    .replace(IPV6_SHORT_RE, (m) => (m === '::' ? m : '<host>'));
}

/** An absolute path starts under one of these: an API path such as `/rest/v1/rpc` names no directory and stays. */
export const FS_ROOT_RE = /^\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes|mnt|media|srv|etc|Library|Applications|System|nix|snap|workspace|workspaces|data|app)(?:\/|$)/;

// A path after the start, whitespace, a quote, a bracket, `=` or `,`. `<url>/x` and `https://h/x` are not
// matched (the char before the slash is `>` or `:`), so a URL is left to maskUrls.
const ABS_PATH_RE = /(^|[\s'"`(\[{=,])((?:~|[A-Za-z]:)?[\\/][^\s'"`():,<>]+)/g;
const TRAILING_PUNCT_RE = /[.;!?]+$/;

/**
 * Home directory -> `~`, then every absolute filesystem path (POSIX under a known root, `~/...`,
 * Windows `C:\...`) -> `<path>`. URLs and API-looking paths stay.
 */
export function redactPaths(text, { home } = {}) {
  let s = String(text ?? '');
  let h = home;
  if (h === undefined) { try { h = homedir(); } catch { h = ''; } }
  if (h && h.length > 1) {
    const base = h.replace(/[\\/]+$/, '');
    if (base.length > 1) s = s.replace(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), '~');
  }
  return s.replace(ABS_PATH_RE, (m, lead, p) => {
    const root = p.startsWith('~') || /^[A-Za-z]:/.test(p);
    if (!root && !FS_ROOT_RE.test(p)) return m;
    const tail = TRAILING_PUNCT_RE.exec(p)?.[0] ?? '';
    return `${lead}<path>${tail}`;
  });
}

const ANY_URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#'"`<>]*)[^\s'"`<>]*/gi;

/** Every scheme://... URL whose host is not sprag's, Anthropic's, GitHub's, npm's or Supabase's -> `<url>`. */
export function maskUrls(text) {
  return String(text ?? '').replace(ANY_URL_RE, (m, scheme, authority) => {
    const tail = /[.,;:!?)\]}]+$/.exec(m)?.[0] ?? '';
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    if (scheme.toLowerCase() !== 'file' && host && PUBLIC_HOST_RE.test(host.replace(/[.,;:!?)\]}]+$/, ''))) return m;
    return `<url>${tail}`;
  });
}

/**
 * Text that may leave the machine in an Enterprise prompt upload: secrets, personal data, URLs, network
 * addresses and file paths masked, in that order. Pattern matching only, not a guarantee.
 */
export function redactUpload(text) {
  return redactPaths(maskNetwork(maskUrls(redactPersonal(redactSecrets(text)))));
}

/** Mask email addresses, Korean phone numbers, resident registration numbers and card numbers with typed markers. */
export function redactPersonal(text) {
  let s = String(text ?? '');
  s = s.replace(EMAIL_RE, (m, domain) => (/^git@/i.test(m) || looksLikeAssetOrVersion(domain) ? m : MARK_EMAIL));
  s = s.replace(CARD_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnOk(digits)) return m;
    if (/^\d+$/.test(m) && !CARD_IIN_RE.test(digits)) return m; // contiguous digits need a real issuer prefix
    return MARK_CARD;
  });
  s = s.replace(RRN_RE, MARK_RRN);
  for (const re of PHONE_RES) s = s.replace(re, MARK_PHONE);
  return s;
}
