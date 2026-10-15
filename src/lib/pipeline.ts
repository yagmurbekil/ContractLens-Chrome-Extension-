import { chunkDocument, selectChunks } from './chunk';
import { LIMITS } from './config';
import { classifyDocument, type Classification } from './detect';
import type { ExtractedDocument } from './extract';
import { detectInjection, type InjectionSignal } from './injection';
import { buildReport } from './report';
import { AnalyzeResponseSchema, type AnalyzeRequest, type AnalyzeResponse, type Chunk, type DocumentType, type Report } from './schema';

/** Everything known about a page before any data leaves the browser. */
export interface PreparedDocument {
  doc: ExtractedDocument;
  classification: Classification;
  chunks: Chunk[];
  selected: Chunk[];
  analyzedChars: number;
  injectionSignals: InjectionSignal[];
}

export function prepareDocument(doc: ExtractedDocument, priorityHeadings: string[] = []): PreparedDocument {
  const classification = classifyDocument({ url: doc.url, title: doc.title, headings: doc.headings, text: doc.text });
  const chunks = chunkDocument(doc);
  const sel = selectChunks(chunks, undefined, priorityHeadings);
  return {
    doc,
    classification,
    chunks,
    selected: sel.selected,
    analyzedChars: sel.analyzedChars,
    injectionSignals: detectInjection(doc),
  };
}

export function buildAnalyzeRequests(p: PreparedDocument, typeOverride?: DocumentType): AnalyzeRequest[] {
  const reqs: AnalyzeRequest[] = [];
  for (let i = 0; i < p.selected.length; i += LIMITS.maxChunksPerRequest) {
    reqs.push({
      url: p.doc.url,
      title: p.doc.title.slice(0, 500),
      documentTypeHint: typeOverride ?? p.classification.type,
      language: p.doc.language,
      chunks: p.selected.slice(i, i + LIMITS.maxChunksPerRequest),
    });
  }
  return reqs;
}

export type Analyzer = (req: AnalyzeRequest) => Promise<unknown>;

/**
 * Run the analysis through any analyzer (backend, demo, or test double).
 * Responses are re-validated client-side: nothing from the network is
 * rendered without passing AnalyzeResponseSchema and quote verification.
 */
export async function runAnalysis(p: PreparedDocument, analyzer: Analyzer, typeOverride?: DocumentType): Promise<Report> {
  const merged: AnalyzeResponse = { mode: 'llm', provider: '', model: '', results: [] };
  for (const req of buildAnalyzeRequests(p, typeOverride)) {
    const raw = await analyzer(req);
    const parsed = AnalyzeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      // Malformed response from backend: count every chunk as a schema failure.
      merged.results.push(
        ...req.chunks.map((c) => ({ chunkId: c.id, ok: false as const, attempts: 1, errorCode: 'validation_failed' as const, errorMessage: 'Sunucu yanıtı şema doğrulamasından geçmedi.' })),
      );
      continue;
    }
    merged.mode = parsed.data.mode;
    merged.provider = parsed.data.provider;
    merged.model = parsed.data.model;
    const sent = new Set(req.chunks.map((c) => c.id));
    merged.results.push(...parsed.data.results.filter((r) => sent.has(r.chunkId)));
  }
  return buildReport({
    doc: p.doc,
    classification: p.classification,
    allChunks: p.chunks,
    analyzedChunks: p.selected,
    response: merged,
    injectionSignals: p.injectionSignals,
  });
}
