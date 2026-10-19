/* Preset bundle signing for the /ops console (browser copy).
 *
 * canonicalJson() and signingInput() must produce the same bytes as
 * src/preset-sign.js in the CLI: test/preset-sign.test.js signs with this file
 * and verifies with the CLI copy. Edit both together.
 *
 * The private key never leaves the browser except as the one-time backup file
 * the superuser downloads. It lives in IndexedDB ("sprag-presets" / "keys").
 */
(function(root){
  'use strict';

  function canonicalJson(value){
    if(value === null || typeof value !== 'object'){
      if(typeof value === 'number' && !isFinite(value)) return 'null';
      return value === undefined ? 'null' : JSON.stringify(value);
    }
    if(Array.isArray(value)){
      return '[' + value.map(function(v){ return v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v); }).join(',') + ']';
    }
    var keys = Object.keys(value).filter(function(k){ return value[k] !== undefined && typeof value[k] !== 'function'; }).sort();
    return '{' + keys.map(function(k){ return JSON.stringify(k) + ':' + canonicalJson(value[k]); }).join(',') + '}';
  }

  function nz(v){ return v === undefined ? null : v; }
  function signingInput(b){
    b = b || {};
    return canonicalJson({ format: nz(b.format), version: nz(b.version), min_cli: nz(b.min_cli),
      ratchet_rules: nz(b.ratchet_rules), model_rules: nz(b.model_rules), agents: nz(b.agents) });
  }

  function subtle(){
    var c = root.crypto;
    if(!c || !c.subtle) throw new Error('WebCrypto is not available here (needs https or localhost)');
    return c.subtle;
  }
  function hex(buf){ return Array.prototype.map.call(new Uint8Array(buf), function(x){ return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function b64url(buf){
    var s = '', a = new Uint8Array(buf);
    for(var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function utf8(s){ return new TextEncoder().encode(s); }

  function publicJwk(jwk){ return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }; }
  async function fingerprint(jwk){
    return hex(await subtle().digest('SHA-256', utf8(canonicalJson(publicJwk(jwk))))).slice(0, 16);
  }
  /* Same id scheme as the CLI: fix-<sha1(ko)[0:6]> */
  async function presetId(ko){
    return 'fix-' + hex(await subtle().digest('SHA-1', utf8(String(ko || '').trim()))).slice(0, 6);
  }

  var ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  async function generate(){
    var pair = await subtle().generateKey(ALG, true, ['sign', 'verify']);
    var priv = await subtle().exportKey('jwk', pair.privateKey);
    var pub = await subtle().exportKey('jwk', pair.publicKey);
    return { privateJwk: priv, publicJwk: publicJwk(pub), kid: await fingerprint(pub), createdAt: new Date().toISOString() };
  }
  async function importBackup(obj){
    if(!obj || !obj.privateJwk || obj.privateJwk.kty !== 'EC' || obj.privateJwk.crv !== 'P-256' || !obj.privateJwk.d) throw new Error('not a Sprag preset signing key backup');
    await subtle().importKey('jwk', obj.privateJwk, ALG, false, ['sign']);
    var pub = publicJwk(obj.privateJwk);
    return { privateJwk: obj.privateJwk, publicJwk: pub, kid: await fingerprint(pub), createdAt: obj.createdAt || new Date().toISOString() };
  }
  async function sign(bundle, keyRec){
    var key = await subtle().importKey('jwk', keyRec.privateJwk, ALG, false, ['sign']);
    var sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput(bundle)));
    return { alg: 'ES256', kid: keyRec.kid, value: b64url(sig) };
  }
  async function verify(bundle, publicJwkIn){
    var key = await subtle().importKey('jwk', publicJwk(publicJwkIn), ALG, false, ['verify']);
    var s = String(bundle.sig.value).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s + '==='.slice((s.length + 3) % 4)), a = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, a, utf8(signingInput(bundle)));
  }

  /* IndexedDB: one record under "signing" */
  function db(){
    return new Promise(function(res, rej){
      if(!root.indexedDB) return rej(new Error('IndexedDB is not available'));
      var r = root.indexedDB.open('sprag-presets', 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore('keys'); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
  }
  async function tx(mode, fn){
    var d = await db();
    return new Promise(function(res, rej){
      var t = d.transaction('keys', mode), st = t.objectStore('keys'), out;
      var q = fn(st); if(q) q.onsuccess = function(){ out = q.result; };
      t.oncomplete = function(){ d.close(); res(out); };
      t.onerror = function(){ d.close(); rej(t.error); };
    });
  }
  function loadKey(){ return tx('readonly', function(st){ return st.get('signing'); }).then(function(v){ return v || null; }); }
  function saveKey(rec){ return tx('readwrite', function(st){ return st.put(rec, 'signing'); }); }

  root.PresetSign = { canonicalJson: canonicalJson, signingInput: signingInput, fingerprint: fingerprint, presetId: presetId,
    generate: generate, importBackup: importBackup, sign: sign, verify: verify, loadKey: loadKey, saveKey: saveKey };
})(typeof window !== 'undefined' ? window : globalThis);
