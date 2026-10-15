import { RISK_THRESHOLDS, SCORING, SEVERITY_POINTS } from './config';
import type { ReportFinding, RiskLevel } from './schema';

/**
 * Deterministic risk score (0–100) computed ONLY from verified findings.
 *
 *   points(f)  = SEVERITY_POINTS[f.severity]
 *              × (confidenceBase + (1 − confidenceBase) × f.confidence)
 *              × evidenceQuality(f)            (1.0 exact, 0.9 offset corrected)
 *   Within each category, findings are sorted by points (desc) and the n-th
 *   one is multiplied by categoryDecay^n (0.5ⁿ) so that many similar clauses
 *   do not inflate the score.
 *   R          = Σ weighted points
 *   score      = round(100 × (1 − e^(−R / k)))  with k = saturationK (8)
 *
 * The score expresses how much potentially unfavourable contractual content
 * was found and verified. It is not a probability of illegality.
 */

export function findingPoints(f: Pick<ReportFinding, 'severity' | 'confidence' | 'evidence'>): number {
  if (f.evidence.status !== 'verified') return 0;
  const sev = SEVERITY_POINTS[f.severity];
  const conf = SCORING.confidenceBase + (1 - SCORING.confidenceBase) * f.confidence;
  const quality = f.evidence.offsetCheck === 'corrected' ? SCORING.evidenceQuality.exact_offset_corrected : SCORING.evidenceQuality.exact;
  return sev * conf * quality;
}

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  raw: number;
  contributions: Map<string, number>;
}

export function levelForScore(score: number): RiskLevel {
  for (const t of RISK_THRESHOLDS) if (score >= t.min) return t.level;
  return 'low';
}

export function computeScore(findings: ReportFinding[]): ScoreResult {
  const byCat = new Map<string, Array<{ id: string; p: number }>>();
  for (const f of findings) {
    const p = findingPoints(f);
    if (p <= 0) continue;
    const arr = byCat.get(f.category) ?? [];
    arr.push({ id: f.id, p });
    byCat.set(f.category, arr);
  }
  const contributions = new Map<string, number>();
  let raw = 0;
  for (const arr of byCat.values()) {
    arr.sort((a, b) => b.p - a.p);
    arr.forEach((x, n) => {
      const w = x.p * Math.pow(SCORING.categoryDecay, n);
      contributions.set(x.id, Number(w.toFixed(3)));
      raw += w;
    });
  }
  const score = Math.round(100 * (1 - Math.exp(-raw / SCORING.saturationK)));
  return { score, level: levelForScore(score), raw: Number(raw.toFixed(3)), contributions };
}

export const RISK_LEVEL_TR: Record<RiskLevel, string> = {
  low: 'Düşük',
  moderate: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};
