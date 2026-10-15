import type { AnalyzeRequest, AnalyzeResponse, LlmChunkOutput, LlmFinding } from '../schema';
import { LIMITS } from '../config';
import { RULES, ruleMatches, sentences } from '../rules';

/**
 * RULE-BASED MODE — deterministic clause spotter (EN + TR rules in ../rules.ts).
 *
 * This is NOT an LLM and is always labelled "Kural tabanlı mod" in the UI and in
 * the report (mode: "demo"). It exists so the extension, tests and Cypress
 * demo work without any API key. Its findings still go through the exact
 * same schema validation, quote verification and scoring as LLM output.
 */

export function demoAnalyzeChunk(text: string, docType: LlmChunkOutput['documentType']): LlmChunkOutput {
  const findings: LlmFinding[] = [];
  const usedRules = new Set<number>();
  for (const { s, e } of sentences(text)) {
    if (findings.length >= LIMITS.maxFindingsPerChunk) break;
    const sentence = text.slice(s, Math.min(e, s + LIMITS.maxQuoteChars));
    const idx = RULES.findIndex((r, i) => !usedRules.has(i) && ruleMatches(r, sentence));
    if (idx === -1) continue;
    usedRules.add(idx);
    const r = RULES[idx]!;
    findings.push({
      id: `risk-${String(findings.length + 1).padStart(3, '0')}`,
      category: r.category,
      concernType: r.concernType,
      severity: r.severity,
      titleTr: r.titleTr,
      originalQuote: sentence,
      explanationTr: r.explanationTr,
      potentialImpactTr: r.potentialImpactTr,
      sourceSection: null,
      startOffset: s,
      endOffset: s + sentence.length,
      confidence: r.confidence,
      uncertaintyTr: 'Kural tabanlı mod yalnızca anahtar kelime eşleştirmesi yapar; maddenin bağlamı değerlendirilmedi.',
    });
  }
  return {
    documentType: docType,
    overallRiskScore: 0,
    riskLevel: 'low',
    summaryTr: findings.length
      ? `Kural motoru ${findings.length} olası dikkat noktası buldu. Bu sonuçlar bir yapay zekâ analizi değildir.`
      : 'Kural motoru bu bölümde anahtar kelimeye dayalı bir dikkat noktası bulamadı. Bu, metnin risksiz olduğu anlamına gelmez.',
    findings: findings.sort((a, b) => ['critical', 'high', 'moderate', 'low'].indexOf(a.severity) - ['critical', 'high', 'moderate', 'low'].indexOf(b.severity)),
    limitationsTr: ['Kural tabanlı mod: anahtar kelime eşleştirmesi, yapay zekâ analizi değildir.'],
    injectionSuspected: false,
    needsHumanReview: true,
  };
}

export function demoAnalyze(req: AnalyzeRequest): AnalyzeResponse {
  return {
    mode: 'demo',
    provider: 'demo-rules',
    model: 'keyword-rules-v1',
    results: req.chunks.map((c) => ({ chunkId: c.id, ok: true as const, attempts: 1, output: demoAnalyzeChunk(c.text, req.documentTypeHint) })),
  };
}
