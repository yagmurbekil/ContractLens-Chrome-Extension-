/**
 * Re-downloads the evaluation sources and renders them to HTML pages
 * (eval/pages/*.html) so the real DOM extraction code can run on them.
 *   npm run eval:fetch            # download + render
 *   npm run eval:fetch -- --offline  # render from eval/sources only
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const manifest = JSON.parse(readFileSync('eval/manifest.json', 'utf8')) as { documents: Array<{ id: string; title: string; sourceUrl: string; file: string }> };
const offline = process.argv.includes('--offline');
mkdirSync('eval/sources', { recursive: true });
mkdirSync('eval/pages', { recursive: true });

function cleanMarkdown(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '') // YAML front matter
    .replace(/\{\{[^}]*\}\}/g, '#') // Jekyll/Liquid variables
    .replace(/^\{:[^}]*\}\s*$/gm, '') // kramdown attribute lines
    .replace(/<!--[\s\S]*?-->/g, ''); // lint directives
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

for (const d of manifest.documents) {
  if (!offline) {
    const res = await fetch(d.sourceUrl);
    if (!res.ok) {
      console.error(`FAILED ${d.id}: HTTP ${res.status} — keeping existing copy if any`);
    } else {
      writeFileSync(`eval/sources/${d.file}`, await res.text());
      console.log(`fetched ${d.id}`);
    }
  }
  const md = cleanMarkdown(readFileSync(`eval/sources/${d.file}`, 'utf8'));
  const body = await marked.parse(md, { gfm: true });
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(d.title)}</title></head>\n<body><nav><a href="#">Home</a> <a href="#">Products</a></nav>\n<main><article>\n${body}\n</article></main>\n<footer>Rendered from ${escapeHtml(d.sourceUrl)} for ContractLens evaluation.</footer></body></html>\n`;
  writeFileSync(`eval/pages/${d.id}.html`, html);
  console.log(`rendered eval/pages/${d.id}.html`);
}
