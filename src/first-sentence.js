/**
 * The first sentence of a text, shared by the Codex seed offer (seed-rules.js)
 * and the Codex delegation hints (codex/delegation.js). It has no imports so
 * the per-prompt Codex hook can use it without loading the seed module.
 *
 * Codex keeps about 2,000 tokens of a hook's context and drops a part that does
 * not fit whole, so listing every ratchet rule in full pushed the whole offer
 * out. The offer only has to say what each rule is about; accepting writes the
 * full text. A sentence ends at "다." or a full stop followed by whitespace
 * (not an ellipsis), or at "다" before a newline. Without one, a text over 140
 * characters is cut at the last space before 140 and marked with "…".
 */
export const OFFER_CUT = 140;
export function firstSentence(text) {
  const t = String(text ?? '').trim();
  const m = /(?<!\.)\.(?=\s)|다(?=\n)/.exec(t);
  if (m && m.index + 1 < t.length) return t.slice(0, m.index + m[0].length).trim();
  if (t.length <= OFFER_CUT) return t;
  const head = t.slice(0, OFFER_CUT);
  const sp = head.lastIndexOf(' ');
  return `${(sp > 0 ? head.slice(0, sp) : head).trimEnd()}…`;
}
