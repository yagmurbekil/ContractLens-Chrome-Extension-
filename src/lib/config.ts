/**
 * Single source of truth for every tunable constant used by scoring,
 * verification, chunking and limits. Changing a value here changes
 * behaviour everywhere (extension, backend, evaluation, tests).
 */

export const SEVERITY_POINTS = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
} as const;

/** Score → level thresholds (inclusive lower bounds). */
export const RISK_THRESHOLDS = [
  { min: 75, level: 'critical' },
  { min: 50, level: 'high' },
  { min: 25, level: 'moderate' },
  { min: 0, level: 'low' },
] as const;

export const SCORING = {
  /** Saturation constant k in score = 100 * (1 - e^(-R / k)). */
  saturationK: 8,
  /** Weight multiplier for the n-th finding inside the same category (n = 0, 1, 2, ...). */
  categoryDecay: 0.5,
  /** confidenceFactor = base + (1 - base) * confidence */
  confidenceBase: 0.5,
  /** Evidence quality multipliers. Only verified evidence ever scores. */
  evidenceQuality: { exact: 1.0, exact_offset_corrected: 0.9 },
} as const;

export const SUFFICIENCY = {
  /** Fewer characters than this → "Yetersiz veri". */
  minChars: 1200,
  /** Fewer words than this → "Yetersiz veri". */
  minWords: 180,
  /** Share of chunks that must be analysed successfully. */
  minChunkSuccessRatio: 0.75,
  /** If more than this share of model findings fail verification → "Analiz belirsiz". */
  maxUnverifiedRatio: 0.4,
  /** Document classification confidence below which the user must confirm. */
  minClassificationConfidence: 0.45,
} as const;

export const CHUNKING = {
  maxChunkChars: 6000,
  overlapChars: 400,
  /** Hard cap on characters sent to the LLM for one document. */
  maxAnalyzedChars: 30000, // ~5 chunks: fits free-tier LLM token-per-minute limits (e.g. Groq 12k TPM)
} as const;

export const LIMITS = {
  maxFindingsPerChunk: 12,
  maxFindingsPerReport: 40,
  maxQuoteChars: 600,
  minQuoteChars: 20,
  maxTitleChars: 120,
  maxExplanationChars: 700,
  maxSummaryChars: 800,
  maxLimitations: 8,
  maxLimitationChars: 300,
  maxSectionChars: 200,
  maxChunksPerRequest: 8,
  /** Review strategy: max candidate clauses and their total size sent in the single LLM request. */
  maxCandidates: 40,
  maxCandidateChars: 12000,
  maxRequestBytes: 400_000,
} as const;

export const LLM_RUNTIME = {
  requestTimeoutMs: 60_000,
  maxValidationRetries: 2,
  maxNetworkRetries: 2,
} as const;

export const DISCLAIMER_TR =
  'ContractLens hukuki tavsiye vermez. Analiz, otomatik metin değerlendirmesine dayanır ve hata içerebilir. Önemli kararlar için orijinal sözleşmeyi inceleyin ve gerektiğinde bir hukuk uzmanına danışın.';

export const DEFAULT_BACKEND_URL = 'http://localhost:8787';
