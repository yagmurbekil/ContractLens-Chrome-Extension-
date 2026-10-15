import { describe, expect, it } from 'vitest';
import { computeScore, findingPoints, levelForScore } from '../../src/lib/score';
import { RISK_THRESHOLDS } from '../../src/lib/config';
import type { ReportFinding } from '../../src/lib/schema';

function rf(id: string, over: Partial<ReportFinding> = {}): ReportFinding {
  return {
    id,
    chunkId: 'c0',
    category: 'data_sharing',
    concernType: 'privacy',
    severity: 'high',
    titleTr: 't',
    originalQuote: 'q',
    explanationTr: 'e',
    potentialImpactTr: 'p',
    sourceSection: null,
    confidence: 1,
    uncertaintyTr: null,
    evidence: { status: 'verified', docStart: 0, docEnd: 10, offsetCheck: 'not_provided', detailTr: '' },
    scoreContribution: 0,
    ...over,
  };
}

describe('deterministic scoring', () => {
  it('scores zero with no verified findings', () => {
    expect(computeScore([]).score).toBe(0);
    const unverified = rf('a', { evidence: { status: 'unverified_not_found', docStart: null, docEnd: null, offsetCheck: 'not_applicable', detailTr: '' } });
    expect(findingPoints(unverified)).toBe(0);
    expect(computeScore([unverified]).score).toBe(0);
  });
  it('follows the documented formula', () => {
    // one high finding, confidence 1 → R = 3 → 100*(1-e^(-3/8)) = 31.27 → 31
    expect(computeScore([rf('a')]).score).toBe(31);
    // confidence 0 halves the points → R = 1.5 → 17.1 → 17
    expect(computeScore([rf('a', { confidence: 0 })]).score).toBe(17);
    // offset corrected → ×0.9 → R = 2.7 → 28.6 → 29
    expect(computeScore([rf('a', { evidence: { status: 'verified', docStart: 0, docEnd: 1, offsetCheck: 'corrected', detailTr: '' } })]).score).toBe(29);
  });
  it('applies diminishing weight inside a category', () => {
    const same = computeScore([rf('a'), rf('b'), rf('c')]);
    expect(same.raw).toBeCloseTo(3 + 1.5 + 0.75);
    const diff = computeScore([rf('a'), rf('b', { category: 'auto_renewal' }), rf('c', { category: 'refunds' })]);
    expect(diff.raw).toBeCloseTo(9);
    expect(diff.score).toBeGreaterThan(same.score);
  });
  it('is order independent and deterministic', () => {
    const a = [rf('a', { severity: 'critical' }), rf('b', { severity: 'low', category: 'refunds' }), rf('c', { confidence: 0.4 })];
    expect(computeScore(a).score).toBe(computeScore([...a].reverse()).score);
  });
  it('maps scores to levels with the shared thresholds', () => {
    expect(levelForScore(0)).toBe('low');
    expect(levelForScore(24)).toBe('low');
    expect(levelForScore(25)).toBe('moderate');
    expect(levelForScore(50)).toBe('high');
    expect(levelForScore(75)).toBe('critical');
    expect(RISK_THRESHOLDS.map((t) => t.min)).toEqual([75, 50, 25, 0]);
  });
  it('saturates below 100', () => {
    const many = Array.from({ length: 18 }, (_, i) => rf(String(i), { severity: 'critical', category: (['data_sharing', 'auto_renewal', 'refunds', 'cancellation', 'indemnification', 'jurisdiction'] as const)[i % 6] }));
    const s = computeScore(many).score;
    expect(s).toBeLessThanOrEqual(100);
    expect(s).toBeGreaterThan(90);
  });
});
