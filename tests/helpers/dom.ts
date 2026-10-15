import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractDocument } from '../../src/lib/extract';

export function loadFixture(name: string, url = `https://example.test/${name.replace('.html', '')}`): JSDOM {
  const html = readFileSync(join(__dirname, '../../fixtures/sites', name), 'utf8');
  return new JSDOM(html, { url, pretendToBeVisual: true });
}

export function extractFixture(name: string, url?: string) {
  const dom = loadFixture(name, url);
  return { dom, doc: extractDocument(dom.window.document, { url: dom.window.location.href }) };
}
