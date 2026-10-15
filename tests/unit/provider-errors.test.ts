import { describe, expect, it } from 'vitest';
import { analyzeChunk } from '../../src/lib/llm/analyze';
import { OpenAICompatibleProvider, retryHintMs } from '../../src/lib/llm/providers';
import { output } from '../helpers/fakes';

const chunk = { id: 'c0', heading: null, text: 'Üyelik ücretleri hiçbir koşulda iade edilmez ve sözleşme tek taraflı değiştirilebilir.', start: 0, end: 86 };
const req = { url: 'https://x.test/', title: 't', documentTypeHint: 'terms_of_service' as const, language: 'tr', chunks: [chunk] };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output([])) }, finish_reason: 'stop' }] }), { status: 200 });

function provider(responses: Array<() => Response>) {
  let i = 0;
  const calls: number[] = [];
  const p = new OpenAICompatibleProvider({ apiKey: 'k', baseURL: 'https://api.groq.example/openai/v1', model: 'm' }, async () => {
    calls.push(i);
    return responses[Math.min(i++, responses.length - 1)]!();
  });
  return { p, calls };
}

describe('provider error handling (Groq-style responses)', () => {
  it('parses "try again in" hints', () => {
    expect(retryHintMs('Please try again in 7.5s.')).toBe(7750);
    expect(retryHintMs('Please try again in 1m2.5s')).toBe(62750);
    expect(retryHintMs('Please try again in 420ms')).toBe(670);
  });
  it('waits and retries on 429 rate limits until success', async () => {
    const waits: number[] = [];
    const rl = () => new Response('{"error":{"message":"Rate limit reached ... Please try again in 2.1s.","code":"rate_limit_exceeded"}}', { status: 429 });
    const { p } = provider([rl, rl, rl, ok]);
    const r = await analyzeChunk(p, req, chunk, { sleep: async (ms) => void waits.push(ms) });
    expect(r.ok).toBe(true);
    expect(waits).toEqual([2350, 2350, 2350]);
  });
  it('retries when Groq rejects invalid JSON (400 json_validate_failed)', async () => {
    const bad = () => new Response('{"error":{"message":"Failed to generate JSON. Please adjust your prompt.","code":"json_validate_failed"}}', { status: 400 });
    const { p, calls } = provider([bad, ok]);
    const r = await analyzeChunk(p, req, chunk, { sleep: async () => undefined });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
  it('reports request-too-large without retrying', async () => {
    const big = () => new Response('{"error":{"message":"Request too large for model ... tokens per minute (TPM): Limit 12000, Requested 13542"}}', { status: 413 });
    const { p, calls } = provider([big]);
    const r = await analyzeChunk(p, req, chunk, { sleep: async () => undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).toContain('token sınırını');
    expect(calls).toHaveLength(1);
  });
});
