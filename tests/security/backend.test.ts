/**
 * Backend security tests (real HTTP server on an ephemeral loopback port,
 * provider replaced by an in-process fake fetch — no network).
 *
 * Proves: keys and document text never appear in logs or responses; the
 * Page Agent proxy rejects state-changing tools and always forces the server
 * model; origin allow-list and rate limiting work; malformed requests and
 * malformed model output are rejected.
 * Cannot prove: provider-side data handling or retention.
 */
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/backend/env';
import { createServer, isOriginAllowed } from '../../src/backend/server';
import { OpenAICompatibleProvider } from '../../src/lib/llm/providers';
import { finding, output } from '../helpers/fakes';

const SECRET = 'gsk_TEST_SECRET_never_log_this_1234567890';
const DOC_TEXT =
  'We may share your personal information with advertising partners and other third parties for marketing purposes. This is a confidential test sentence XYZZY.';

let server: ReturnType<typeof createServer> | null = null;
afterEach(() => server?.close());

async function start(opts: { providerResponses?: unknown[]; env?: Record<string, string> } = {}) {
  const logs: Record<string, unknown>[] = [];
  const upstream: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const queue = [...(opts.providerResponses ?? [])];
  const fakeFetch: typeof fetch = async (input, init) => {
    upstream.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(next ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cfg = loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET, OPENAI_BASE_URL: 'https://api.groq.example/openai/v1', OPENAI_MODEL: 'server-model', RATE_LIMIT_PER_MINUTE: '5', ...opts.env });
  cfg.provider = new OpenAICompatibleProvider({ apiKey: SECRET, baseURL: 'https://api.groq.example/openai/v1', model: 'server-model', name: 'groq' }, fakeFetch);
  server = createServer(cfg, { log: (e) => logs.push(e) });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, logs, upstream };
}

const chatResponse = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

function analyzeBody() {
  return { url: 'https://example.test/privacy', title: 'Privacy', documentTypeHint: 'privacy_policy', language: 'en', chunks: [{ id: 'c0', heading: null, text: DOC_TEXT, start: 0, end: DOC_TEXT.length }] };
}

describe('backend /v1/analyze', () => {
  it('validates model output server-side and never logs secrets or document text', async () => {
    const { base, logs, upstream } = await start({ providerResponses: [chatResponse(JSON.stringify(output([finding()])))] });
    const res = await fetch(`${base}/v1/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(analyzeBody()) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.mode).toBe('llm');
    expect(json.results[0].ok).toBe(true);
    expect(upstream[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    const serialisedLogs = JSON.stringify(logs);
    expect(serialisedLogs).not.toContain(SECRET);
    expect(serialisedLogs).not.toContain('XYZZY');
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });
  it('returns a validation_failed result (not invented data) when the model keeps returning garbage', async () => {
    const { base } = await start({ providerResponses: [chatResponse('I think this site is safe.')] });
    const res = await fetch(`${base}/v1/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(analyzeBody()) });
    const json = await res.json();
    expect(json.results[0]).toMatchObject({ ok: false, errorCode: 'validation_failed', attempts: 3 });
  });
  it('rejects malformed and oversized requests', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/v1/analyze`, { method: 'POST', body: '{' })).status).toBe(400);
    expect((await fetch(`${base}/v1/analyze`, { method: 'POST', body: JSON.stringify({ ...analyzeBody(), extra: true }) })).status).toBe(400);
    expect((await fetch(`${base}/v1/analyze`, { method: 'POST', body: 'x'.repeat(500_000) })).status).toBe(413);
  });
  it('enforces the origin allow-list', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(isOriginAllowed('chrome-extension://abcdef', 'chrome-extension://*')).toBe(true);
    expect(isOriginAllowed('https://evil.example', 'chrome-extension://*,http://localhost:5173')).toBe(false);
  });
  it('rate limits per client', async () => {
    const { base } = await start({ providerResponses: [chatResponse(JSON.stringify(output([])))] });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await fetch(`${base}/v1/analyze`, { method: 'POST', body: JSON.stringify(analyzeBody()) })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
  it('health does not expose the key', async () => {
    const { base } = await start();
    const txt = await (await fetch(`${base}/health`)).text();
    expect(txt).not.toContain(SECRET);
    expect(JSON.parse(txt)).toMatchObject({ mode: 'llm', provider: 'groq', model: 'server-model', agentProxy: true });
  });
});

describe('backend /v1/agent proxy (Page Agent)', () => {
  const tool = (name: string) => ({ type: 'function', function: { name: 'AgentOutput', parameters: { properties: { action: { anyOf: [{ properties: { [name]: {} } }] } } } } });
  it('rejects requests that expose state-changing tools', async () => {
    const { base, upstream } = await start();
    for (const t of ['click_element_by_index', 'input_text', 'execute_javascript', 'select_dropdown_option', 'ask_user']) {
      const res = await fetch(`${base}/v1/agent/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [tool(t)] }) });
      expect(res.status).toBe(400);
    }
    expect(upstream).toHaveLength(0);
  });
  it('forwards read-only requests with the server-chosen model', async () => {
    const { base, upstream } = await start({ providerResponses: [{ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }] });
    const res = await fetch(`${base}/v1/agent/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'attacker-model', messages: [{ role: 'user', content: 'hi' }], tools: [tool('scroll')] }) });
    expect(res.status).toBe(200);
    expect(upstream[0]!.body.model).toBe('server-model');
  });
  it('rejects unknown fields (e.g. attempts to set base URLs or keys)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/v1/agent/chat/completions`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], tools: [], api_key: 'x' }) });
    expect(res.status).toBe(400);
  });
});

describe('demo fallback', () => {
  it('labels responses as demo when no provider is configured', async () => {
    const cfg = loadConfig({ LLM_PROVIDER: 'none' });
    server = createServer(cfg, { log: () => undefined });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const json = await (await fetch(`${base}/v1/analyze`, { method: 'POST', body: JSON.stringify(analyzeBody()) })).json();
    expect(json.mode).toBe('demo');
    expect(json.provider).toBe('demo-rules');
  });
  it('treats placeholder keys as unconfigured', () => {
    const cfg = loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'your-api-key-here' });
    expect(cfg.provider).toBeNull();
    expect(cfg.warnings.length).toBe(1);
  });
});
