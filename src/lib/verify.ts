import { findAll, normalize, normalizeWithMap } from './normalize';
import type { Chunk, LlmFinding, ReportFinding } from './schema';

/**
 * Deterministic evidence verification. The LLM is never asked to confirm its
 * own evidence: every quotation is located in the text the extension itself
 * extracted from the DOM.
 *
 * Rules
 *  - Quote and chunk are normalized identically (see normalize.ts).
 *  - Exactly one exact occurrence in the chunk → verified.
 *  - Several occurrences → verified only if the model's offsets select one
 *    of them (±OFFSET_TOLERANCE); otherwise "ambiguous".
 *  - No exact occurrence → "altered" if it matches only case-insensitively
 *    or contains an ellipsis/elision; otherwise "not_found".
 *  - No fuzzy matching is ever accepted as verification.
 */

export const OFFSET_TOLERANCE = 8;

export type Evidence = ReportFinding['evidence'];

function stripWrappingQuotes(q: string): string {
  const t = q.trim();
  const pairs: Array<[string, string]> = [['"', '"'], ["'", "'"], ['\u201C', '\u201D'], ['\u2018', '\u2019'], ['\u00AB', '\u00BB']];
  for (const [a, b] of pairs) {
    if (t.length > 2 && t.startsWith(a) && t.endsWith(b)) return t.slice(a.length, t.length - b.length).trim();
  }
  return t;
}

export function verifyQuote(finding: Pick<LlmFinding, 'originalQuote' | 'startOffset' | 'endOffset'>, chunk: Chunk): Evidence {
  const quote = stripWrappingQuotes(finding.originalQuote);
  const nq = normalize(quote);
  const nc = normalizeWithMap(chunk.text);

  if (nq.length < 20) {
    return { status: 'unverified_not_found', docStart: null, docEnd: null, offsetCheck: 'not_applicable', detailTr: 'Alıntı doğrulama için çok kısa.' };
  }

  const hits = findAll(nc.text, nq);
  const toOriginal = (i: number) => {
    const s = nc.map[i]!;
    const e = nc.map[i + nq.length - 1]! + 1;
    return { s, e };
  };

  if (hits.length === 0) {
    const ci = nc.text.toLocaleLowerCase('en-US').includes(nq.toLocaleLowerCase('en-US'));
    const elided = /\.\.\.|\[\s*\.{0,3}\s*\]/.test(nq);
    if (ci || elided) {
      return {
        status: 'unverified_altered',
        docStart: null,
        docEnd: null,
        offsetCheck: 'not_applicable',
        detailTr: elided ? 'Alıntı kısaltılmış (üç nokta içeriyor); kaynakla birebir eşleşmiyor.' : 'Alıntı kaynakla yalnızca büyük/küçük harf farkıyla eşleşiyor; değiştirilmiş kabul edildi.',
      };
    }
    return { status: 'unverified_not_found', docStart: null, docEnd: null, offsetCheck: 'not_applicable', detailTr: 'Alıntı çıkarılan metinde bulunamadı.' };
  }

  const hasOffsets = finding.startOffset !== null && finding.endOffset !== null;
  const near = (i: number) => hasOffsets && Math.abs(toOriginal(i).s - (finding.startOffset as number)) <= OFFSET_TOLERANCE;

  let chosen: number | null = null;
  if (hits.length === 1) chosen = hits[0]!;
  else {
    const matching = hits.filter(near);
    if (matching.length === 1) chosen = matching[0]!;
  }

  if (chosen === null) {
    return {
      status: 'unverified_ambiguous',
      docStart: null,
      docEnd: null,
      offsetCheck: hasOffsets ? 'corrected' : 'not_provided',
      detailTr: `Alıntı metinde ${hits.length} kez geçiyor ve hangi bölüme ait olduğu belirlenemedi.`,
    };
  }

  const { s, e } = toOriginal(chosen);
  const offsetCheck: Evidence['offsetCheck'] = !hasOffsets ? 'not_provided' : near(chosen) ? 'match' : 'corrected';
  return {
    status: 'verified',
    docStart: chunk.start + s,
    docEnd: chunk.start + e,
    offsetCheck,
    detailTr:
      offsetCheck === 'corrected'
        ? 'Alıntı kaynakta birebir bulundu; modelin verdiği konum hatalıydı ve düzeltildi.'
        : 'Alıntı kaynakta birebir bulundu.',
  };
}
