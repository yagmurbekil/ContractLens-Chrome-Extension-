/**
 * Provider abstraction. Only used server-side (backend + evaluation runner):
 * API keys are never present in the extension bundle.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  /** Which provider/model actually answered (relevant for fallback chains). */
  provider?: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], opts: { signal: AbortSignal; json: boolean }): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: 'rate_limited' | 'timeout' | 'provider_error' | 'auth_error' | 'refused' | 'invalid_output' | 'too_large',
    message: string,
    public readonly retryAfterMs: number | null = null,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

function retryAfter(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const s = Number(h);
  return Number.isFinite(s) ? Math.min(60_000, s * 1000) : null;
}

/** Parses "try again in 7.5s" / "in 1m2.3s" hints that Groq/OpenAI put in 429 messages. */
export function retryHintMs(text: string): number | null {
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(text);
  if (!m) return null;
  const mins = m[1] ? Number(m[1]) : 0;
  const val = Number(m[2]);
  const ms = m[3] === 'ms' ? val : val * 1000;
  return Math.min(65_000, Math.ceil(mins * 60_000 + ms) + 250);
}

async function errorFromResponse(res: Response): Promise<ProviderError> {
  // Read a short error body for diagnostics; never includes our key.
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    /* ignore */
  }
  if (res.status === 413 || /request too large|reduce your message size/i.test(detail))
    return new ProviderError('too_large', `İstek sağlayıcının token sınırını aşıyor (${res.status}). ${detail}`, null, res.status);
  if (res.status === 429) return new ProviderError('rate_limited', `Sağlayıcı hız sınırı (429). ${detail}`, retryAfter(res) ?? retryHintMs(detail), 429);
  if (res.status === 401 || res.status === 403) return new ProviderError('auth_error', `Sağlayıcı kimlik doğrulama hatası (${res.status}). API anahtarını kontrol edin.`, null, res.status);
  // Groq returns 400 json_validate_failed when the model produced invalid JSON in JSON mode.
  if (res.status === 400 && /json_validate_failed|failed to generate json|valid json/i.test(detail))
    return new ProviderError('invalid_output', `Model geçerli JSON üretemedi (400). ${detail.slice(0, 200)}`, null, 400);
  if (res.status === 404 && /model_not_found|does not exist/i.test(detail))
    return new ProviderError('provider_error', `Model bulunamadı (404): .env içindeki model adı bu sağlayıcıda yok. Kullanılabilir modelleri görmek için "npm run diagnose" çalıştırın. ${detail.slice(0, 200)}`, null, 404);
  return new ProviderError('provider_error', `Sağlayıcı hatası (${res.status}). ${detail}`, null, res.status);
}

/** Any OpenAI-compatible Chat Completions API (OpenAI, Groq, Together, local vLLM, Ollama…). */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private readonly cfg: { apiKey: string; baseURL: string; model: string; name?: string; temperature?: number },
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.name = cfg.name ?? 'openai-compatible';
  }
  get model() {
    return this.cfg.model;
  }
  /**
   * Forward an already-validated OpenAI-style request (used by the Page Agent
   * proxy). The model and credentials are always set here, server-side.
   */
  proxyChat(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ ...body, model: this.cfg.model, temperature: 0 }),
      signal,
    });
  }
  async complete(messages: ChatMessage[], opts: { signal: AbortSignal; json: boolean }): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature ?? 0,
      max_tokens: 3000, // keeps prompt+completion under small free-tier TPM limits (e.g. Groq)
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new ProviderError('timeout', 'Sağlayıcı isteği zaman aşımına uğradı.');
      throw new ProviderError('provider_error', `Ağ hatası: ${(e as Error).message}`);
    }
    if (!res.ok) throw await errorFromResponse(res);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderError('refused', 'Model isteği reddetti.');
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('provider_error', 'Sağlayıcı yanıtında içerik yok.');
    return { content, provider: this.name, model: this.cfg.model, usage: { promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens } };
  }
}

/** Anthropic Messages API. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(
    private readonly cfg: { apiKey: string; model: string; baseURL?: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  get model() {
    return this.cfg.model;
  }
  async complete(messages: ChatMessage[], opts: { signal: AbortSignal; json: boolean }): Promise<CompletionResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    let res: Response;
    try {
      res = await this.fetchImpl(`${(this.cfg.baseURL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.cfg.model, system, messages: rest, max_tokens: 4096, temperature: 0 }),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new ProviderError('timeout', 'Sağlayıcı isteği zaman aşımına uğradı.');
      throw new ProviderError('provider_error', `Ağ hatası: ${(e as Error).message}`);
    }
    if (!res.ok) throw await errorFromResponse(res);
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = json.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
    if (!text) throw new ProviderError('provider_error', 'Sağlayıcı yanıtında içerik yok.');
    return { content: text, provider: this.name, model: this.cfg.model, usage: { promptTokens: json.usage?.input_tokens, completionTokens: json.usage?.output_tokens } };
  }
}

/**
 * Fallback chain: tries each provider in order. A provider that is rate
 * limited, unavailable, misconfigured (404 model, 401 key, 400 credit) or too
 * small for the request hands over to the next one immediately. The last
 * provider's error is re-thrown so the normal retry logic can still wait on
 * rate limits. "invalid_output" is not a provider failure and is re-thrown.
 */
export class ChainProvider implements LlmProvider {
  constructor(public readonly providers: LlmProvider[]) {
    if (!providers.length) throw new Error('ChainProvider needs at least one provider');
  }
  get name() {
    return this.providers.map((p) => p.name).join('→');
  }
  get model() {
    return this.providers[0]!.model;
  }
  async complete(messages: ChatMessage[], opts: { signal: AbortSignal; json: boolean }): Promise<CompletionResult> {
    let last: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i]!;
      try {
        const r = await p.complete(messages, opts);
        return { ...r, provider: r.provider ?? p.name, model: r.model ?? p.model };
      } catch (e) {
        last = e;
        const isLast = i === this.providers.length - 1;
        if (isLast || (e instanceof ProviderError && e.code === 'invalid_output')) throw e;
        if (opts.signal.aborted) throw e;
      }
    }
    throw last;
  }
}
