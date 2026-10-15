/**
 * Deterministic text normalization for evidence matching.
 *
 * The normalization only removes presentational differences that commonly
 * appear between DOM text and an LLM's copy of it:
 *   - Unicode NFKC compatibility forms (ligatures, full-width chars)
 *   - typographic quotes → ASCII quotes
 *   - en/em dashes, minus sign → "-"
 *   - zero-width characters and soft hyphens removed
 *   - all whitespace runs (incl. NBSP, newlines) → single space
 *
 * It never changes letters, digits, word order, negations or punctuation
 * that carries meaning. Matching remains case-sensitive.
 *
 * `normalizeWithMap` also returns, for each output character, the index of
 * the source character it came from, so verified matches can be mapped back
 * to offsets in the original extracted text.
 */

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u00B4`]/;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/;
const DASHES = /[\u2010-\u2015\u2212]/;
const WS = /\s/u;

export interface NormalizedText {
  text: string;
  /** map[i] = index in the original string of normalized char i */
  map: number[];
}

function mapChar(ch: string): string {
  if (ZERO_WIDTH.test(ch)) return '';
  if (SINGLE_QUOTES.test(ch)) return "'";
  if (DOUBLE_QUOTES.test(ch)) return '"';
  if (DASHES.test(ch)) return '-';
  if (ch === '\u2026') return '...';
  return ch.normalize('NFKC');
}

export function normalizeWithMap(input: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // trims leading whitespace
  // iterate by code point to keep surrogate pairs intact
  let idx = 0;
  for (const ch of input) {
    const srcIndex = idx;
    idx += ch.length;
    if (WS.test(ch) || ch === '\u00A0') {
      if (!lastWasSpace) {
        out.push(' ');
        map.push(srcIndex);
        lastWasSpace = true;
      }
      continue;
    }
    const mapped = mapChar(ch);
    for (const m of mapped) {
      if (WS.test(m)) {
        if (!lastWasSpace) {
          out.push(' ');
          map.push(srcIndex);
          lastWasSpace = true;
        }
        continue;
      }
      out.push(m);
      map.push(srcIndex);
      lastWasSpace = false;
    }
  }
  if (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { text: out.join(''), map };
}

export function normalize(input: string): string {
  return normalizeWithMap(input).text;
}

/** All start indices of `needle` in `haystack` (non-overlapping scan is not used: every occurrence counts). */
export function findAll(haystack: string, needle: string): number[] {
  const res: number[] = [];
  if (!needle) return res;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    res.push(i);
    from = i + 1;
  }
  return res;
}
