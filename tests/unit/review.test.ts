import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../../src/lib/candidates';
import { analyzeReview } from '../../src/lib/llm/analyze';
import { ChainProvider, ProviderError, type LlmProvider } from '../../src/lib/llm/providers';
import { prepareDocument } from '../../src/lib/pipeline';
import { buildReviewMessage, REVIEW_SYSTEM_PROMPT } from '../../src/lib/prompt';
import { buildReviewRequest, runReview } from '../../src/lib/review';
import { matchingRules } from '../../src/lib/rules';
import { LlmReviewOutputSchema } from '../../src/lib/schema';
import { extractFixture } from '../helpers/dom';
import { ScriptedProvider } from '../helpers/fakes';

const reviewOut = (findings: unknown[], extra: Record<string, unknown> = {}) => ({
  documentType: 'terms_of_service', overallRiskScore: 10, riskLevel: 'low', summaryTr: 'Belgede dikkat edilmesi gereken maddeler var.',
  findings, limitationsTr: [], injectionSuspected: false, needsHumanReview: true, ...extra,
});
const rf = (candidateId: string, over: Record<string, unknown> = {}) => ({
  candidateId, category: 'refunds', concernType: 'financial', severity: 'moderate', titleTr: 'İade yapılmaması',
  explanationTr: 'Bu madde, ödemelerin iade edilmeyeceğini belirtiyor.', potentialImpactTr: 'Ödediğiniz tutarı geri alamayabilirsiniz.',
  confidence: 0.9, uncertaintyTr: null, ...over,
});

describe('Turkish rules', () => {
  it.each([
    ['Aylık abonelik her ay otomatik olarak yenilenir.', 'auto_renewal'],
    ['Tahsil edilen abonelik bedelleri hiçbir koşulda iade edilmez.', 'refunds'],
    ['Kişisel veriler iş ortaklarımız ve reklam verenlerle paylaşılabilir.', 'data_sharing'],
    ['Şirket, sözleşmeyi önceden bildirimde bulunmaksızın tek taraflı olarak değiştirme hakkını saklı tutar.', 'unilateral_changes'],
    ['Şirket, hesabı gerekçe göstermeksizin askıya alabilir.', 'termination_suspension'],
    ['Şirket hiçbir zarardan sorumlu tutulamaz.', 'liability_limitation'],
    ['İstanbul Merkez Mahkemeleri ve İcra Daireleri yetkilidir.', 'jurisdiction'],
  ])('%s → %s', (text, cat) => {
    expect(matchingRules(text).map((r) => r.category)).toContain(cat);
  });
});

describe('candidate selection', () => {
  it('selects exact, ordered, bounded slices of the extracted text', () => {
    const { doc } = extractFixture('turkce-sozlesme.html');
    const sel = selectCandidates(doc);
    expect(sel.candidates.length).toBeGreaterThan(8);
    expect(sel.candidates.length).toBeLessThanOrEqual(30);
    for (const c of sel.candidates) expect(doc.text.slice(c.start, c.end)).toBe(c.text);
    const starts = sel.candidates.map((c) => c.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(sel.candidates.map((c) => c.id)).toEqual(sel.candidates.map((_, i) => `k${i}`));
    expect(sel.candidates.some((c) => c.text.includes('iade edilmez'))).toBe(true);
  });
  it('respects the character budget', () => {
    const { doc } = extractFixture('turkce-sozlesme.html');
    const sel = selectCandidates(doc, [], 30, 500);
    expect(sel.candidates.reduce((a, c) => a + c.text.length, 0)).toBeLessThanOrEqual(500);
  });
});

describe('review schema & prompt', () => {
  it('rejects duplicate candidate ids, bad ids, extra fields and English explanations', () => {
    expect(LlmReviewOutputSchema.safeParse(reviewOut([rf('k1')])).success).toBe(true);
    expect(LlmReviewOutputSchema.safeParse(reviewOut([rf('k1'), rf('k1')])).success).toBe(false);
    expect(LlmReviewOutputSchema.safeParse(reviewOut([rf('risk-1')])).success).toBe(false);
    expect(LlmReviewOutputSchema.safeParse(reviewOut([{ ...rf('k1'), originalQuote: 'x' }])).success).toBe(false);
    expect(LlmReviewOutputSchema.safeParse(reviewOut([rf('k1', { explanationTr: 'This clause means the company will never give your money back.' })])).success).toBe(false);
  });
  it('keeps candidate text out of the system prompt and inside the random boundary', () => {
    const { doc } = extractFixture('injection.html');
    const p = prepareDocument(doc);
    const req = buildReviewRequest(p, selectCandidates(doc).candidates);
    const msg = buildReviewMessage(req, 'abcdefabcdefabcdef');
    expect(REVIEW_SYSTEM_PROMPT).not.toContain('ShopSphere');
    const inside = msg.split('<<<UNTRUSTED_CANDIDATES_START abcdefabcdefabcdef>>>')[1]!.split('<<<UNTRUSTED_CANDIDATES_END abcdefabcdefabcdef>>>')[0]!;
    for (const c of req.candidates) expect(inside).toContain(c.text.replace(/\s+/g, ' '));
  });
});

describe('runReview', () => {
  const { doc } = extractFixture('turkce-sozlesme.html', 'https://www.kitapkutusu.example/kullanici-sozlesmesi');
  const p = prepareDocument(doc);

  it('maps ids to exact text, verifies them and scores deterministically', async () => {
    const sel = selectCandidates(doc);
    const refund = sel.candidates.find((c) => c.text.includes('iade edilmez'))!;
    const { report, info } = await runReview(p, async () => ({ ok: true, attempts: 1, provider: 'groq', model: 'm', output: reviewOut([rf(refund.id)]) }));
    expect(info.usedFallback).toBe(false);
    expect(report.mode).toBe('llm');
    expect(report.verifiedFindings).toHaveLength(1);
    expect(report.verifiedFindings[0]!.originalQuote).toBe(refund.text);
    expect(report.verifiedFindings[0]!.sourceSection).toBe('2. Ücretler ve İade');
    expect(report.overallRiskScore).toBeGreaterThan(0);
  });
  it('never shows an invented id as a risk', async () => {
    const { report } = await runReview(p, async () => ({ ok: true, attempts: 1, provider: 'groq', model: 'm', output: reviewOut([rf('k99', { severity: 'critical' })]) }));
    expect(report.verifiedFindings).toHaveLength(0);
    expect(report.unverifiedFindings).toHaveLength(1);
  });
  it('falls back to rules (labelled) when the LLM fails, and still finds Turkish risks', async () => {
    const { report, info } = await runReview(p, async () => ({ ok: false, attempts: 3, provider: 'groq', model: 'm', errorCode: 'rate_limited', errorMessage: 'Sağlayıcı hız sınırı (429).' }));
    expect(info.usedFallback).toBe(true);
    expect(report.mode).toBe('demo');
    expect(report.limitationsTr[0]).toContain('rate_limited');
    const cats = report.verifiedFindings.map((f) => f.category);
    expect(cats).toEqual(expect.arrayContaining(['auto_renewal', 'refunds', 'data_sharing', 'unilateral_changes']));
  });
  it('falls back to rules when the reviewer throws or returns garbage', async () => {
    expect((await runReview(p, async () => { throw new Error('ağ hatası'); })).info.usedFallback).toBe(true);
    expect((await runReview(p, async () => ({ nonsense: true }))).info.usedFallback).toBe(true);
  });
});

describe('analyzeReview + provider chain', () => {
  const { doc } = extractFixture('turkce-sozlesme.html');
  const req = buildReviewRequest(prepareDocument(doc), selectCandidates(doc).candidates);

  it('one call with valid output', async () => {
    const prov = new ScriptedProvider([JSON.stringify(reviewOut([rf('k1')]))]);
    const r = await analyzeReview(prov, req, { sleep: async () => undefined });
    expect(r.ok).toBe(true);
    expect(prov.calls).toHaveLength(1);
  });
  it('falls through to the next provider on 404/429 and reports which one answered', async () => {
    const failing: LlmProvider = { name: 'groq', model: 'gone', complete: async () => { throw new ProviderError('provider_error', 'Model bulunamadı (404)', null, 404); } };
    const limited: LlmProvider = { name: 'groq2', model: 'busy', complete: async () => { throw new ProviderError('rate_limited', '429', 5000, 429); } };
    const ok: LlmProvider = { name: 'gemini', model: 'g', complete: async () => ({ content: JSON.stringify(reviewOut([])) }) };
    const r = await analyzeReview(new ChainProvider([failing, limited, ok]), req, { sleep: async () => undefined });
    expect(r).toMatchObject({ ok: true, provider: 'gemini', model: 'g' });
  });
  it('re-throws the last error so rate-limit waits still apply', async () => {
    const waits: number[] = [];
    let n = 0;
    const flaky: LlmProvider = { name: 'only', model: 'm', complete: async () => { if (n++ < 2) throw new ProviderError('rate_limited', '429', 1234, 429); return { content: JSON.stringify(reviewOut([])) }; } };
    const r = await analyzeReview(new ChainProvider([flaky]), req, { sleep: async (ms) => void waits.push(ms) });
    expect(r.ok).toBe(true);
    expect(waits).toEqual([1234, 1234]);
  });
});

describe('Turkish case folding', () => {
  it('matches sentence-initial capital İ (İade, İşbu)', () => {
    expect(matchingRules('İade yapılmaz ve ücretler geri ödenmez.').map((r) => r.category)).toContain('refunds');
  });
  it('keeps English upper-case rules working', () => {
    expect(matchingRules('IN NO EVENT SHALL THE COMPANY BE LIABLE FOR DAMAGES.').map((r) => r.category)).toContain('liability_limitation');
  });
});
