// Key order for presets/*.json written from a server bundle (scripts/presets-pull.mjs).
// jsonb reorders object keys, so v is rebuilt in the key order of t, the committed value, at
// every depth. An array item is matched to the item of t with the same id or name, else the
// one at its index, else the first; keys t lacks go last. Values are never changed.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ident = (v) => (isObj(v) ? v.id ?? v.name : undefined);
export function shapeLike(v, t) {
  if (Array.isArray(v)) {
    const ts = Array.isArray(t) ? t : [];
    return v.map((x, i) => shapeLike(x, ts.find((y) => ident(y) !== undefined && ident(y) === ident(x)) ?? ts[i] ?? ts[0]));
  }
  if (!isObj(v)) return v;
  const tk = isObj(t) ? Object.keys(t) : [];
  const keys = [...tk.filter((k) => k in v), ...Object.keys(v).filter((k) => !tk.includes(k))];
  return Object.fromEntries(keys.map((k) => [k, shapeLike(v[k], isObj(t) ? t[k] : undefined)]));
}
