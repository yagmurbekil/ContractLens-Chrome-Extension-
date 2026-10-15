import { z } from 'zod';
import { AnthropicProvider, ChainProvider, OpenAICompatibleProvider, type LlmProvider } from '../lib/llm/providers';

/**
 * Environment validation. Secrets are read only from process.env and are
 * never logged, echoed in responses, or sent to the extension.
 */
const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'none']).default('none'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  /** Optional second OpenAI-compatible provider used when the primary is rate-limited or unavailable (e.g. Gemini). */
  FALLBACK_API_KEY: z.string().optional(),
  FALLBACK_BASE_URL: z.string().url().optional(),
  FALLBACK_MODEL: z.string().optional(),
  FALLBACK_NAME: z.string().optional(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Comma separated exact origins. "chrome-extension://*" allows any extension id (development only). */
  ALLOWED_ORIGINS: z.string().default('chrome-extension://*,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  ENABLE_AGENT_PROXY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Force demo mode even when a provider is configured (for Cypress). */
  FORCE_DEMO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface LoadedConfig {
  env: Env;
  provider: LlmProvider | null;
  warnings: string[];
}

function looksLikePlaceholder(v: string | undefined): boolean {
  return !v || /^(your|replace|changeme|xxx|sk-\.\.\.|<)/i.test(v.trim());
}

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Geçersiz ortam değişkenleri: ${msg}`);
  }
  const env = parsed.data;
  const warnings: string[] = [];
  let provider: LlmProvider | null = null;
  if (env.LLM_PROVIDER === 'openai') {
    if (looksLikePlaceholder(env.OPENAI_API_KEY)) warnings.push('LLM_PROVIDER=openai fakat OPENAI_API_KEY ayarlı değil; demo moduna düşülüyor.');
    else
      provider = new OpenAICompatibleProvider({
        apiKey: env.OPENAI_API_KEY!,
        baseURL: env.OPENAI_BASE_URL,
        model: env.OPENAI_MODEL,
        name: new URL(env.OPENAI_BASE_URL).hostname.includes('groq') ? 'groq' : 'openai-compatible',
      });
  } else if (env.LLM_PROVIDER === 'anthropic') {
    if (looksLikePlaceholder(env.ANTHROPIC_API_KEY)) warnings.push('LLM_PROVIDER=anthropic fakat ANTHROPIC_API_KEY ayarlı değil; demo moduna düşülüyor.');
    else provider = new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY!, model: env.ANTHROPIC_MODEL });
  }
  if (env.FALLBACK_BASE_URL || env.FALLBACK_API_KEY || env.FALLBACK_MODEL) {
    if (looksLikePlaceholder(env.FALLBACK_API_KEY) || !env.FALLBACK_BASE_URL || !env.FALLBACK_MODEL) {
      warnings.push('FALLBACK_* ayarları eksik (FALLBACK_API_KEY, FALLBACK_BASE_URL, FALLBACK_MODEL gerekli); yedek sağlayıcı kullanılmıyor.');
    } else {
      const host = new URL(env.FALLBACK_BASE_URL).hostname;
      const fb = new OpenAICompatibleProvider({
        apiKey: env.FALLBACK_API_KEY!,
        baseURL: env.FALLBACK_BASE_URL,
        model: env.FALLBACK_MODEL,
        name: env.FALLBACK_NAME ?? (host.includes('googleapis') ? 'gemini' : host.includes('groq') ? 'groq' : 'fallback'),
      });
      provider = provider ? new ChainProvider([provider, fb]) : fb;
    }
  }
  if (env.FORCE_DEMO) provider = null;
  return { env, provider, warnings };
}

/** Minimal .env loader (no dependency). Does not override existing variables. */
export async function loadDotEnv(path = '.env'): Promise<void> {
  const fs = await import('node:fs');
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1]!;
    let val = m[2]!;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
