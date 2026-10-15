/**
 * Deterministic DOM text extraction.
 *
 * Pure functions over a `Document`, used by the content script, the test
 * harness, Vitest (jsdom) and the evaluation runner. Produces:
 *   - `text`: visible, readable main-content text (blocks separated by \n\n)
 *   - `sections`: heading → [start, end) offsets inside `text`
 *   - `excluded`: text that was NOT extracted (hidden elements, comments,
 *     attributes) — never sent to the LLM, only scanned for injection.
 *
 * Nothing here clicks, submits, focuses or mutates the page.
 */

export interface Section {
  heading: string;
  level: number;
  start: number;
  end: number;
}

export interface ExcludedText {
  location: 'hidden' | 'comment' | 'attribute';
  text: string;
}

export interface ExtractedDocument {
  url: string;
  title: string;
  language: string | null;
  text: string;
  sections: Section[];
  headings: string[];
  excluded: ExcludedText[];
  stats: { chars: number; words: number; rootSelector: string };
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'FORM', 'DIALOG', 'VIDEO', 'AUDIO', 'IMG', 'PICTURE',
]);
const CHROME_TAGS = new Set(['NAV', 'ASIDE', 'FOOTER', 'HEADER']);
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TABLE', 'TR', 'TD', 'TH',
  'TBODY', 'THEAD', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR', 'FIGURE',
  'FIGCAPTION', 'ADDRESS', 'DETAILS', 'SUMMARY',
]);
const HEADING = /^H([1-6])$/;
const HIDDEN_CLASS = /(^|\s)(sr-only|visually-hidden|screen-reader-text|hidden|d-none)(\s|$)/i;
const CHROME_ROLE = /^(navigation|banner|contentinfo|complementary|search|dialog|alertdialog)$/;
const AD_HINT = /(^|[\s_-])(ad|ads|advert|advertisement|sponsor|promo|cookie-banner|newsletter|comments?)([\s_-]|$)/i;

export function isHiddenElement(el: Element, win: Window): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const cls = el.getAttribute('class') ?? '';
  if (HIDDEN_CLASS.test(cls)) return true;
  const style = win.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
  if (parseFloat(style.opacity || '1') === 0) return true;
  const fs = style.fontSize;
  if (fs && /^0(\.0*)?(px|em|rem|pt|%)?$/.test(fs.trim())) return true;
  const clip = style.clip || '';
  if (/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(clip)) return true;
  if (/inset\(\s*(50%|100%)/.test(style.clipPath || '')) return true;
  if (style.position === 'absolute' || style.position === 'fixed') {
    const left = parseFloat(style.left || '0');
    const top = parseFloat(style.top || '0');
    if (left <= -999 || top <= -999) return true;
  }
  const w = style.width;
  const h = style.height;
  if ((w === '0px' || h === '0px' || w === '1px' || h === '1px') && style.overflow === 'hidden') return true;
  if (style.color && style.color === style.backgroundColor && style.color !== '') return true;
  return false;
}

function isChrome(el: Element, root: Element): boolean {
  if (el === root) return false;
  if (CHROME_TAGS.has(el.tagName)) {
    // A <header> inside the main article usually holds the document title — keep it.
    if (el.tagName === 'HEADER' && el.closest('article, main, [role="main"]')) return false;
    return true;
  }
  const role = el.getAttribute('role');
  if (role && CHROME_ROLE.test(role)) return true;
  const idc = `${el.id} ${el.getAttribute('class') ?? ''}`;
  if (AD_HINT.test(idc)) return true;
  return false;
}

function textLen(el: Element): number {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

/** Choose the element most likely to hold the main legal text. */
export function chooseRoot(doc: Document): { el: Element; selector: string } {
  const candidates: Array<[string, Element | null]> = [
    ['main', doc.querySelector('main')],
    ['[role="main"]', doc.querySelector('[role="main"]')],
    ['article', doc.querySelector('article')],
    ['#content', doc.querySelector('#content')],
    ['.content', doc.querySelector('.content')],
  ];
  const bodyLen = doc.body ? textLen(doc.body) : 0;
  let best: { el: Element; selector: string } | null = null;
  let bestLen = 0;
  for (const [sel, el] of candidates) {
    if (!el) continue;
    const l = textLen(el);
    if (l > bestLen) {
      best = { el, selector: sel };
      bestLen = l;
    }
  }
  // Use the candidate only if it holds a meaningful share of the page text.
  if (best && bestLen >= Math.min(800, bodyLen * 0.3)) return best;
  return { el: doc.body ?? doc.documentElement, selector: 'body' };
}

const ATTRS_TO_SCAN = ['title', 'alt', 'aria-label', 'aria-description', 'content', 'placeholder'];

function collectAttributes(el: Element, excluded: ExcludedText[]): void {
  for (const name of ATTRS_TO_SCAN) {
    const v = el.getAttribute(name);
    if (v && v.trim().length > 15) excluded.push({ location: 'attribute', text: v.trim() });
  }
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-') && attr.value.trim().length > 25) {
      excluded.push({ location: 'attribute', text: attr.value.trim() });
    }
  }
}

export function extractDocument(doc: Document, opts: { url?: string } = {}): ExtractedDocument {
  const win = doc.defaultView as Window;
  const { el: root, selector } = chooseRoot(doc);
  const excluded: ExcludedText[] = [];

  // Comments anywhere in the document (common injection vector).
  const cw = doc.createTreeWalker(doc.documentElement, 128 /* NodeFilter.SHOW_COMMENT */);
  for (let n = cw.nextNode(); n; n = cw.nextNode()) {
    const t = (n.nodeValue ?? '').trim();
    if (t.length > 10) excluded.push({ location: 'comment', text: t });
  }
  doc.querySelectorAll('meta[content]').forEach((m) => collectAttributes(m, excluded));

  let out = '';
  const sections: Section[] = [];
  const headings: string[] = [];
  let pendingBreak = false;

  const ensureBreak = () => {
    if (out.length && !out.endsWith('\n\n')) pendingBreak = true;
  };
  const append = (s: string) => {
    if (!s) return;
    if (pendingBreak) {
      out = out.replace(/[ \t]+$/, '') + '\n\n';
      pendingBreak = false;
      s = s.replace(/^\s+/, '');
      if (!s) return;
    } else if (out.endsWith('\n\n') || out.length === 0) {
      s = s.replace(/^\s+/, '');
      if (!s) return;
    }
    out += s;
  };

  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(/[\s\u00A0]+/g, ' ');
      if (t.trim() || (t === ' ' && out && !out.endsWith(' ') && !out.endsWith('\n'))) append(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    collectAttributes(el, excluded);
    if (SKIP_TAGS.has(tag)) return;
    if (isHiddenElement(el, win)) {
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) excluded.push({ location: 'hidden', text: t });
      return;
    }
    if (isChrome(el, root)) return;

    const hm = HEADING.exec(tag);
    const isBlock = BLOCK_TAGS.has(tag);
    if (hm) {
      ensureBreak();
      const heading = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (heading) {
        append(heading);
        const start = out.length - heading.length;
        const prev = sections[sections.length - 1];
        if (prev) prev.end = start;
        sections.push({ heading, level: Number(hm[1]), start, end: -1 });
        headings.push(heading);
      }
      ensureBreak();
      return;
    }
    if (tag === 'BR') {
      append(' ');
      return;
    }
    if (isBlock) ensureBreak();
    if (tag === 'LI') append('• ');
    for (const child of Array.from(el.childNodes)) walk(child);
    if (isBlock) ensureBreak();
    if (tag === 'TD' || tag === 'TH') append(' ');
  };

  walk(root);
  out = out.trimEnd(); // only trims the tail, so recorded offsets stay valid
  const last = sections[sections.length - 1];
  if (last) last.end = out.length;
  for (const s of sections) if (s.end < 0 || s.end > out.length) s.end = out.length;

  return {
    url: opts.url ?? doc.location?.href ?? '',
    title: (doc.title || '').trim(),
    language: doc.documentElement.getAttribute('lang'),
    text: out,
    sections,
    headings,
    excluded,
    stats: { chars: out.length, words: out.split(/\s+/).filter(Boolean).length, rootSelector: selector },
  };
}

/** The heading of the section that contains `offset`, if any. */
export function sectionAt(sections: Section[], offset: number): Section | null {
  let found: Section | null = null;
  for (const s of sections) {
    if (s.start <= offset && offset < s.end) found = s;
  }
  return found;
}
