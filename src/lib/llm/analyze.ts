import type { z } from 'zod';
import { LLM_RUNTIME } from '../config';
import { buildRetryMessage, buildReviewMessage, buildUserMessage, REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../prompt';
import {
  LlmChunkOutputSchema,
  LlmReviewOutputSchema,
  type AnalyzeRequest,
  type ChunkResult,
  type LlmChunkOutput,
  type LlmReviewOutput,
  type ReviewRequest,
  type ReviewResult,
} from '../schema';
import { ProviderError, type ChatMessage, type LlmProvider } from './providers';

export interface AnalyzeOptions {
  timeoutMs?: number;
  maxValidationRetries?: number;
  maxNetworkRetries?: number;
  /** Rate-limit (429) retries are counted separately; free tiers hit them often. */
  maxRateLimitRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Metadata-only event hook (never receives document text or keys). */
  onEvent?: (e: { chunkId: string; type: string; attempt: number; detail?: string }) => void;
  /** Collects raw model outputs for evaluation reproducibility (eval runner only). */
  onRawOutput?: (chunkId: string, attempt: number, raw: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Parse a model response into JSON. Only removes a surrounding markdown code
 * fence — never edits content, never fills in missing fields.
 */
export function parseModelJson(raw: string): unknown {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1]!.trim();
  return JSON.parse(t);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateWith<T>(schema: z.ZodType<T>, raw: string): Validated<T> {
  let parsed: unknown;
  try {
    parsed = parseModelJson(raw);
  } catch (e) {
    return { ok: false, error: `Geçersiz JSON: ${(e as Error).message}` };
  }
  const r = schema.safeParse(parsed);
  if (r.success) return { ok: true, value: r.data };
  const msg = r.error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, error: msg };
}

export function validateModelOutput(raw: string): Validated<LlmChunkOutput> {
  return validateWith(LlmChunkOutputSchema, raw);
}

export type RunOutcome<T> =
  | { ok: true; attempts: number; value: T; provider: string; model: string }
  | { ok: false; attempts: number; errorCode: 'validation_failed' | 'provider_error' | 'timeout' | 'rate_limited' | 'refused'; errorMessage: string };

/**
 * Calls the provider until the output passes `schema`, with bounded retries:
 * - schema/JSON failures (incl. provider "json_validate_failed"): ≤ maxValidationRetries,
 *   each retry tells the model what was wrong — output is never repaired by us;
 * - 429 rate limits: ≤ maxRateLimitRetries, honouring the provider's wait hint;
 * - timeouts / 5xx: ≤ maxNetworkRetries with exponential backoff.
 */
export async function runValidated<T>(
  provider: LlmProvider,
  initial: ChatMessage[],
  schema: z.ZodType<T>,
  id: string,
  opts: AnalyzeOptions = {},
): Promise<RunOutcome<T>> {
  const timeoutMs = opts.timeoutMs ?? LLM_RUNTIME.requestTimeoutMs;
  const maxVal = opts.maxValidationRetries ?? LLM_RUNTIME.maxValidationRetries;
  const maxNet = opts.maxNetworkRetries ?? LLM_RUNTIME.maxNetworkRetries;
  const maxRate = opts.maxRateLimitRetries ?? 5;
  const sleep = opts.sleep ?? defaultSleep;
  const messages = [...initial];
  let attempts = 0;
  let validationFailures = 0;
  let networkFailures = 0;
  let rateLimitRetries = 0;

  for (;;) {
    attempts++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      opts.onEvent?.({ chunkId: id, type: 'request', attempt: attempts });
      const res = await provider.complete(messages, { signal: ac.signal, json: true });
      clearTimeout(timer);
      opts.onRawOutput?.(id, attempts, res.content);
      const v = validateWith(schema, res.content);
      if (v.ok) {
        opts.onEvent?.({ chunkId: id, type: 'valid', attempt: attempts, detail: res.provider });
        return { ok: true, attempts, value: v.value, provider: res.provider ?? provider.name, model: res.model ?? provider.model };
      }
      validationFailures++;
      opts.onEvent?.({ chunkId: id, type: 'invalid', attempt: attempts, detail: v.error.slice(0, 300) });
      if (validationFailures > maxVal) {
        return { ok: false, attempts, errorCode: 'validation_failed', errorMessage: `Model çıktısı şema doğrulamasından geçmedi: ${v.error}`.slice(0, 500) };
      }
      messages.push({ role: 'assistant', content: res.content.slice(0, 12000) });
      messages.push({ role: 'user', content: buildRetryMessage(v.error) });
    } catch (e) {
      clearTimeout(timer);
      const pe = e instanceof ProviderError ? e : new ProviderError('provider_error', (e as Error).message);
      opts.onEvent?.({ chunkId: id, type: `error:${pe.code}`, attempt: attempts, detail: pe.message.slice(0, 300) });
      if (pe.code === 'invalid_output') {
        validationFailures++;
        if (validationFailures > maxVal) return { ok: false, attempts, errorCode: 'validation_failed', errorMessage: pe.message.slice(0, 500) };
        if (!messages.at(-1)?.content.startsWith('Your previous answer')) {
          messages.push({ role: 'user', content: buildRetryMessage('The output was not valid JSON. Escape double quotes inside strings and return one JSON object only.') });
        }
        continue;
      }
      if (pe.code === 'rate_limited') {
        rateLimitRetries++;
        if (rateLimitRetries > maxRate) return { ok: false, attempts, errorCode: 'rate_limited', errorMessage: pe.message.slice(0, 500) };
        await sleep(Math.min(65_000, pe.retryAfterMs ?? 10_000 * rateLimitRetries));
        continue;
      }
      networkFailures++;
      const retryable = pe.code === 'timeout' || (pe.code === 'provider_error' && (pe.status === null || pe.status >= 500));
      if (!retryable || networkFailures > maxNet) {
        const code = pe.code === 'timeout' || pe.code === 'refused' ? pe.code : 'provider_error';
        return { ok: false, attempts, errorCode: code, errorMessage: pe.message.slice(0, 500) };
      }
      await sleep(1500 * 2 ** (networkFailures - 1));
    }
  }
}

/** Legacy strategy: analyse one document chunk (used by the evaluation runner's "chunks" strategy). */
export async function analyzeChunk(
  provider: LlmProvider,
  req: AnalyzeRequest,
  chunk: AnalyzeRequest['chunks'][number],
  opts: AnalyzeOptions = {},
): Promise<ChunkResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(chunk, { url: req.url, title: req.title, documentTypeHint: req.documentTypeHint }) },
  ];
  const r = await runValidated(provider, messages, LlmChunkOutputSchema, chunk.id, opts);
  return r.ok ? { chunkId: chunk.id, ok: true, attempts: r.attempts, output: r.value } : { chunkId: chunk.id, ok: false, attempts: r.attempts, errorCode: r.errorCode, errorMessage: r.errorMessage };
}

export async function analyzeRequest(provider: LlmProvider, req: AnalyzeRequest, opts: AnalyzeOptions = {}): Promise<ChunkResult[]> {
  const results: ChunkResult[] = [];
  // Sequential on purpose: respects provider rate limits and keeps ordering deterministic.
  for (const chunk of req.chunks) results.push(await analyzeChunk(provider, req, chunk, opts));
  return results;
}

/**
 * Default strategy: ONE request that reviews the rule engine's numbered
 * candidate clauses. The model only references candidate ids — it never
 * writes quotations — so quotes cannot be fabricated; ids it invents are
 * rejected downstream.
 */
export async function analyzeReview(provider: LlmProvider, req: ReviewRequest, opts: AnalyzeOptions = {}): Promise<ReviewResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: buildReviewMessage(req) },
  ];
  const r = await runValidated<LlmReviewOutput>(provider, messages, LlmReviewOutputSchema, 'review', opts);
  return r.ok
    ? { ok: true, attempts: r.attempts, provider: r.provider, model: r.model, output: r.value }
    : { ok: false, attempts: r.attempts, provider: provider.name, model: provider.model, errorCode: r.errorCode, errorMessage: r.errorMessage };
}
