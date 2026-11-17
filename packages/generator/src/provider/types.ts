/**
 * Provider-agnostic model interface: text + image in, text out, token usage back.
 * Implementations: openai.ts (live), mock.ts (tests).
 */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; dataBase64: string; detail?: 'low' | 'high' | 'auto' };

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CompletionRequest {
  /** System / developer instructions. Kept identical across calls so providers can cache the prefix. */
  system: string;
  messages: Message[];
  /** Ask for JSON conforming to this schema (strict JSON Schema subset: all properties required, no extras). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  /** For logs only. */
  purpose?: string;
}

export interface Usage {
  inputTokens: number;
  /** Part of inputTokens served from the provider's prompt cache. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Part of outputTokens spent on hidden reasoning. */
  reasoningTokens: number;
}

export interface CompletionResponse {
  text: string;
  usage: Usage;
  /** Model that actually answered (as reported by the provider). */
  model: string;
  durationMs: number;
  /** Set when the output was cut short (e.g. "max_output_tokens"). */
  incomplete?: string;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Estimated USD cost of a call's usage with this provider's model. */
  cost(usage: Usage): number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
