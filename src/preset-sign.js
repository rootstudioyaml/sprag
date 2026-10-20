/**
 * preset-sign — the signature on a centrally published preset bundle.
 *
 * The superuser edits presets in the /ops console and signs each published
 * bundle in the browser with an ECDSA P-256 key (WebCrypto, SHA-256). The CLI
 * applies a remote bundle only when that signature verifies against a public key
 * listed here, so a compromised server or a man in the middle cannot push
 * ratchet text or agent prompts into every session: the worst it can do is
 * withhold updates, and then the presets bundled in the npm package are used.
 *
 * The signing input is canonical JSON of the six bundle fields that carry
 * meaning (format, version, min_cli, ratchet_rules, model_rules, agents): keys
 * sorted recursively, no whitespace. site/assets/preset-sign.js is the browser
 * copy of canonicalJson(); test/preset-sign.test.js signs with that copy and
 * verifies with this one, so the two cannot drift apart.
 *
 * Verification here is synchronous (node:crypto with IEEE P1363 signatures,
 * the encoding WebCrypto produces), because the presets are read on the
 * session-start path by functions that are synchronous today. It takes well
 * under a millisecond.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Public keys allowed to sign preset bundles: [{ kid, jwk }].
 *
 * EMPTY until the superuser creates the signing key in the /ops console
 * (sprag.io/ops/#presets → Signing key → Create). After that, paste the public
 * JWK shown there as one entry, with `kid` set to the fingerprint the console
 * shows next to it, e.g.
 *
 *   { kid: '0123456789abcdef', jwk: { kty: 'EC', crv: 'P-256', x: '…', y: '…' } }
 *
 * While this list is empty every remote bundle is rejected and the bundled
 * presets are used; `sprag presets status` says so. Rotating the key means
 * adding the new entry, releasing, then publishing with the new key; remove the
 * old entry one release later.
 */
export const PRESET_SIGNING_KEYS = [
  // Created 2026-10-20 for sprag.io/ops; the private half lives in the superuser's browser and its backup file.
  { kid: '8bc624f874f5620a', jwk: { kty: 'EC', crv: 'P-256', x: 'Lx3x--sWgDZ2_7jWxO3_ks86MtihDNRRbckITpR5bLc', y: 'L2D7puHKmZhQRh7mWjGYsmIX_UrPBYjKt3nH8B51Bhg' } },
];

export const PRESET_BUNDLE_FORMAT = 1;
export const PRESET_MAX_BYTES = 200 * 1024;

/** JSON with object keys sorted at every depth and no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return value === undefined ? 'null' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== 'function').sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/** The exact bytes that are signed. Fields outside the six are not covered. */
export function signingInput(bundle) {
  const b = bundle || {};
  return canonicalJson({
    format: b.format ?? null,
    version: b.version ?? null,
    min_cli: b.min_cli ?? null,
    ratchet_rules: b.ratchet_rules ?? null,
    model_rules: b.model_rules ?? null,
    agents: b.agents ?? null,
  });
}

/** sha256 of the canonical public JWK (kty, crv, x, y only), first 16 hex. */
export function jwkFingerprint(jwk) {
  const pub = { crv: jwk?.crv, kty: jwk?.kty, x: jwk?.x, y: jwk?.y };
  return createHash('sha256').update(canonicalJson(pub)).digest('hex').slice(0, 16);
}

function b64urlDecode(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null;
  return Buffer.from(s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Check a bundle's signature. Returns { ok: true, kid } or
 * { ok: false, reason } where reason is one of
 *   'unsigned'     the bundle carries no signature (version 1 is seeded unsigned)
 *   'no-keys'      this CLI has no signing key yet (PRESET_SIGNING_KEYS is empty)
 *   'unknown-kid'  signed by a key this CLI does not list
 *   'bad-sig'      the signature does not match the content
 */
export function verifyBundleSignature(bundle, keys = PRESET_SIGNING_KEYS) {
  const sig = bundle && bundle.sig;
  if (!sig || typeof sig !== 'object' || !sig.value) return { ok: false, reason: 'unsigned' };
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'no-keys' };
  if (sig.alg !== 'ES256') return { ok: false, reason: 'bad-sig' };
  const entry = keys.find((k) => k && k.kid === sig.kid);
  if (!entry) return { ok: false, reason: 'unknown-kid' };
  const raw = b64urlDecode(sig.value);
  if (!raw || raw.length !== 64) return { ok: false, reason: 'bad-sig' };
  try {
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: entry.jwk.x, y: entry.jwk.y }, format: 'jwk' });
    const ok = cryptoVerify('sha256', Buffer.from(signingInput(bundle), 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, raw);
    return ok ? { ok: true, kid: entry.kid } : { ok: false, reason: 'bad-sig' };
  } catch {
    return { ok: false, reason: 'bad-sig' };
  }
}
