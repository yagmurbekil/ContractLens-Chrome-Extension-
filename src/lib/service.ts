import { demoAnalyze } from './llm/demo';
import type { HealthInfo } from './messages';
import { runAnalysis, type PreparedDocument } from './pipeline';
import { runReview } from './review';
import type { DocumentType, Report } from './schema';

/**
 * Client-side orchestration shared by the extension background worker and
 * the test harness. All network traffic goes to the configured backend only.
 */

export class AnalysisError extends Error {
  constructor(public readonly code: 'backend_unreachable' | 'network' | 'malformed', message: string) {
    super(message);
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(t);
  }
}

export async function checkHealth(backendUrl: string, fetchImpl: typeof fetch = fetch): Promise<HealthInfo> {
  try {
    const res = await withTimeout(4000, (signal) => fetchImpl(`${backendUrl.replace(/\/$/, '')}/health`, { signal }));
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as Partial<HealthInfo> & { mode?: string };
    return {
      reachable: true,
      mode: j.mode === 'llm' ? 'llm' : 'demo',
      provider: String(j.provider ?? ''),
      model: String(j.model ?? ''),
      agentProxy: Boolean(j.agentProxy),
    };
  } catch {
    return { reachable: false, mode: 'unreachable', provider: '', model: '', agentProxy: false };
  }
}

export interface AnalyzeOptions {
  backendUrl: string;
  fetchImpl?: typeof fetch;
  typeOverride?: DocumentType;
  /** Run the local, clearly-labelled rule-based demo instead of the backend. */
  demo?: boolean;
  /** Overall limit for one backend analysis (default 15 min: free LLM tiers are slow). */
  timeoutMs?: number;
  /** Poll interval for job status (default 2 s). */
  pollMs?: number;
  /** Called after each poll with analysed/total chunk counts. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Starts an analysis job on the backend and polls it with short requests.
 * (A Chrome MV3 service worker is killed if one fetch() takes too long to
 * respond, so a single long-running request is not an option in the extension.)
 * Falls back to the synchronous /v1/analyze endpoint for older backends.
 */
async function analyzeViaBackend(req: unknown, opts: AnalyzeOptions, endpoint = '/v1/analyze'): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.backendUrl.replace(/\/$/, '');
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = async (path: string, init?: RequestInit) => {
    try {
      return await withTimeout(20_000, (signal) => fetchImpl(`${base}${path}`, { ...init, signal }));
    } catch (e) {
      throw new AnalysisError('backend_unreachable', `Sunucuya ulaşılamadı: ${(e as Error).message}`);
    }
  };
  const res = await call(`${endpoint}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  if (res.status === 404) {
    // Older backend without jobs: synchronous call (may be too slow for the extension).
    const r = await withTimeout(opts.timeoutMs ?? 900_000, (signal) => fetchImpl(`${base}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal }));
    if (!r.ok) throw new AnalysisError('network', `Sunucu hatası (${r.status}).`);
    return r.json();
  }
  if (res.status === 429) throw new AnalysisError('network', 'Sunucu hız sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.');
  if (!res.ok) throw new AnalysisError('network', `Sunucu hatası (${res.status}).`);
  const { jobId, total } = (await res.json()) as { jobId: string; total: number };
  await opts.onProgress?.(0, total);
  const deadline = Date.now() + (opts.timeoutMs ?? 900_000);
  while (Date.now() < deadline) {
    await sleep(opts.pollMs ?? 2000);
    const r = await call(`${endpoint}/jobs/${jobId}`);
    if (!r.ok) throw new AnalysisError('network', `Sunucu hatası (${r.status}).`);
    let j: { status: string; done: number; total: number; response: unknown; error: string | null };
    try {
      j = await r.json();
    } catch {
      throw new AnalysisError('malformed', 'Sunucu yanıtı JSON değil.');
    }
    await opts.onProgress?.(j.done, j.total);
    if (j.status === 'done') return j.response;
    if (j.status === 'error') throw new AnalysisError('network', `Sunucuda analiz hatası: ${j.error ?? 'bilinmiyor'}`);
  }
  throw new AnalysisError('network', 'Analiz zaman aşımına uğradı (15 dk). LLM sağlayıcısının hız sınırlarını kontrol edin.');
}

/**
 * Default strategy: rule-selected candidate clauses + ONE LLM review request,
 * with automatic, clearly-labelled fallback to the rule engine when the LLM
 * (or the backend) is unavailable. Returns a report in every case.
 */
export async function analyzePrepared(p: PreparedDocument, opts: AnalyzeOptions & { priorityHeadings?: string[] }): Promise<Report> {
  const reviewer = opts.demo ? null : (req: unknown) => analyzeViaBackend(req, opts, '/v1/review');
  return (await runReview(p, reviewer, { typeOverride: opts.typeOverride, priorityHeadings: opts.priorityHeadings })).report;
}

/** Legacy "chunks" strategy (every chunk sent to the LLM). Kept for evaluation and comparison. */
export async function analyzePreparedChunks(p: PreparedDocument, opts: AnalyzeOptions): Promise<Report> {
  if (opts.demo) return runAnalysis(p, async (req) => demoAnalyze(req), opts.typeOverride);
  return runAnalysis(p, (req) => analyzeViaBackend(req, opts, '/v1/analyze'), opts.typeOverride);
}
