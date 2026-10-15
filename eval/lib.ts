import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractDocument, type ExtractedDocument } from '../src/lib/extract';
import { findAll, normalize, normalizeWithMap } from '../src/lib/normalize';
import { prepareDocument, type PreparedDocument } from '../src/lib/pipeline';

export interface ManifestDoc { id: string; org: string; type: string; title: string; liveUrl: string; sourceUrl: string; file: string; effective: string }
export interface GtItem { id: string; category: string; severity: string; anchors: string[]; note?: string }
export interface Annotation { docId: string; annotator: string; methodology: string; items: GtItem[]; ambiguous: Array<{ id: string; anchors: string[]; note: string }> }

export const manifest = JSON.parse(readFileSync('eval/manifest.json', 'utf8')) as { accessDate: string; note: string; documents: ManifestDoc[] };

export function loadPage(file: string, url: string): ExtractedDocument {
  const dom = new JSDOM(readFileSync(file, 'utf8'), { url, pretendToBeVisual: true });
  return extractDocument(dom.window.document, { url });
}

export function loadEvalDoc(d: ManifestDoc): { doc: ExtractedDocument; prepared: PreparedDocument } {
  const doc = loadPage(`eval/pages/${d.id}.html`, d.liveUrl);
  return { doc, prepared: prepareDocument(doc) };
}

export function loadAnnotation(id: string): Annotation {
  return JSON.parse(readFileSync(`eval/annotations/${id}.json`, 'utf8')) as Annotation;
}

export type Range = [number, number];

/** All ranges (original offsets) where `anchor` occurs in `text`, using the same normalization as quote verification. */
export function anchorRanges(text: string, anchor: string): Range[] {
  const nt = normalizeWithMap(text);
  const na = normalize(anchor);
  return findAll(nt.text, na).map((i) => [nt.map[i]!, nt.map[i + na.length - 1]! + 1] as Range);
}

export function overlaps(a: Range, b: Range): boolean {
  const ov = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const shorter = Math.min(a[1] - a[0], b[1] - b[0]);
  return ov >= Math.min(20, shorter);
}
