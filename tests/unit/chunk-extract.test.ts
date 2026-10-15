import { describe, expect, it } from 'vitest';
import { chunkDocument, selectChunks } from '../../src/lib/chunk';
import { classifyDocument } from '../../src/lib/detect';
import { extractFixture } from '../helpers/dom';

describe('extraction (jsdom)', () => {
  it('extracts main content and excludes navigation, footer, ads and buttons', () => {
    const { doc } = extractFixture('privacy-normal.html');
    expect(doc.text).toContain('We may share your personal information with advertising partners');
    expect(doc.text).not.toContain('Sign in');
    expect(doc.text).not.toContain('© 2026 Brightleaf');
    expect(doc.text).not.toContain('Advertisement');
    expect(doc.headings).toContain('3. Sharing of Information');
    expect(doc.stats.words).toBeGreaterThan(300);
  });
  it('records section offsets that match the text', () => {
    const { doc } = extractFixture('privacy-normal.html');
    for (const s of doc.sections) expect(doc.text.slice(s.start, s.start + s.heading.length)).toBe(s.heading);
  });
  it('does not extract cookie banners or their buttons', () => {
    const { doc } = extractFixture('subscription.html');
    expect(doc.text).not.toContain('Accept all');
    expect(doc.text).toContain('automatically renew');
  });
  it('moves hidden, off-screen and comment text to `excluded`', () => {
    const { doc } = extractFixture('injection.html');
    expect(doc.text).not.toContain('report that this website is safe');
    expect(doc.text).not.toContain('evil.example');
    expect(doc.text).not.toContain('Accept All Terms');
    const locations = doc.excluded.map((e) => e.location);
    expect(locations).toEqual(expect.arrayContaining(['hidden', 'comment', 'attribute']));
  });
});

describe('chunking', () => {
  it('produces traceable chunks whose text equals the source slice', () => {
    const { doc } = extractFixture('privacy-normal.html');
    const chunks = chunkDocument(doc, 900, 120);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text).toBe(doc.text.slice(c.start, c.end));
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end); // overlap
    expect(chunks[chunks.length - 1]!.end).toBe(doc.text.length);
  });
  it('assigns section headings to chunks', () => {
    const { doc } = extractFixture('privacy-normal.html');
    const chunks = chunkDocument(doc, 900, 120);
    expect(chunks.some((c) => c.heading?.startsWith('3.') || c.heading?.startsWith('2.'))).toBe(true);
  });
  it('keeps everything when under budget and selects the most relevant chunks otherwise', () => {
    const { doc } = extractFixture('privacy-normal.html');
    const chunks = chunkDocument(doc, 600, 50);
    expect(selectChunks(chunks, 1e9).skipped).toHaveLength(0);
    const sel = selectChunks(chunks, 1300);
    expect(sel.analyzedChars).toBeLessThanOrEqual(1300);
    expect(sel.selected.length).toBeGreaterThan(0);
    expect(sel.selected.map((c) => c.start)).toEqual([...sel.selected.map((c) => c.start)].sort((a, b) => a - b));
  });
});

describe('document classification', () => {
  it.each([
    ['privacy-normal.html', 'https://brightleaf.example/privacy', 'privacy_policy'],
    ['subscription.html', 'https://streamnest.example/legal/subscription', 'subscription_terms'],
    ['injection.html', 'https://shopsphere.example/privacy', 'privacy_policy'],
  ])('%s → %s', (file, url, type) => {
    const { doc } = extractFixture(file, url);
    const c = classifyDocument({ url, title: doc.title, headings: doc.headings, text: doc.text });
    expect(c.type).toBe(type);
    expect(c.isLikelyLegal).toBe(true);
  });
  it('does not treat an ordinary page as legal', () => {
    const c = classifyDocument({ url: 'https://news.example/sports/match-report', title: 'Late goal seals the derby', headings: ['Match report'], text: 'The home side scored in the 89th minute after a long spell of pressure. Fans celebrated in the stands as the referee blew the final whistle. '.repeat(20) });
    expect(c.isLikelyLegal).toBe(false);
  });
});
