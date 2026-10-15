import http from 'node:http';
import { z } from 'zod';
import { LIMITS } from '../lib/config';
import { analyzeChunk, analyzeRequest, analyzeReview } from '../lib/llm/analyze';
import { createHash, randomUUID } from 'node:crypto';
import { demoAnalyze } from '../lib/llm/demo';
import { ChainProvider, OpenAICompatibleProvider } from '../lib/llm/providers';
import { AnalyzeRequestSchema, ReviewRequestSchema, type AnalyzeRequest, type AnalyzeResponse, type ChunkResult, type ReviewRequest, type ReviewResult } from '../lib/schema';
import type { LoadedConfig } from './env';

/**
 * ContractLens backend.
 *  - Holds the LLM API key (env only) and forwards the minimum extracted text.
 *  - Validates every request and every model response server-side.
 *  - Logs metadata only: never document text, never keys.
 */

export const AGENT_FORBIDDEN_TOOLS = ['click_element_by_index', 'input_text', 'select_dropdown_option', 'execute_javascript', 'scroll_horizontally', 'ask_user'];

const AgentProxyBodySchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.unknown().optional() }).passthrough())
      .min(1)
      .max(80),
    tools: z.array(z.unknown()).max(4),
    tool_choice: z.unknown().optional(),
    parallel_tool_calls: z.boolean().optional(),
    temperature: z.number().optional(),
  })
  .strict();

export interface ServerDeps {
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}
  allow(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (arr.length >= this.perMinute) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }
}

export function isOriginAllowed(origin: string | undefined, allowed: string): boolean {
  if (!origin) return true; // non-browser clients; server binds to loopback by default
  return allowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((a) => (a.endsWith('*') ? origin.startsWith(a.slice(0, -1)) : origin === a));
}

async function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Asynchronous analysis jobs. A Chrome MV3 service worker is terminated when a
 * fetch() response takes too long, so the extension starts a job and polls it
 * with short requests instead of holding one request open for minutes.
 * Jobs live in memory only and are discarded 30 minutes after creation.
 */
interface Job {
  id: string;
  createdAt: number;
  status: 'running' | 'done' | 'error';
  total: number;
  done: number;
  lastEvent: string;
  response?: AnalyzeResponse | ReviewResult;
  error?: string;
}
const JOB_TTL_MS = 30 * 60_000;

export function createServer(config: LoadedConfig, deps: ServerDeps = {}): http.Server {
  const jobs = new Map<string, Job>();
  const sweep = () => {
    const t = Date.now();
    for (const [id, j] of jobs) if (t - j.createdAt > JOB_TTL_MS) jobs.delete(id);
  };
  const { env, provider } = config;
  // Page Agent proxy needs a raw OpenAI-compatible endpoint (first one in a fallback chain).
  const agentProvider =
    provider instanceof OpenAICompatibleProvider
      ? provider
      : provider instanceof ChainProvider
        ? (provider.providers.find((p) => p instanceof OpenAICompatibleProvider) as OpenAICompatibleProvider | undefined)
        : undefined;
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const limiter = new RateLimiter(env.RATE_LIMIT_PER_MINUTE, deps.now);

  /**
   * Review cache: identical candidate lists (same page text) reuse the previous
   * validated LLM result for 24 h instead of spending tokens again. In memory only.
   */
  const reviewCache = new Map<string, { at: number; result: ReviewResult }>();
  const CACHE_TTL_MS = 24 * 60 * 60_000;
  const cacheKey = (r: ReviewRequest) =>
    createHash('sha256').update(JSON.stringify([provider?.name, provider?.model, r.documentTypeHint, r.candidates.map((c) => [c.id, c.text])])).digest('hex');

  async function review(request: ReviewRequest, onEvent?: (e: { chunkId: string; type: string; attempt: number; detail?: string }) => void): Promise<ReviewResult> {
    if (!provider) {
      return { ok: false, attempts: 0, provider: 'none', model: '-', errorCode: 'provider_error', errorMessage: 'Sunucuda LLM sağlayıcısı yapılandırılmamış (.env).' };
    }
    const key = cacheKey(request);
    const hit = reviewCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      log({ ts: new Date().toISOString(), event: 'review', cache: 'hit' });
      return hit.result;
    }
    const result = await analyzeReview(provider, request, {
      onEvent: (e) => {
        onEvent?.(e);
        log({ ts: new Date().toISOString(), event: 'llm', strategy: 'review', type: e.type, attempt: e.attempt, ...(e.type === 'request' ? {} : { detail: e.detail }) });
      },
    });
    if (result.ok) {
      reviewCache.set(key, { at: Date.now(), result });
      if (reviewCache.size > 200) reviewCache.delete(reviewCache.keys().next().value!);
    }
    return result;
  }

  async function runJob(job: Job, request: AnalyzeRequest): Promise<void> {
    try {
      if (!provider) {
        job.response = demoAnalyze(request);
        job.done = job.total;
      } else {
        const results: ChunkResult[] = [];
        for (const chunk of request.chunks) {
          results.push(
            await analyzeChunk(provider, request, chunk, {
              onEvent: (e) => {
                job.lastEvent = `${e.chunkId}:${e.type}`;
                log({ ts: new Date().toISOString(), event: 'llm', job: job.id.slice(0, 8), chunk: e.chunkId, type: e.type, attempt: e.attempt, ...(e.type === 'valid' || e.type === 'request' ? {} : { detail: e.detail }) });
              },
            }),
          );
          job.done = results.length;
        }
        job.response = { mode: 'llm', provider: provider.name, model: provider.model, results };
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = (e as Error).message.slice(0, 300);
    }
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = req.headers.origin;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...(origin && isOriginAllowed(origin, env.ALLOWED_ORIGINS)
          ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
          : {}),
      });
      res.end(JSON.stringify(body));
      log({ ts: new Date().toISOString(), method: req.method, path: url.pathname, status, ms: Date.now() - started });
    };

    try {
      if (!isOriginAllowed(origin, env.ALLOWED_ORIGINS)) return send(403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') return send(204, {});
      const ip = req.socket.remoteAddress ?? 'unknown';

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, {
          ok: true,
          mode: provider ? 'llm' : 'demo',
          provider: provider?.name ?? 'demo-rules',
          model: provider?.model ?? 'keyword-rules-v1',
          agentProxy: Boolean(agentProvider && env.ENABLE_AGENT_PROXY),
          warnings: config.warnings,
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/analyze/jobs') {
        if (!limiter.allow(ip)) return send(429, { error: 'rate_limited' });
        sweep();
        const body = await readBody(req, LIMITS.maxRequestBytes);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return send(400, { error: 'invalid_json' });
        }
        const parsed = AnalyzeRequestSchema.safeParse(json);
        if (!parsed.success) return send(400, { error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message) });
        const job: Job = { id: randomUUID(), createdAt: Date.now(), status: 'running', total: parsed.data.chunks.length, done: 0, lastEvent: 'queued' };
        jobs.set(job.id, job);
        void runJob(job, parsed.data);
        return send(202, { jobId: job.id, total: job.total });
      }

      if (req.method === 'POST' && (url.pathname === '/v1/review' || url.pathname === '/v1/review/jobs')) {
        if (!limiter.allow(ip)) return send(429, { error: 'rate_limited' });
        sweep();
        const body = await readBody(req, LIMITS.maxRequestBytes);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return send(400, { error: 'invalid_json' });
        }
        const parsed = ReviewRequestSchema.safeParse(json);
        if (!parsed.success) return send(400, { error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message) });
        if (url.pathname === '/v1/review') return send(200, await review(parsed.data));
        const job: Job = { id: randomUUID(), createdAt: Date.now(), status: 'running', total: 1, done: 0, lastEvent: 'queued' };
        jobs.set(job.id, job);
        void (async () => {
          try {
            job.response = await review(parsed.data, (e) => (job.lastEvent = e.type));
            job.done = 1;
            job.status = 'done';
          } catch (e) {
            job.status = 'error';
            job.error = (e as Error).message.slice(0, 300);
          }
        })();
        return send(202, { jobId: job.id, total: 1 });
      }

      const jobMatch = /^\/v1\/(?:analyze|review)\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1]!);
        if (!job) return send(404, { error: 'job_not_found' });
        return send(200, { status: job.status, done: job.done, total: job.total, lastEvent: job.lastEvent, response: job.response ?? null, error: job.error ?? null });
      }

      if (req.method === 'POST' && url.pathname === '/v1/analyze') {
        if (!limiter.allow(ip)) return send(429, { error: 'rate_limited' });
        const body = await readBody(req, LIMITS.maxRequestBytes);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return send(400, { error: 'invalid_json' });
        }
        const parsed = AnalyzeRequestSchema.safeParse(json);
        if (!parsed.success) return send(400, { error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message) });
        let response: AnalyzeResponse;
        if (!provider) response = demoAnalyze(parsed.data);
        else {
          const results = await analyzeRequest(provider, parsed.data, {
            // detail = provider/validator error text only (never document text or keys)
            onEvent: (e) => log({ ts: new Date().toISOString(), event: 'llm', chunk: e.chunkId, type: e.type, attempt: e.attempt, ...(e.type === 'valid' || e.type === 'request' ? {} : { detail: e.detail }) }),
          });
          response = { mode: 'llm', provider: provider.name, model: provider.model, results };
        }
        return send(200, response);
      }

      if (req.method === 'POST' && url.pathname === '/v1/agent/chat/completions') {
        if (!agentProvider || !env.ENABLE_AGENT_PROXY) return send(503, { error: { message: 'agent_proxy_unavailable' } });
        if (!limiter.allow(ip)) return send(429, { error: { message: 'rate_limited' } });
        const raw = await readBody(req, 600_000);
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return send(400, { error: { message: 'invalid_json' } });
        }
        const parsed = AgentProxyBodySchema.safeParse(json);
        if (!parsed.success) return send(400, { error: { message: 'invalid_agent_request' } });
        const toolsJson = JSON.stringify(parsed.data.tools);
        const forbidden = AGENT_FORBIDDEN_TOOLS.filter((t) => toolsJson.includes(`"${t}"`));
        if (forbidden.length) return send(400, { error: { message: `forbidden_agent_tools: ${forbidden.join(',')}` } });
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 60_000);
        try {
          // The model and key are always set by the server, never by the page.
          const upstream = await agentProvider.proxyChat(parsed.data, ac.signal);
          const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
          return send(upstream.status, { choices: data.choices ?? [], usage: data.usage ?? null, ...(upstream.ok ? {} : { error: { message: `upstream_${upstream.status}` } }) });
        } finally {
          clearTimeout(timer);
        }
      }

      return send(404, { error: 'not_found' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return send(status, { error: status === 413 ? 'payload_too_large' : 'internal_error' });
    }
  });
}
