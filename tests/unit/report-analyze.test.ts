import { describe, expect, it } from 'vitest';
import { analyzeChunk } from '../../src/lib/llm/analyze';
import { demoAnalyze } from '../../src/lib/llm/demo';
import { ProviderError } from '../../src/lib/llm/providers';
import { buildAnalyzeRequests, prepareDocument, runAnalysis } from '../../src/lib/pipeline';
import { LlmChunkOutputSchema, type AnalyzeResponse } from '../../src/lib/schema';
import { extractFixture } from '../helpers/dom';
import { finding, output, ScriptedProvider } from '../helpers/fakes';

const noSleep = async () => undefined;

function prepared(file = 'privacy-normal.html') {
  const { doc } = extractFixture(file, `https://example.test/${file}`);
  return prepareDocument(doc);
}

function respond(p: ReturnType<typeof prepared>, perChunk: (id: string) => ReturnType<typeof output> | null): AnalyzeResponse {
  return {
    mode: 'llm',
    provider: 'test',
    model: 'test',
    results: p.selected.map((c) => {
      const o = perChunk(c.id);
      return o ? { chunkId: c.id, ok: true as const, attempts: 1, output: o } : { chunkId: c.id, ok: false as const, attempts: 3, errorCode: 'validation_failed' as const, errorMessage: 'x' };
    }),
  };
}

describe('analyzeChunk retries', () => {
  const p = prepared();
  const req = buildAnalyzeRequests(p)[0]!;
  const chunk = req.chunks[0]!;

  it('retries after invalid output and then accepts valid output', async () => {
    const prov = new ScriptedProvider(['not json at all', JSON.stringify(output([finding()]))]);
    const r = await analyzeChunk(prov, req, chunk, { sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(prov.calls[1]!.at(-1)!.content).toContain('rejected by the schema validator');
  });
  it('gives up after the bounded number of validation retries', async () => {
    const prov = new ScriptedProvider(['{"bad": true}']);
    const r = await analyzeChunk(prov, req, chunk, { sleep: noSleep, maxValidationRetries: 2 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    if (!r.ok) expect(r.errorCode).toBe('validation_failed');
  });
  it('retries rate limits and stops on auth errors', async () => {
    const rl = new ScriptedProvider([new ProviderError('rate_limited', '429', 10), JSON.stringify(output([]))]);
    expect((await analyzeChunk(rl, req, chunk, { sleep: noSleep })).ok).toBe(true);
    const auth = new ScriptedProvider([new ProviderError('auth_error', '401', null, 401)]);
    const r = await analyzeChunk(auth, req, chunk, { sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(auth.calls).toHaveLength(1);
  });
});

describe('buildReport', () => {
  it('computes the score from verified findings and ignores the model score', async () => {
    const p = prepared();
    const resp = respond(p, (id) => (id === p.selected[0]!.id ? output([finding()], { overallRiskScore: 3, riskLevel: 'low' }) : output([])));
    const report = await runAnalysis(p, async () => resp);
    expect(report.status).toBe('ok');
    expect(report.verifiedFindings).toHaveLength(1);
    // 3 × (0.5 + 0.5×0.9) = 2.85 → 100 × (1 − e^(−2.85/8)) = 29.97 → 30 (model said 3)
    expect(report.overallRiskScore).toBe(30);
  });
  it('keeps unverified findings out of the score and out of verifiedFindings', async () => {
    const p = prepared();
    const fake = finding({ id: 'risk-002', originalQuote: 'Brightleaf promises it will never share any personal data with advertisers.' });
    const report = await runAnalysis(p, async () => respond(p, () => output([fake])));
    expect(report.verifiedFindings).toHaveLength(0);
    expect(report.unverifiedFindings.length).toBeGreaterThan(0);
    expect(report.overallRiskScore).toBe(0);
    expect(report.scoreExplanationTr).toContain('güvenli olduğu anlamına gelmez');
  });
  it('de-duplicates the same clause reported from overlapping chunks', async () => {
    const p = prepared();
    const report = await runAnalysis(p, async () => respond(p, () => output([finding(), finding({ id: 'risk-002', severity: 'moderate' })])));
    expect(report.verifiedFindings).toHaveLength(1);
    expect(report.verifiedFindings[0]!.severity).toBe('high');
  });
  it('reports "Yetersiz veri" for very short documents', async () => {
    const p = prepared('ambiguous.html');
    const report = await runAnalysis(p, async () => respond(p, () => output([])));
    expect(report.status).toBe('insufficient_data');
    expect(report.overallRiskScore).toBeNull();
    expect(report.scoreExplanationTr).toContain('Yetersiz veri');
  });
  it('reports "Analiz belirsiz" when many chunks fail', async () => {
    const { doc } = extractFixture('privacy-normal.html');
    const p = prepareDocument(doc);
    // force several chunks by re-chunking smaller
    const { chunkDocument } = await import('../../src/lib/chunk');
    p.chunks = chunkDocument(doc, 700, 50);
    p.selected = p.chunks;
    const report = await runAnalysis(p, async (req) => ({
      mode: 'llm',
      provider: 't',
      model: 't',
      results: req.chunks.map((c, i) => (i === 0 ? { chunkId: c.id, ok: true, attempts: 1, output: output([]) } : { chunkId: c.id, ok: false, attempts: 3, errorCode: 'provider_error', errorMessage: 'x' })),
    }));
    expect(report.status).toBe('uncertain');
  });
  it('fails cleanly on a malformed backend response', async () => {
    const p = prepared();
    const report = await runAnalysis(p, async () => ({ hello: 'world' }));
    expect(report.status).toBe('failed');
    expect(report.overallRiskScore).toBeNull();
    expect(report.coverage.schemaFailures).toBeGreaterThan(0);
  });
  it('ignores results for chunks that were never sent', async () => {
    const p = prepared();
    const resp = respond(p, () => output([]));
    resp.results.push({ chunkId: 'c999', ok: true, attempts: 1, output: output([finding()]) });
    const report = await runAnalysis(p, async () => resp);
    expect(report.verifiedFindings).toHaveLength(0);
  });
});

describe('demo mode', () => {
  it('produces schema-valid, clearly labelled, verifiable output', async () => {
    const p = prepared('subscription.html');
    for (const req of buildAnalyzeRequests(p)) {
      const res = demoAnalyze(req);
      expect(res.mode).toBe('demo');
      for (const r of res.results) if (r.ok) expect(LlmChunkOutputSchema.safeParse(r.output).success).toBe(true);
    }
    const report = await runAnalysis(p, async (req) => demoAnalyze(req));
    expect(report.mode).toBe('demo');
    expect(report.verifiedFindings.map((f) => f.category)).toEqual(expect.arrayContaining(['auto_renewal', 'refunds', 'arbitration_class_waiver']));
    expect(report.unverifiedFindings).toHaveLength(0);
    expect(report.limitationsTr.join(' ')).toContain('Kural tabanlı mod');
  });
  it('finds nothing alarming in the benign fixture, without claiming it is safe', async () => {
    const p = prepared('benign.html');
    const report = await runAnalysis(p, async (req) => demoAnalyze(req));
    expect(report.verifiedFindings).toHaveLength(0);
    expect(report.status).toBe('ok');
    expect(report.scoreExplanationTr).toContain('güvenli olduğu anlamına gelmez');
  });
});
