/**
 * OpenAI provider over the Responses API (POST /v1/responses), streamed so that long reasoning runs are not cut off by
 * HTTP header timeouts. Only the final `response.completed` / `response.incomplete` event is used.
 *
 * The API key is read from the environment (or the repo's git-ignored .env, see env.ts) and only ever placed in the
 * Authorization header. It is never logged or written anywhere.
 */

import { costOf, priceFor } from './pricing.ts';
import type { CompletionRequest, CompletionResponse, ContentPart, ModelProvider, Usage } from './types.ts';

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Per-request wall-clock limit. Default 15 min. */
  timeoutMs?: number;
  /** Retries for 429 / 5xx / network errors. Default 2. */
  retries?: number;
}

type OpenAIContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: string };

function toContent(parts: string | ContentPart[]): string | OpenAIContent[] {
  if (typeof parts === 'string') return parts;
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'input_text', text: p.text }
      : { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.dataBase64}`, detail: p.detail ?? 'auto' },
  );
}

interface ResponsesUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

interface ResponsesObject {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  usage?: ResponsesUsage;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: OpenAIOptions) {
    if (!opts.apiKey) throw new Error('OpenAIProvider: missing API key');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
    this.timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    this.retries = opts.retries ?? 2;
  }

  cost(usage: Usage): number {
    return costOf(priceFor(this.model), usage);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: req.system,
      input: req.messages.map((m) => ({ role: m.role, content: toContent(m.content) })),
      store: false,
      stream: true,
    };
    if (req.maxOutputTokens) body.max_output_tokens = req.maxOutputTokens;
    if (req.reasoningEffort) body.reasoning = { effort: req.reasoningEffort };
    if (req.jsonSchema) {
      body.text = { format: { type: 'json_schema', name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      try {
        return await this.once(body);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof RetryableError)) throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async once(body: Record<string, unknown>): Promise<CompletionResponse> {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new RetryableError(`network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 1000);
      const msg = `OpenAI ${res.status}: ${text}`;
      if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
      throw new Error(msg);
    }
    const final = await readFinalEvent(res);
    const r = final.response;
    if (final.type === 'response.failed' || final.type === 'error') {
      throw new RetryableError(`OpenAI response failed: ${r?.error?.message ?? JSON.stringify(final.raw).slice(0, 500)}`);
    }
    if (!r) throw new RetryableError('OpenAI stream ended without a final response');
    const text = (r.output ?? [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .map((c) => (c.type === 'output_text' ? (c.text ?? '') : c.type === 'refusal' ? `[refusal] ${c.refusal ?? ''}` : ''))
      .join('');
    const u = r.usage ?? {};
    const out: CompletionResponse = {
      text,
      model: r.model ?? this.model,
      durationMs: performance.now() - t0,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      },
    };
    if (r.status === 'incomplete') out.incomplete = r.incomplete_details?.reason ?? 'incomplete';
    return out;
  }
}

class RetryableError extends Error {}

/** Reads the SSE stream and returns the terminal event. */
async function readFinalEvent(res: Response): Promise<{ type: string; response?: ResponsesObject; raw: unknown }> {
  if (!res.body) throw new RetryableError('empty body');
  const decoder = new TextDecoder();
  let buf = '';
  let final: { type: string; response?: ResponsesObject; raw: unknown } | null = null;
  const handle = (block: string) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let ev: { type?: string; response?: ResponsesObject };
    try {
      ev = JSON.parse(data) as { type?: string; response?: ResponsesObject };
    } catch {
      return;
    }
    const t = ev.type ?? '';
    if (t === 'response.completed' || t === 'response.incomplete' || t === 'response.failed' || t === 'error') {
      final = { type: t, ...(ev.response ? { response: ev.response } : {}), raw: ev };
    }
  };
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        handle(buf.slice(0, i).replace(/\r/g, ''));
        buf = buf.slice(i + 2);
      }
    }
  } catch (e) {
    throw new RetryableError(`stream error: ${(e as Error).message}`);
  }
  if (buf.trim()) handle(buf.replace(/\r/g, ''));
  if (!final) throw new RetryableError('stream ended without a terminal event');
  return final;
}
