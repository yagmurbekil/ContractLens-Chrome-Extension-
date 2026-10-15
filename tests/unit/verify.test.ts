import { describe, expect, it } from 'vitest';
import { findAll, normalize, normalizeWithMap } from '../../src/lib/normalize';
import { verifyQuote } from '../../src/lib/verify';
import type { Chunk } from '../../src/lib/schema';

const text =
  'We collect your email.\n\nWe may share your personal information with advertising partners for marketing purposes. ' +
  'You can opt out at any time. We retain data indefinitely. We retain data indefinitely.';
const chunk: Chunk = { id: 'c0', heading: null, text, start: 1000, end: 1000 + text.length };

describe('normalize', () => {
  it('collapses whitespace and maps typographic characters', () => {
    expect(normalize('  A  “quoted”\n\n— it’s​ ok  ')).toBe('A "quoted" - it\'s ok');
  });
  it('keeps letters, digits and case untouched', () => {
    expect(normalize('Not liable for 100 Damages')).toBe('Not liable for 100 Damages');
  });
  it('maps normalized indices back to original indices', () => {
    const src = 'a  b\n\nc';
    const n = normalizeWithMap(src);
    expect(n.text).toBe('a b c');
    expect(n.map).toEqual([0, 1, 3, 4, 6]);
  });
  it('findAll finds overlapping occurrences', () => {
    expect(findAll('aaaa', 'aa')).toEqual([0, 1, 2]);
  });
});

describe('verifyQuote', () => {
  const q = 'We may share your personal information with advertising partners for marketing purposes.';
  it('verifies an exact quote and maps document offsets', () => {
    const ev = verifyQuote({ originalQuote: q, startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('verified');
    expect(text.slice(ev.docStart! - 1000, ev.docEnd! - 1000)).toBe(q);
    expect(ev.offsetCheck).toBe('not_provided');
  });
  it('tolerates whitespace, curly quotes and wrapping quotation marks', () => {
    const ev = verifyQuote({ originalQuote: `“We may share your  personal\ninformation with advertising partners for marketing purposes.”`, startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('verified');
  });
  it('flags correct vs corrected offsets', () => {
    const start = text.indexOf(q);
    expect(verifyQuote({ originalQuote: q, startOffset: start, endOffset: start + q.length }, chunk).offsetCheck).toBe('match');
    expect(verifyQuote({ originalQuote: q, startOffset: 3, endOffset: 50 }, chunk).offsetCheck).toBe('corrected');
  });
  it('rejects a fabricated quote', () => {
    const ev = verifyQuote({ originalQuote: 'We never share your personal information with anyone at all.', startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('unverified_not_found');
    expect(ev.docStart).toBeNull();
  });
  it('rejects a quote that differs only by case (altered)', () => {
    const ev = verifyQuote({ originalQuote: q.toUpperCase(), startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('unverified_altered');
  });
  it('rejects an elided quote with an ellipsis', () => {
    const ev = verifyQuote({ originalQuote: 'We may share your personal information ... for marketing purposes.', startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('unverified_altered');
  });
  it('rejects a materially altered quote (negation removed)', () => {
    const ev = verifyQuote({ originalQuote: 'We may not share your personal information with advertising partners for marketing purposes.', startOffset: null, endOffset: null }, chunk);
    expect(ev.status).toBe('unverified_not_found');
  });
  it('marks repeated quotes as ambiguous unless offsets disambiguate', () => {
    const r = 'We retain data indefinitely.';
    expect(verifyQuote({ originalQuote: r, startOffset: null, endOffset: null }, chunk).status).toBe('unverified_ambiguous');
    const second = text.lastIndexOf(r);
    const ev = verifyQuote({ originalQuote: r, startOffset: second, endOffset: second + r.length }, chunk);
    expect(ev.status).toBe('verified');
    expect(ev.docStart).toBe(1000 + second);
  });
  it('rejects quotes that are too short to be meaningful evidence', () => {
    expect(verifyQuote({ originalQuote: 'We collect', startOffset: null, endOffset: null }, chunk).status).toBe('unverified_not_found');
  });
});
