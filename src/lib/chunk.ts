import { CHUNKING } from './config';
import { sectionAt, type ExtractedDocument } from './extract';
import type { Chunk } from './schema';
import { RELEVANCE_TERMS } from './rules';

/**
 * Split the extracted text into overlapping, traceable chunks.
 * Invariant (tested): chunk.text === doc.text.slice(chunk.start, chunk.end).
 * Chunks prefer to end at a paragraph boundary, then a sentence boundary.
 */
export function chunkDocument(
  doc: Pick<ExtractedDocument, 'text' | 'sections'>,
  maxChars: number = CHUNKING.maxChunkChars,
  overlap: number = CHUNKING.overlapChars,
): Chunk[] {
  const text = doc.text;
  const chunks: Chunk[] = [];
  if (!text.trim()) return chunks;
  let start = 0;
  let n = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      const minCut = Math.floor(maxChars * 0.5);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      if (para >= minCut) end = start + para;
      else if (sentence >= minCut) end = start + sentence + 1;
    }
    const heading = sectionAt(doc.sections, start)?.heading ?? null;
    chunks.push({ id: `c${n++}`, heading: heading ? heading.slice(0, 200) : null, text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    // Overlap: step back, but start at a word boundary.
    let next = Math.max(end - overlap, start + 1);
    const ws = text.indexOf(' ', next);
    if (ws !== -1 && ws < end) next = ws + 1;
    start = next;
  }
  return chunks;
}

export function relevanceScore(text: string): number {
  const words = Math.max(1, text.split(/\s+/).length);
  let hits = 0;
  for (const re of RELEVANCE_TERMS) {
    re.lastIndex = 0;
    hits += (text.match(re) ?? []).length;
  }
  return hits / words;
}

export interface ChunkSelection {
  selected: Chunk[];
  skipped: Chunk[];
  analyzedChars: number;
}

/**
 * Keep the whole document when it fits within the budget; otherwise keep
 * the most relevant chunks (by keyword density, with priority hints from
 * Page Agent's section locator) up to CHUNKING.maxAnalyzedChars.
 * Selected chunks are returned in document order.
 */
export function selectChunks(
  chunks: Chunk[],
  budget: number = CHUNKING.maxAnalyzedChars,
  priorityHeadings: string[] = [],
): ChunkSelection {
  const total = chunks.reduce((a, c) => a + c.text.length, 0);
  if (total <= budget) return { selected: chunks, skipped: [], analyzedChars: total };
  const prio = new Set(priorityHeadings.map((h) => h.trim().toLowerCase()));
  const ranked = chunks
    .map((c) => ({ c, s: relevanceScore(c.text) + (c.heading && prio.has(c.heading.trim().toLowerCase()) ? 1 : 0) }))
    .sort((a, b) => b.s - a.s);
  const keep = new Set<string>();
  let used = 0;
  for (const { c } of ranked) {
    if (used + c.text.length > budget) continue;
    keep.add(c.id);
    used += c.text.length;
  }
  return {
    selected: chunks.filter((c) => keep.has(c.id)),
    skipped: chunks.filter((c) => !keep.has(c.id)),
    analyzedChars: used,
  };
}
