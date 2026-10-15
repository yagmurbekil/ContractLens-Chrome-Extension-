import { z } from 'zod';
import { LIMITS } from './config';
import { isAcceptableTurkish } from './language';

export const DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
  'subscription_terms',
  'cookie_policy',
  'refund_policy',
  'data_processing',
  'eula',
  'other_legal',
  'not_legal',
  'unknown',
] as const;

export const RISK_LEVELS = ['low', 'moderate', 'high', 'critical'] as const;
export const SEVERITIES = ['low', 'moderate', 'high', 'critical'] as const;

/**
 * Risk categories. `concernType` separately distinguishes privacy,
 * financial, contractual, unfavourable-term and uncertainty concerns, so the
 * UI never presents "unusual" as "illegal".
 */
export const CATEGORIES = [
  'data_collection',
  'data_sharing',
  'data_retention',
  'tracking_cookies',
  'ai_training',
  'auto_renewal',
  'cancellation',
  'refunds',
  'price_changes',
  'unilateral_changes',
  'termination_suspension',
  'liability_limitation',
  'indemnification',
  'arbitration_class_waiver',
  'jurisdiction',
  'content_license',
  'warranty_disclaimer',
  'other',
] as const;

export const CONCERN_TYPES = ['privacy', 'financial', 'contractual', 'unfavorable_term', 'uncertainty'] as const;

const turkish = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isAcceptableTurkish, { message: `${label} Türkçe olmalıdır` });

/** One finding exactly as the LLM must return it. */
export const LlmFindingSchema = z.strictObject({
  id: z.string().regex(/^risk-\d{3}$/),
  category: z.enum(CATEGORIES),
  concernType: z.enum(CONCERN_TYPES),
  severity: z.enum(SEVERITIES),
  titleTr: turkish(LIMITS.maxTitleChars, 'titleTr'),
  originalQuote: z.string().trim().min(LIMITS.minQuoteChars).max(LIMITS.maxQuoteChars),
  explanationTr: turkish(LIMITS.maxExplanationChars, 'explanationTr'),
  potentialImpactTr: turkish(LIMITS.maxExplanationChars, 'potentialImpactTr'),
  sourceSection: z.string().trim().max(LIMITS.maxSectionChars).nullable(),
  startOffset: z.number().int().nonnegative().nullable(),
  endOffset: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  uncertaintyTr: turkish(LIMITS.maxExplanationChars, 'uncertaintyTr').nullable(),
});

/**
 * Complete LLM response for one chunk. overallRiskScore / riskLevel are
 * required and validated, but application code IGNORES them: the final
 * score is always computed deterministically from verified findings.
 */
export const LlmChunkOutputSchema = z
  .strictObject({
    documentType: z.enum(DOCUMENT_TYPES),
    overallRiskScore: z.number().int().min(0).max(100),
    riskLevel: z.enum(RISK_LEVELS),
    summaryTr: turkish(LIMITS.maxSummaryChars, 'summaryTr'),
    findings: z.array(LlmFindingSchema).max(LIMITS.maxFindingsPerChunk),
    limitationsTr: z.array(turkish(LIMITS.maxLimitationChars, 'limitationsTr')).max(LIMITS.maxLimitations),
    injectionSuspected: z.boolean(),
    needsHumanReview: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    v.findings.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: 'custom', path: ['findings', i, 'id'], message: 'Yinelenen id' });
      ids.add(f.id);
      if (f.startOffset !== null && f.endOffset !== null && f.endOffset <= f.startOffset) {
        ctx.addIssue({ code: 'custom', path: ['findings', i, 'endOffset'], message: 'endOffset > startOffset olmalı' });
      }
    });
  });

export type LlmFinding = z.infer<typeof LlmFindingSchema>;
export type LlmChunkOutput = z.infer<typeof LlmChunkOutputSchema>;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Extraction (content script → backend) contracts
// ---------------------------------------------------------------------------

export const ChunkSchema = z.strictObject({
  id: z.string().regex(/^c\d{1,4}$/),
  heading: z.string().max(LIMITS.maxSectionChars).nullable(),
  text: z.string().min(1).max(20000),
  /** Character offsets of this chunk inside ExtractedDocument.text. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const AnalyzeRequestSchema = z.strictObject({
  url: z.string().url().max(2048),
  title: z.string().max(500),
  documentTypeHint: z.enum(DOCUMENT_TYPES),
  language: z.string().max(20).nullable(),
  chunks: z.array(ChunkSchema).min(1).max(LIMITS.maxChunksPerRequest),
});

export type Chunk = z.infer<typeof ChunkSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ChunkResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ chunkId: z.string(), ok: z.literal(true), attempts: z.number().int(), output: LlmChunkOutputSchema }),
  z.strictObject({
    chunkId: z.string(),
    ok: z.literal(false),
    attempts: z.number().int(),
    errorCode: z.enum(['validation_failed', 'provider_error', 'timeout', 'rate_limited', 'refused']),
    errorMessage: z.string().max(500),
  }),
]);

export const AnalyzeResponseSchema = z.strictObject({
  mode: z.enum(['llm', 'demo']),
  provider: z.string(),
  model: z.string(),
  results: z.array(ChunkResultSchema),
});

export type ChunkResult = z.infer<typeof ChunkResultSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

// ---------------------------------------------------------------------------
// Final report (computed by application code, rendered by the UI)
// ---------------------------------------------------------------------------

export const EVIDENCE_STATUSES = ['verified', 'unverified_not_found', 'unverified_ambiguous', 'unverified_altered'] as const;

export const ReportFindingSchema = z.strictObject({
  id: z.string(),
  chunkId: z.string(),
  category: z.enum(CATEGORIES),
  concernType: z.enum(CONCERN_TYPES),
  severity: z.enum(SEVERITIES),
  titleTr: z.string(),
  originalQuote: z.string(),
  explanationTr: z.string(),
  potentialImpactTr: z.string(),
  sourceSection: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  uncertaintyTr: z.string().nullable(),
  evidence: z.strictObject({
    status: z.enum(EVIDENCE_STATUSES),
    /** Offsets into ExtractedDocument.text (original, not normalized). */
    docStart: z.number().int().nullable(),
    docEnd: z.number().int().nullable(),
    offsetCheck: z.enum(['match', 'corrected', 'not_provided', 'not_applicable']),
    detailTr: z.string(),
  }),
  scoreContribution: z.number(),
});

export const ReportSchema = z.strictObject({
  version: z.literal(1),
  url: z.string(),
  domain: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  mode: z.enum(['llm', 'demo']),
  provider: z.string(),
  model: z.string(),
  documentType: z.enum(DOCUMENT_TYPES),
  status: z.enum(['ok', 'insufficient_data', 'uncertain', 'failed']),
  overallRiskScore: z.number().int().min(0).max(100).nullable(),
  riskLevel: z.enum(RISK_LEVELS).nullable(),
  scoreExplanationTr: z.string(),
  summaryTr: z.string(),
  verifiedFindings: z.array(ReportFindingSchema),
  unverifiedFindings: z.array(ReportFindingSchema),
  limitationsTr: z.array(z.string()),
  unclearTermsTr: z.array(z.string()),
  security: z.strictObject({
    injectionDetected: z.boolean(),
    signals: z.array(z.strictObject({ kind: z.string(), excerpt: z.string(), location: z.enum(['visible', 'hidden', 'comment', 'attribute']) })),
    modelFlagged: z.boolean(),
  }),
  coverage: z.strictObject({
    extractedChars: z.number().int(),
    analyzedChars: z.number().int(),
    chunksTotal: z.number().int(),
    chunksAnalyzed: z.number().int(),
    chunksFailed: z.number().int(),
    schemaFailures: z.number().int(),
  }),
  needsHumanReview: z.boolean(),
  disclaimerTr: z.string(),
});

export type ReportFinding = z.infer<typeof ReportFindingSchema>;
export type Report = z.infer<typeof ReportSchema>;

// ---------------------------------------------------------------------------
// Review strategy (default): the rule engine picks numbered candidate clauses
// from the extracted DOM text; the LLM reviews them in ONE request and refers
// to them only by id. Candidate texts are exact slices of the extracted text.
// ---------------------------------------------------------------------------

export const CandidateSchema = z.strictObject({
  id: z.string().regex(/^k\d{1,3}$/),
  text: z.string().min(1).max(LIMITS.maxQuoteChars),
  heading: z.string().max(LIMITS.maxSectionChars).nullable(),
  /** Offsets inside ExtractedDocument.text (client-side bookkeeping, also sent for traceability). */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** Categories suggested by the rule engine (hints only). */
  ruleHints: z.array(z.enum(CATEGORIES)).max(6),
});

export const ReviewRequestSchema = z.strictObject({
  url: z.string().url().max(2048),
  title: z.string().max(500),
  documentTypeHint: z.enum(DOCUMENT_TYPES),
  language: z.string().max(20).nullable(),
  candidates: z.array(CandidateSchema).min(1).max(LIMITS.maxCandidates),
});

export const LlmReviewFindingSchema = z.strictObject({
  candidateId: z.string().regex(/^k\d{1,3}$/),
  category: z.enum(CATEGORIES),
  concernType: z.enum(CONCERN_TYPES),
  severity: z.enum(SEVERITIES),
  titleTr: turkish(LIMITS.maxTitleChars, 'titleTr'),
  explanationTr: turkish(LIMITS.maxExplanationChars, 'explanationTr'),
  potentialImpactTr: turkish(LIMITS.maxExplanationChars, 'potentialImpactTr'),
  confidence: z.number().min(0).max(1),
  uncertaintyTr: turkish(LIMITS.maxExplanationChars, 'uncertaintyTr').nullable(),
});

export const LlmReviewOutputSchema = z
  .strictObject({
    documentType: z.enum(DOCUMENT_TYPES),
    overallRiskScore: z.number().int().min(0).max(100),
    riskLevel: z.enum(RISK_LEVELS),
    summaryTr: turkish(LIMITS.maxSummaryChars, 'summaryTr'),
    findings: z.array(LlmReviewFindingSchema).max(LIMITS.maxCandidates),
    limitationsTr: z.array(turkish(LIMITS.maxLimitationChars, 'limitationsTr')).max(LIMITS.maxLimitations),
    injectionSuspected: z.boolean(),
    needsHumanReview: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.findings.forEach((f, i) => {
      if (seen.has(f.candidateId)) ctx.addIssue({ code: 'custom', path: ['findings', i, 'candidateId'], message: 'Aynı aday iki kez raporlandı' });
      seen.add(f.candidateId);
    });
  });

export const ReviewResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), attempts: z.number().int(), provider: z.string(), model: z.string(), output: LlmReviewOutputSchema }),
  z.strictObject({
    ok: z.literal(false),
    attempts: z.number().int(),
    provider: z.string(),
    model: z.string(),
    errorCode: z.enum(['validation_failed', 'provider_error', 'timeout', 'rate_limited', 'refused']),
    errorMessage: z.string().max(500),
  }),
]);

export type Candidate = z.infer<typeof CandidateSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type LlmReviewOutput = z.infer<typeof LlmReviewOutputSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
