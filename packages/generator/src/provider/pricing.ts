import type { Usage } from './types.ts';

/** USD per 1M tokens. */
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
}

/**
 * OpenAI standard-tier list prices, from https://developers.openai.com/api/docs/models (checked 2026-11-16).
 * Cached-input prices for terra/luna were not on the page; assumed 10% of input like the others.
 * Prompts above 272K input tokens are billed higher; the generator never gets close.
 */
export const OPENAI_PRICES: Record<string, Price> = {
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cachedInput: 0.1, output: 10 },
  'gpt-6.1-terra': { input: 1, cachedInput: 0.1, output: 5 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

/** Unknown models are priced like the most expensive known one, so budgets err on the safe side. */
const FALLBACK: Price = { input: 10, cachedInput: 1, output: 50 };

export function priceFor(model: string): Price {
  return OPENAI_PRICES[model] ?? OPENAI_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')] ?? FALLBACK;
}

export function costOf(price: Price, u: Usage): number {
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (uncached * price.input + u.cachedInputTokens * price.cachedInput + u.outputTokens * price.output) / 1e6;
}
