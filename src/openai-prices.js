// OpenAI list prices for Codex calls that go straight to OpenAI (ChatGPT/OpenAI login).
// Source: https://developers.openai.com/api/docs/pricing , "Standard" tier, short-context
// rates, checked 2026-10-01. Long-context surcharges are not modeled, so requests past the
// long-context threshold are under-priced. Calls through a LiteLLM gateway never use this table.
export const OPENAI_PRICES_CHECKED_AT = Date.parse('2026-10-01T00:00:00Z');

// Per-1M-token numbers as listed on the page; null where the page shows "-".
const PER_MILLION = {
  'gpt-6-astra': [10, 1, 12.5, 50],
  'gpt-6.1-sol': [2, 0.1, 2.5, 10],
  'gpt-6-luna': [0.1, 0.01, 0.125, 0.5],
  'gpt-6-sol': [2, 0.2, 2.5, 10],
  'gpt-5.6-sol': [4, 0.4, 5, 20],
  'gpt-5.6-terra': [2, 0.2, 2.5, 12],
  'gpt-5.6-luna': [0.2, 0.02, 0.25, 1.2],
  'gpt-5.5': [5, 0.5, null, 30],
  'gpt-5.5-pro': [30, null, null, 180],
  'gpt-5.4': [2.5, 0.25, null, 15],
  'gpt-5.4-pro': [30, null, null, 180],
  'gpt-5.4-mini': [0.75, 0.075, null, 4.5],
  'gpt-5.4-nano': [0.2, 0.02, null, 1.25],
  'gpt-5.2': [1.75, 0.175, null, 14],
  'gpt-5.2-pro': [21, null, null, 168],
  'gpt-5.1': [1.25, 0.125, null, 10],
  'gpt-5': [1.25, 0.125, null, 10],
};

// Parse "<n>e-6" instead of dividing so 0.1 per 1M is exactly 1e-7, without float noise.
const perToken = (n) => (n === null ? null : Number(`${n}e-6`));

/** model -> per-token USD `{ input, cacheRead, cacheWrite, output }`. */
export const OPENAI_LIST_PRICES = Object.fromEntries(Object.entries(PER_MILLION).map(([model, [input, cacheRead, cacheWrite, output]]) =>
  [model, { input: perToken(input), cacheRead: perToken(cacheRead), cacheWrite: perToken(cacheWrite), output: perToken(output) }]));
