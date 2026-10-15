/**
 * Content script. Injected ON DEMAND (chrome.scripting.executeScript) only
 * after the user opens ContractLens on a tab (activeTab permission). It:
 *   - extracts visible legal text deterministically,
 *   - runs Page Agent's PageController for structural inspection,
 *   - optionally runs the read-only Page Agent section locator,
 *   - can scroll to / select a verified quote (window.find; no DOM mutation).
 * It never clicks, submits, types, accepts cookies or changes settings, and
 * it performs no network requests itself.
 */
import { inspectPage, locateLegalSections } from '../agent/pageAgent';
import { extractDocument } from '../lib/extract';
import type { ContentRequest, ExtractResponse } from '../lib/messages';

declare global {
  interface Window {
    __contractlensLoaded?: boolean;
  }
}

/** fetch() replacement for Page Agent: forwards the request body to the background worker. */
const backgroundFetch: typeof fetch = async (_input, init) => {
  const body = typeof init?.body === 'string' ? init.body : '';
  const res = (await chrome.runtime.sendMessage({ type: 'CL_AGENT_FETCH', body })) as { status: number; body: string };
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
};

function highlightQuote(quote: string): boolean {
  const probe = quote.replace(/\s+/g, ' ').trim().slice(0, 120);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  // window.find is non-standard but supported by Chromium; it selects and scrolls without modifying the DOM.
  const finder = (window as unknown as { find?: (s: string, cs: boolean, back: boolean, wrap: boolean) => boolean }).find;
  return finder ? finder.call(window, probe, true, false, true) : false;
}

if (!window.__contractlensLoaded) {
  window.__contractlensLoaded = true;
  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    (async () => {
      switch (msg.type) {
        case 'CL_EXTRACT': {
          try {
            const doc = extractDocument(document, { url: location.href });
            sendResponse({ ok: true, doc } satisfies ExtractResponse);
          } catch (e) {
            sendResponse({ ok: false, error: (e as Error).message } satisfies ExtractResponse);
          }
          return;
        }
        case 'CL_INSPECT_AGENT':
          sendResponse(await inspectPage());
          return;
        case 'CL_LOCATE':
          sendResponse(await locateLegalSections(backgroundFetch, msg.knownHeadings, msg.backendUrl));
          return;
        case 'CL_HIGHLIGHT_QUOTE':
          sendResponse({ found: highlightQuote(msg.quote) });
          return;
      }
    })();
    return true;
  });
}
