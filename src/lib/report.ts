import { DISCLAIMER_TR, LIMITS, SEVERITY_POINTS, SUFFICIENCY } from './config';
import type { Classification } from './detect';
import { sectionAt, type ExtractedDocument } from './extract';
import type { InjectionSignal } from './injection';
import {
  ReportSchema,
  type AnalyzeResponse,
  type Chunk,
  type DocumentType,
  type Report,
  type ReportFinding,
} from './schema';
import { computeScore, RISK_LEVEL_TR } from './score';
import { verifyQuote } from './verify';

export interface BuildReportInput {
  doc: Pick<ExtractedDocument, 'url' | 'title' | 'text' | 'stats'> & { sections?: ExtractedDocument['sections'] };
  classification: Classification;
  allChunks: Chunk[];
  analyzedChunks: Chunk[];
  response: AnalyzeResponse;
  injectionSignals: InjectionSignal[];
  now?: Date;
  /** Limitations added by the caller (shown first), e.g. review strategy notes or LLM fallback reasons. */
  extraLimitations?: string[];
  /** Characters actually shown to the analyzer when it differs from the chunk total (review strategy). */
  analyzedCharsOverride?: number;
}

function overlapRatio(a: ReportFinding, b: ReportFinding): number {
  if (a.evidence.docStart === null || b.evidence.docStart === null) return 0;
  const s = Math.max(a.evidence.docStart, b.evidence.docStart);
  const e = Math.min(a.evidence.docEnd!, b.evidence.docEnd!);
  if (e <= s) return 0;
  const shorter = Math.min(a.evidence.docEnd! - a.evidence.docStart, b.evidence.docEnd! - b.evidence.docStart);
  return (e - s) / Math.max(1, shorter);
}

/** Remove duplicates produced by overlapping chunks or repeated model findings. */
export function dedupeVerified(findings: ReportFinding[]): ReportFinding[] {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_POINTS[b.severity] - SEVERITY_POINTS[a.severity] || b.confidence - a.confidence,
  );
  const kept: ReportFinding[] = [];
  for (const f of sorted) {
    const dup = kept.find((k) => overlapRatio(k, f) >= 0.5 && (k.category === f.category || overlapRatio(k, f) >= 0.9));
    if (!dup) kept.push(f);
  }
  return kept;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function majorityType(types: DocumentType[], fallback: DocumentType): DocumentType {
  const counts = new Map<DocumentType, number>();
  for (const t of types) if (t !== 'unknown') counts.set(t, (counts.get(t) ?? 0) + 1);
  let best: DocumentType = fallback;
  let n = 0;
  for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  return best;
}

export function buildReport(input: BuildReportInput): Report {
  const { doc, classification, allChunks, analyzedChunks, response, injectionSignals } = input;
  const chunkById = new Map(analyzedChunks.map((c) => [c.id, c]));
  const verified: ReportFinding[] = [];
  const unverified: ReportFinding[] = [];
  const limitations = new Set<string>(input.extraLimitations ?? []);
  const summaries: string[] = [];
  const modelTypes: DocumentType[] = [];
  let modelFlagged = false;
  let modelReview = false;
  let okChunks = 0;
  let schemaFailures = 0;
  let totalModelFindings = 0;

  for (const r of response.results) {
    if (!r.ok) {
      if (r.errorCode === 'validation_failed') schemaFailures++;
      continue;
    }
    const chunk = chunkById.get(r.chunkId);
    if (!chunk) continue; // result for a chunk we never sent: ignore
    okChunks++;
    const o = r.output;
    modelTypes.push(o.documentType);
    if (o.summaryTr) summaries.push(o.summaryTr);
    o.limitationsTr.forEach((l) => limitations.add(l));
    modelFlagged ||= o.injectionSuspected;
    modelReview ||= o.needsHumanReview;
    for (const f of o.findings) {
      totalModelFindings++;
      const evidence = verifyQuote(f, chunk);
      const rf: ReportFinding = {
        id: `${r.chunkId}-${f.id}`,
        chunkId: r.chunkId,
        category: f.category,
        concernType: f.concernType,
        severity: f.severity,
        titleTr: f.titleTr,
        originalQuote: f.originalQuote.trim(),
        explanationTr: f.explanationTr,
        potentialImpactTr: f.potentialImpactTr,
        // For verified quotes the section is derived deterministically from the DOM headings.
        sourceSection:
          (evidence.status === 'verified' && doc.sections ? sectionAt(doc.sections, evidence.docStart!)?.heading : null) ??
          f.sourceSection ??
          chunk.heading,
        confidence: f.confidence,
        uncertaintyTr: f.uncertaintyTr,
        evidence,
        scoreContribution: 0,
      };
      (evidence.status === 'verified' ? verified : unverified).push(rf);
    }
  }

  const deduped = dedupeVerified(verified).slice(0, LIMITS.maxFindingsPerReport);
  const { score, level, contributions } = computeScore(deduped);
  for (const f of deduped) f.scoreContribution = contributions.get(f.id) ?? 0;
  deduped.sort((a, b) => SEVERITY_POINTS[b.severity] - SEVERITY_POINTS[a.severity] || b.scoreContribution - a.scoreContribution);

  const documentType = majorityType(modelTypes, classification.type);
  const chunksFailed = response.results.filter((r) => !r.ok).length;
  const successRatio = analyzedChunks.length ? okChunks / analyzedChunks.length : 0;
  const unverifiedRatio = totalModelFindings ? unverified.length / totalModelFindings : 0;
  const tooShort = doc.stats.chars < SUFFICIENCY.minChars || doc.stats.words < SUFFICIENCY.minWords;
  const analyzedChars = input.analyzedCharsOverride ?? analyzedChunks.reduce((a, c) => a + c.text.length, 0);

  let status: Report['status'] = 'ok';
  if (okChunks === 0) status = 'failed';
  else if (tooShort || documentType === 'not_legal') status = 'insufficient_data';
  else if (successRatio < SUFFICIENCY.minChunkSuccessRatio || (totalModelFindings >= 3 && unverifiedRatio > SUFFICIENCY.maxUnverifiedRatio)) status = 'uncertain';
  // An injection attempt combined with "nothing found" may mean the model was steered into omitting risks.
  else if ((injectionSignals.length > 0 || modelFlagged) && deduped.length === 0) status = 'uncertain';

  if ((injectionSignals.length > 0 || modelFlagged) && deduped.length === 0 && okChunks > 0) {
    limitations.add('Sayfada istem enjeksiyonu girişimi var ve doğrulanmış bulgu yok; sonuç manipüle edilmiş olabilir. Belgeyi kendiniz inceleyin.');
  }

  if (tooShort) limitations.add('Çıkarılan metin çok kısa; sayfa belgenin yalnızca bir bölümünü içeriyor olabilir.');
  if (documentType === 'not_legal') limitations.add('Sayfa bir hukuki belge gibi görünmüyor.');
  if (analyzedChunks.length < allChunks.length) {
    limitations.add(`Belgenin tamamı analiz edilmedi: ${allChunks.length} bölümden en ilgili ${analyzedChunks.length} tanesi gönderildi.`);
  }
  if (chunksFailed) {
    limitations.add(`${chunksFailed} metin bölümü analiz edilemedi (doğrulama veya sağlayıcı hatası).`);
    // Show the first distinct failure reasons so the user (and developer) can see what went wrong.
    const reasons = new Map<string, string>();
    for (const r of response.results) if (!r.ok && !reasons.has(r.errorCode)) reasons.set(r.errorCode, r.errorMessage);
    for (const [code, msg] of [...reasons].slice(0, 3)) limitations.add(`Hata (${code}): ${msg.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
  if (unverified.length) limitations.add(`${unverified.length} model bulgusunun alıntısı kaynakta doğrulanamadı ve risk olarak gösterilmedi.`);
  if (response.mode === 'demo') limitations.add('Kural tabanlı mod: Bulgular LLM tarafından değil, anahtar kelime kurallarıyla üretildi (bağlam değerlendirilmedi).');

  const showScore = status === 'ok' || status === 'uncertain';
  let scoreExplanationTr: string;
  if (status === 'failed') scoreExplanationTr = 'Analiz tamamlanamadı; puan hesaplanmadı.';
  else if (status === 'insufficient_data') scoreExplanationTr = 'Yetersiz veri: Güvenilir bir puan hesaplamak için yeterli hukuki metin yok.';
  else if (deduped.length === 0)
    scoreExplanationTr = 'Doğrulanmış riskli madde bulunamadı. Bu, belgenin güvenli olduğu anlamına gelmez; analiz bazı maddeleri kaçırmış olabilir.';
  else
    scoreExplanationTr = `Puan, sözleşme metninde birebir bulunan ${deduped.length} maddeye ve bu maddelerin ne kadar ciddi olduğuna göre hesaplandı. Seviye: ${RISK_LEVEL_TR[level]}. Bu puan bir şeyin yasa dışı olduğunu göstermez; aleyhinize olabilecek maddelerin ne kadar yoğun olduğunu gösterir.`;
  if (status === 'uncertain') scoreExplanationTr = `Analiz belirsiz: ${scoreExplanationTr} Puanı bir alt sınır olarak yorumlayın.`;

  const unclearTermsTr = [
    // In rule-based mode every finding carries the same generic caveat; it is stated once in the limitations instead.
    ...(response.mode === 'demo' ? [] : deduped.filter((f) => f.uncertaintyTr).map((f) => `${f.titleTr}: ${f.uncertaintyTr}`)),
    ...unverified.map((f) => `Doğrulanamayan gözlem — ${f.titleTr}`),
  ].slice(0, 20);

  const report: Report = {
    version: 1,
    url: doc.url,
    domain: domainOf(doc.url),
    title: doc.title,
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: response.mode,
    provider: response.provider,
    model: response.model,
    documentType,
    status,
    overallRiskScore: showScore ? score : null,
    riskLevel: showScore ? level : null,
    scoreExplanationTr,
    summaryTr: summaries[0] ?? '',
    verifiedFindings: deduped,
    unverifiedFindings: unverified.slice(0, LIMITS.maxFindingsPerReport),
    limitationsTr: [...limitations].slice(0, 15),
    unclearTermsTr,
    security: {
      injectionDetected: injectionSignals.length > 0 || modelFlagged,
      signals: injectionSignals.map((s) => ({ kind: s.kind, excerpt: s.excerpt, location: s.location })),
      modelFlagged,
    },
    coverage: {
      extractedChars: doc.stats.chars,
      analyzedChars,
      chunksTotal: allChunks.length,
      chunksAnalyzed: okChunks,
      chunksFailed,
      schemaFailures,
    },
    needsHumanReview:
      modelReview || status !== 'ok' || injectionSignals.length > 0 || deduped.some((f) => f.severity === 'high' || f.severity === 'critical'),
    disclaimerTr: DISCLAIMER_TR,
  };
  return ReportSchema.parse(report);
}
