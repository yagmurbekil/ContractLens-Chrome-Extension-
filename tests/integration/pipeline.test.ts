/**
 * End-to-end pipeline without a browser and without network:
 * jsdom fixture → deterministic extraction → candidate selection →
 * real backend HTTP server (fake provider) → client re-validation →
 * id → exact text mapping → quote verification → deterministic score.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/backend/env';
import { createServer } from '../../src/backend/server';
import { OpenAICompatibleProvider } from '../../src/lib/llm/providers';
import { prepareDocument } from '../../src/lib/pipeline';
import { analyzePrepared, analyzePreparedChunks, checkHealth } from '../../src/lib/service';
import { extractFixture } from '../helpers/dom';
import { finding, output } from '../helpers/fakes';

let base = '';
let server: ReturnType<typeof createServer>;
let providerCalls = 0;

const reviewFinding = (candidateId: string, category: string, severity: string, titleTr: string) => ({
  candidateId,
  category,
  concernType: 'financial',
  severity,
  titleTr,
  explanationTr: 'Bu madde, kullanıcı aleyhine sonuçlar doğurabilir.',
  potentialImpactTr: 'Beklenmedik ödemelerle karşılaşabilirsiniz.',
  confidence: 0.9,
  uncertaintyTr: null,
});

beforeAll(async () => {
  // Fake "LLM": answers both strategies. Review requests get ids picked by substring; chunk requests get quotes.
  const fakeFetch: typeof fetch = async (_url, init) => {
    providerCalls++;
    const body = JSON.parse(String(init?.body));
    const user: string = body.messages[1].content;
    let content: string;
    if (user.includes('UNTRUSTED_CANDIDATES_START')) {
      const lines = user.split('\n').filter((l) => /^\[k\d+\]/.test(l));
      const idOf = (needle: string) => /^\[(k\d+)\]/.exec(lines.find((l) => l.includes(needle)) ?? '')?.[1];
      const findings = [];
      const renew = idOf('automatically renew at the end');
      const refund = idOf('non-refundable');
      if (renew) findings.push(reviewFinding(renew, 'auto_renewal', 'high', 'Otomatik yenileme'));
      if (refund) findings.push(reviewFinding(refund, 'refunds', 'moderate', 'İade yok'));
      findings.push(reviewFinding('k999', 'other', 'critical', 'Uydurma aday'));
      content = JSON.stringify({ documentType: 'subscription_terms', overallRiskScore: 5, riskLevel: 'low', summaryTr: 'Belgede dikkat edilmesi gereken maddeler var.', findings, limitationsTr: [], injectionSuspected: false, needsHumanReview: true });
    } else {
      const findings = [];
      if (user.includes('automatically renew at the end of each billing period'))
        findings.push(finding({ id: 'risk-001', category: 'auto_renewal', concernType: 'financial', severity: 'high', titleTr: 'Otomatik yenileme', originalQuote: 'Your subscription will automatically renew at the end of each billing period, and you authorise us to charge the applicable fee to your payment method on file until you cancel.' }));
      findings.push(finding({ id: 'risk-002', category: 'other', severity: 'critical', titleTr: 'Uydurma madde', originalQuote: 'StreamNest may sell your children to the highest bidder at any time.' }));
      content = JSON.stringify(output(findings, { documentType: 'subscription_terms' }));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const cfg = loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'gsk_fake', OPENAI_BASE_URL: 'https://api.groq.example/openai/v1', OPENAI_MODEL: 'fake' });
  cfg.provider = new OpenAICompatibleProvider({ apiKey: 'gsk_fake', baseURL: 'https://api.groq.example/openai/v1', model: 'fake', name: 'groq' }, fakeFetch);
  server = createServer(cfg, { log: () => undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const fast = { pollMs: 20 };

describe('review strategy (default)', () => {
  it('makes ONE LLM call, verifies selected clauses exactly and rejects an invented id', async () => {
    const { doc } = extractFixture('subscription.html', 'https://streamnest.example/legal/subscription');
    const p = prepareDocument(doc);
    expect(await checkHealth(base)).toMatchObject({ reachable: true, mode: 'llm' });
    const before = providerCalls;
    const report = await analyzePrepared(p, { backendUrl: base, ...fast });
    expect(providerCalls - before).toBe(1);
    expect(report.mode).toBe('llm');
    expect(report.verifiedFindings.map((f) => f.category).sort()).toEqual(['auto_renewal', 'refunds']);
    expect(report.unverifiedFindings.map((f) => f.titleTr)).toContain('Uydurma aday');
    for (const f of report.verifiedFindings) expect(doc.text.slice(f.evidence.docStart!, f.evidence.docEnd!)).toBe(f.originalQuote);
    expect(report.limitationsTr.join(' ')).toContain('aday maddeyi değerlendirdi');
  });
  it('uses the backend cache for an identical page (no second LLM call)', async () => {
    const { doc } = extractFixture('subscription.html', 'https://streamnest.example/legal/subscription');
    const before = providerCalls;
    const report = await analyzePrepared(prepareDocument(doc), { backendUrl: base, ...fast });
    expect(providerCalls).toBe(before);
    expect(report.verifiedFindings).toHaveLength(2);
  });
  it('falls back to clearly-labelled rules when the backend is unreachable', async () => {
    const { doc } = extractFixture('subscription.html');
    const report = await analyzePrepared(prepareDocument(doc), { backendUrl: 'http://127.0.0.1:1', ...fast });
    expect(report.mode).toBe('demo');
    expect(report.verifiedFindings.length).toBeGreaterThan(0);
    expect(report.limitationsTr.join(' ')).toMatch(/LLM analizi yapılamadı .*Sunucuya ulaşılamadı/);
    expect((await checkHealth('http://127.0.0.1:1')).reachable).toBe(false);
  });
});

describe('chunks strategy (legacy, used for evaluation comparisons)', () => {
  it('produces a verified report and rejects the fabricated finding', async () => {
    const { doc } = extractFixture('subscription.html', 'https://streamnest.example/legal/subscription');
    const report = await analyzePreparedChunks(prepareDocument(doc), { backendUrl: base, ...fast });
    expect(report.status).toBe('ok');
    expect(report.verifiedFindings.map((f) => f.category)).toEqual(['auto_renewal']);
    expect(report.unverifiedFindings.map((f) => f.titleTr)).toContain('Uydurma madde');
  });
});
