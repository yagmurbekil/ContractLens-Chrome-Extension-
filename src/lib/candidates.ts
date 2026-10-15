import { LIMITS } from './config';
import { sectionAt, type ExtractedDocument } from './extract';
import { matchingRules, relevanceHits, sentences } from './rules';
import type { Candidate } from './schema';

/**
 * Candidate selection for the single-request LLM review.
 *
 * Every sentence of the extracted text is scored deterministically:
 *   score = 3 × (#matching rules) + min(4, #relevance keywords) + 1 if in a priority section
 * The best-scoring sentences (≤ LIMITS.maxCandidates, ≤ LIMITS.maxCandidateChars in total)
 * are sent to the LLM in document order with ids k0, k1, …
 *
 * Each candidate text is an exact slice of `doc.text`, so verification of
 * anything the LLM selects is exact by construction (and still re-checked).
 * Trade-off: a clause the rules/keywords do not surface is never shown to the
 * LLM; the report states how many sentences were reviewed.
 */
export interface CandidateSelection {
  candidates: Candidate[];
  sentencesScanned: number;
  sentencesWithSignals: number;
}

export function selectCandidates(
  doc: Pick<ExtractedDocument, 'text' | 'sections'>,
  priorityHeadings: string[] = [],
  maxCount: number = LIMITS.maxCandidates,
  maxChars: number = LIMITS.maxCandidateChars,
): CandidateSelection {
  const prio = new Set(priorityHeadings.map((h) => h.trim().toLowerCase()));
  const spans = sentences(doc.text, 25);
  const scored = spans
    .map((sp) => {
      const text = doc.text.slice(sp.s, sp.e);
      const rules = matchingRules(text);
      const rel = relevanceHits(text);
      const heading = sectionAt(doc.sections, sp.s)?.heading ?? null;
      const score = rules.length * 3 + Math.min(4, rel) + (heading && prio.has(heading.trim().toLowerCase()) ? 1 : 0);
      return { sp, text, rules, heading, score };
    })
    .filter((x) => x.score > 0);

  const picked: typeof scored = [];
  let chars = 0;
  for (const x of [...scored].sort((a, b) => b.score - a.score || a.sp.s - b.sp.s)) {
    if (picked.length >= maxCount) break;
    if (chars + x.text.length > maxChars) continue;
    picked.push(x);
    chars += x.text.length;
  }
  picked.sort((a, b) => a.sp.s - b.sp.s);
  return {
    candidates: picked.map((x, i) => ({
      id: `k${i}`,
      text: x.text,
      heading: x.heading ? x.heading.slice(0, LIMITS.maxSectionChars) : null,
      start: x.sp.s,
      end: x.sp.e,
      ruleHints: [...new Set(x.rules.map((r) => r.category))].slice(0, 6),
    })),
    sentencesScanned: spans.length,
    sentencesWithSignals: scored.length,
  };
}

export function candidateStats(p: { doc: Pick<ExtractedDocument, 'text' | 'sections'> }): { candidateCount: number; candidateChars: number } {
  const c = selectCandidates(p.doc).candidates;
  return { candidateCount: c.length, candidateChars: c.reduce((a, x) => a + x.text.length, 0) };
}
