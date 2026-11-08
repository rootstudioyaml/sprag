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
