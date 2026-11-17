import { costOf, type Price } from './pricing.ts';
import type { CompletionRequest, CompletionResponse, ModelProvider, Usage } from './types.ts';

export type MockReply = string | ((req: CompletionRequest, callIndex: number) => string);

/**
 * Scripted provider for tests: replies are returned in order per purpose ("generate", "judge", ...), and every request
 * is recorded. Usage is a fixed, fake count so cost accounting can be checked.
 */
export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  readonly model: string;
  readonly requests: CompletionRequest[] = [];
  private readonly queues: Map<string, MockReply[]>;
  private readonly price: Price;
  readonly usagePerCall: Usage;

  constructor(
    replies: Record<string, MockReply[]>,
    opts: { model?: string; price?: Price; usagePerCall?: Usage } = {},
  ) {
    this.queues = new Map(Object.entries(replies).map(([k, v]) => [k, [...v]]));
    this.model = opts.model ?? 'mock-model';
    this.price = opts.price ?? { input: 1, cachedInput: 0.1, output: 2 };
    this.usagePerCall = opts.usagePerCall ?? { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 100 };
  }

  cost(usage: Usage): number {
    return costOf(this.price, usage);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const index = this.requests.length;
    this.requests.push(req);
    const purpose = req.purpose ?? 'default';
    const q = this.queues.get(purpose);
    const next = q?.shift();
    if (next === undefined) throw new Error(`MockProvider: no reply queued for purpose "${purpose}"`);
    const text = typeof next === 'function' ? next(req, index) : next;
    return { text, usage: { ...this.usagePerCall }, model: this.model, durationMs: 1 };
  }
}
