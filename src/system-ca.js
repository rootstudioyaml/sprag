/**
 * Trust the operating system's certificate store for Sprag's own requests.
 *
 * Node verifies TLS against the Mozilla bundle compiled into it, plus
 * NODE_EXTRA_CA_CERTS. A machine behind a corporate proxy that re-signs
 * traffic with a root installed only in the macOS Keychain, the Windows
 * store or /etc/ssl fails every fetch with UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
 * and the update check, preset sync and team sync go quiet.
 *
 * Node 22.19 and 24.5 carry both tls.getCACertificates('system') and
 * tls.setDefaultCACertificates(). With both present, the default
 * list becomes its current entries (bundled, extra, anything set before) plus
 * the system store, so nothing that verified before stops verifying. Older
 * Node has neither and keeps its old behaviour.
 *
 * Reading the system store costs about 30ms on macOS (a Keychain query), so
 * this runs once, right before the first request, and never on the
 * statusline render path. Each fetch site calls trustSystemCA() first.
 *
 * SPRAG_SYSTEM_CA=0 turns it off. NODE_USE_SYSTEM_CA=1 or --use-system-ca
 * means Node already merged the store, so nothing is read again.
 */
import { createRequire } from 'node:module';
import { envVar } from './env.js';
import { debug } from './debug.js';

// node:tls loads on first use: the update check imports this module on the
// statusline path, which never makes a request.
const require = createRequire(import.meta.url);

/** True when Node itself was told to load the system store at startup. */
export function nodeLoadsSystemCA({ env = process.env, execArgv = process.execArgv } = {}) {
  if (env.NODE_USE_SYSTEM_CA === '1') return true;
  if (execArgv.includes('--use-system-ca')) return true;
  return /(^|\s)--use-system-ca(\s|$)/.test(env.NODE_OPTIONS || '');
}

const key = (pem) => String(pem).replace(/\r\n/g, '\n').trim();

/**
 * Merge the system store into the default CA list once.
 *
 * Returns what happened, for tests:
 *   'applied'     the default list now includes system roots it lacked
 *   'unchanged'   every system root was already in the default list
 *   'off'         SPRAG_SYSTEM_CA=0
 *   'native'      Node loaded the store itself (NODE_USE_SYSTEM_CA, --use-system-ca)
 *   'unsupported' this Node lacks getCACertificates or setDefaultCACertificates
 *   'error'       reading or setting threw; the default list is left as it was
 */
export function applySystemCA({ tls = require('node:tls'), env = process.env, execArgv = process.execArgv } = {}) {
  if (envVar('SYSTEM_CA', env) === '0') return 'off';
  if (nodeLoadsSystemCA({ env, execArgv })) return 'native';
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return 'unsupported';
  }
  try {
    const current = tls.getCACertificates('default');
    const seen = new Set(current.map(key));
    const added = tls.getCACertificates('system').filter((pem) => {
      const k = key(pem);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (added.length === 0) return 'unchanged';
    tls.setDefaultCACertificates([...current, ...added]);
    return 'applied';
  } catch (e) {
    debug('system-ca', e);
    return 'error';
  }
}

let outcome = null;

/** applySystemCA() for the process, at most once; later calls return the first outcome. */
export function trustSystemCA(opts) {
  if (outcome === null) outcome = applySystemCA(opts);
  return outcome;
}
