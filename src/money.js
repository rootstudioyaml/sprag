/**
 * A signed dollar amount for text output: "-$0.12" for a loss, "$0.12" for a
 * saving. Routing savings are recorded signed, and "~$-0.12" misreads as a
 * formatting glitch rather than a loss.
 */
export function signedUsd(usd, digits = 2) {
  const fixed = Math.abs(usd).toFixed(digits);
  return usd < 0 && Number(fixed) !== 0 ? `-$${fixed}` : `$${fixed}`;
}
