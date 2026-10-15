import { selectCandidates } from './candidates';
import { demoAnalyze } from './llm/demo';
import { buildAnalyzeRequests, type PreparedDocument } from './pipeline';
import { buildReport } from './report';
import { ReviewResultSchema, type AnalyzeResponse, type Candidate, type ChunkResult, type DocumentType, type LlmChunkOutput, type LlmFinding, type Report, type ReviewRequest } from './schema';

/**
 * Default analysis strategy ("review"):
 *   1. rules pick ≤ 40 candidate clauses from the whole extracted text (exact slices),
 *   2. ONE LLM request classifies/explains them by id,
 *   3. every selected id is mapped back to its exact text and verified like any quote,
 *   4. if the LLM is unavailable or fails validation, the report falls back to the
 *      rule-based engine — clearly labelled — instead of failing.
 */

export type Reviewer = (req: ReviewRequest) => Promise<unknown>;

export function buildReviewRequest(p: PreparedDocument, candidates: Candidate[], typeOverride?: DocumentType): ReviewRequest {
  return {
    url: p.doc.url,
    title: p.doc.title.slice(0, 500),
    documentTypeHint: typeOverride ?? p.classification.type,
    language: p.doc.language,
    candidates,
  };
}

function rulesResponse(p: PreparedDocument, typeOverride?: DocumentType): AnalyzeResponse {
  const merged: AnalyzeResponse = { mode: 'demo', provider: 'rules', model: 'keyword-rules-v2', results: [] };
  for (const req of buildAnalyzeRequests({ ...p, selected: p.chunks }, typeOverride)) merged.results.push(...demoAnalyze(req).results);
  return merged;
}

/** Converts a validated review into per-chunk results so the standard verification/scoring applies. */
export function reviewToResponse(p: PreparedDocument, candidates: Candidate[], output: Extract<import('./schema').ReviewResult, { ok: true }>): AnalyzeResponse {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const perChunk = new Map<string, LlmFinding[]>(p.chunks.map((c) => [c.id, []]));
  const o = output.output;
  for (const f of o.findings) {
    const cand = byId.get(f.candidateId);
    const chunk = cand ? p.chunks.find((c) => c.start <= cand.start && cand.end <= c.end) : p.chunks[0];
    if (!chunk) continue;
    const list = perChunk.get(chunk.id)!;
    list.push({
      id: `risk-${String(list.length + 1).padStart(3, '0')}`,
      category: f.category,
      concernType: f.concernType,
      severity: f.severity,
      titleTr: f.titleTr,
      // Unknown ids get a placeholder that can never verify → shown as "unverified", never as a risk.
      originalQuote: cand ? cand.text : `Model listede olmayan bir aday numarası döndürdü: ${f.candidateId}`,
      explanationTr: f.explanationTr,
      potentialImpactTr: f.potentialImpactTr,
      sourceSection: cand?.heading ?? null,
      startOffset: cand ? cand.start - chunk.start : null,
      endOffset: cand ? cand.end - chunk.start : null,
      confidence: f.confidence,
      uncertaintyTr: f.uncertaintyTr,
    });
  }
  const results: ChunkResult[] = p.chunks.map((c, i) => {
    const out: LlmChunkOutput = {
      documentType: o.documentType,
      overallRiskScore: o.overallRiskScore,
      riskLevel: o.riskLevel,
      summaryTr: o.summaryTr,
      findings: perChunk.get(c.id)!,
      limitationsTr: i === 0 ? o.limitationsTr : [],
      injectionSuspected: o.injectionSuspected,
      needsHumanReview: o.needsHumanReview,
    };
    return { chunkId: c.id, ok: true, attempts: output.attempts, output: out };
  });
  return { mode: 'llm', provider: output.provider, model: output.model, results };
}

export interface ReviewRunInfo {
  candidates: number;
  sentencesScanned: number;
  usedFallback: boolean;
  fallbackReason?: string;
}

export async function runReview(
  p: PreparedDocument,
  reviewer: Reviewer | null,
  opts: { typeOverride?: DocumentType; priorityHeadings?: string[] } = {},
): Promise<{ report: Report; info: ReviewRunInfo }> {
  const sel = selectCandidates(p.doc, opts.priorityHeadings);
  const candChars = sel.candidates.reduce((a, c) => a + c.text.length, 0);
  const extra: string[] = [];
  let response: AnalyzeResponse;
  let usedFallback = false;
  let fallbackReason: string | undefined;

  if (!reviewer) {
    response = rulesResponse(p, opts.typeOverride);
  } else if (sel.candidates.length === 0) {
    response = rulesResponse(p, opts.typeOverride);
    extra.push('Kurallar ve anahtar kelimeler değerlendirilecek aday madde bulamadı; LLM\'e madde gönderilmedi. Bu, belgenin risksiz olduğu anlamına gelmez.');
  } else {
    let raw: unknown;
    let err: string | null = null;
    try {
      raw = await reviewer(buildReviewRequest(p, sel.candidates, opts.typeOverride));
    } catch (e) {
      err = (e as Error).message;
    }
    const parsed = err ? null : ReviewResultSchema.safeParse(raw);
    if (parsed?.success && parsed.data.ok) {
      response = reviewToResponse(p, sel.candidates, parsed.data);
      extra.push(`LLM, kural motorunun ${sel.sentencesScanned} cümle arasından seçtiği ${sel.candidates.length} aday maddeyi değerlendirdi; seçilmeyen maddeler LLM tarafından incelenmedi.`);
    } else {
      usedFallback = true;
      fallbackReason = err ?? (parsed?.success && !parsed.data.ok ? `${parsed.data.errorCode}: ${parsed.data.errorMessage}` : 'Sunucu yanıtı şema doğrulamasından geçmedi.');
      response = rulesResponse(p, opts.typeOverride);
      extra.push(`LLM analizi yapılamadı (${fallbackReason.replace(/\s+/g, ' ').slice(0, 200)}). Gösterilen sonuç kural tabanlıdır.`);
    }
  }

  const report = buildReport({
    doc: p.doc,
    classification: p.classification,
    allChunks: p.chunks,
    analyzedChunks: p.chunks,
    response,
    injectionSignals: p.injectionSignals,
    extraLimitations: extra,
    analyzedCharsOverride: response.mode === 'llm' ? candChars : undefined,
  });
  return { report, info: { candidates: sel.candidates.length, sentencesScanned: sel.sentencesScanned, usedFallback, fallbackReason } };
}
