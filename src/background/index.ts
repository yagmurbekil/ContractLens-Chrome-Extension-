/**
 * MV3 service worker. Coordinates: on-demand content-script injection
 * (activeTab), backend calls, report storage (chrome.storage.session — in
 * memory, cleared when the browser closes) and the Page Agent LLM proxy.
 *
 * The ONLY network destination is the configured backend URL.
 */
import { DEFAULT_BACKEND_URL } from '../lib/config';
import type { ExtractedDocument } from '../lib/extract';
import type { AnalysisPhase, AnalysisProgress, AnalyzeOutcome, BackgroundRequest, ContentRequest, ExtractResponse, InspectResult, Settings } from '../lib/messages';
import { prepareDocument, type PreparedDocument } from '../lib/pipeline';
import { candidateStats } from '../lib/candidates';
import { AnalysisError, analyzePrepared, checkHealth } from '../lib/service';
import type { LocateResult, PageInspection } from '../agent/pageAgent';

const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS: Settings = { settingsVersion: SETTINGS_VERSION, backendUrl: DEFAULT_BACKEND_URL, usePageAgentLocator: false, privacyAcknowledged: false };

async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get('settings');
  const stored = (s.settings as Partial<Settings> | undefined) ?? {};
  // v2: the Page Agent locator became opt-in (it consumes scarce free-tier LLM tokens).
  if ((stored.settingsVersion ?? 1) < 2) delete stored.usePageAgentLocator;
  return { ...DEFAULT_SETTINGS, ...stored, settingsVersion: SETTINGS_VERSION };
}

/** Per-tab prepared documents held in memory only. */
const prepared = new Map<number, PreparedDocument>();
/** Tabs with an analysis currently allowed to use the agent proxy. */
const agentTabs = new Set<number>();

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function sendToTab<T>(tabId: number, msg: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
}

async function extract(tabId: number): Promise<ExtractedDocument> {
  await ensureContentScript(tabId);
  const res = await sendToTab<ExtractResponse>(tabId, { type: 'CL_EXTRACT' });
  if (!res.ok) throw new Error(res.error);
  return res.doc;
}

async function inspect(tabId: number): Promise<InspectResult> {
  const doc = await extract(tabId);
  const p = prepareDocument(doc);
  prepared.set(tabId, p);
  let pageAgent: PageInspection;
  try {
    pageAgent = await sendToTab<PageInspection>(tabId, { type: 'CL_INSPECT_AGENT' });
  } catch (e) {
    pageAgent = { interactiveCount: 0, consentControls: [], header: '', available: false, error: (e as Error).message };
  }
  let domain = '';
  try {
    domain = new URL(doc.url).hostname;
  } catch {
    /* ignore */
  }
  return {
    tabId,
    url: doc.url,
    domain,
    title: doc.title,
    classification: p.classification,
    stats: doc.stats,
    sectionsCount: doc.sections.length,
    chunksTotal: p.chunks.length,
    chunksSelected: p.selected.length,
    analyzedChars: p.analyzedChars,
    injectionSignals: p.injectionSignals.length,
    ...candidateStats(p),
    pageAgent,
  };
}

/** Writing to chrome.storage also keeps the MV3 service worker alive during long analyses. */
function setProgress(tabId: number, phase: AnalysisPhase, done?: number, total?: number): Promise<void> {
  const value: AnalysisProgress = { phase, done, total, ts: Date.now() };
  return chrome.storage.session.set({ [`progress:${tabId}`]: value });
}

const running = new Set<number>();

/** Starts an analysis without holding the message channel open; the result is written to storage. */
function startAnalysis(msg: Extract<BackgroundRequest, { type: 'CL_ANALYZE' }>): void {
  if (running.has(msg.tabId)) return;
  running.add(msg.tabId);
  void (async () => {
    let outcome: AnalyzeOutcome;
    try {
      outcome = await analyze(msg);
    } catch (e) {
      outcome = { ok: false, code: 'unknown', error: (e as Error).message };
    } finally {
      running.delete(msg.tabId);
    }
    await setProgress(msg.tabId, outcome.ok ? 'done' : 'error');
    await chrome.storage.session.set({ [`result:${msg.tabId}`]: { ...outcome, ts: Date.now() } });
  })();
}

async function analyze(msg: Extract<BackgroundRequest, { type: 'CL_ANALYZE' }>): Promise<AnalyzeOutcome> {
  const settings = await getSettings();
  let p = prepared.get(msg.tabId);
  await setProgress(msg.tabId, 'extracting');
  try {
    if (!p) p = prepareDocument(await extract(msg.tabId));
  } catch (e) {
    return { ok: false, code: 'extraction', error: `Sayfa metni çıkarılamadı: ${(e as Error).message}` };
  }
  let priorityHeadings: string[] = [];
  try {
    if (!msg.demo && settings.usePageAgentLocator && p.chunks.length > p.selected.length) {
      const health = await checkHealth(settings.backendUrl);
      if (health.agentProxy) {
        await setProgress(msg.tabId, 'locating');
        agentTabs.add(msg.tabId);
        try {
          const loc = await sendToTab<LocateResult>(msg.tabId, { type: 'CL_LOCATE', knownHeadings: p.doc.headings, backendUrl: settings.backendUrl });
          if (loc.matchedHeadings.length) priorityHeadings = loc.matchedHeadings;
        } finally {
          agentTabs.delete(msg.tabId);
        }
      }
    }
    await setProgress(msg.tabId, 'sending');
    const report = await analyzePrepared(p, {
      backendUrl: settings.backendUrl,
      typeOverride: msg.typeOverride,
      demo: msg.demo,
      priorityHeadings,
      onProgress: (done, total) => setProgress(msg.tabId, 'sending', done, total),
    });
    await chrome.storage.session.set({ [`report:${msg.tabId}`]: report });
    return { ok: true, report };
  } catch (e) {
    if (e instanceof AnalysisError) return { ok: false, code: e.code, error: e.message };
    return { ok: false, code: 'unknown', error: (e as Error).message };
  }
}

/** Page Agent LLM proxy: forwards only to <backend>/v1/agent/chat/completions. */
async function agentFetch(tabId: number | undefined, body: string): Promise<{ status: number; body: string }> {
  if (tabId === undefined || !agentTabs.has(tabId)) return { status: 403, body: JSON.stringify({ error: { message: 'agent_not_active' } }) };
  if (body.length > 600_000) return { status: 413, body: JSON.stringify({ error: { message: 'too_large' } }) };
  const { backendUrl } = await getSettings();
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/agent/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { status: res.status, body: await res.text() };
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    try {
      switch (msg.type) {
        case 'CL_INSPECT':
          sendResponse({ ok: true, result: await inspect(msg.tabId) });
          return;
        case 'CL_ANALYZE':
          startAnalysis(msg);
          sendResponse({ started: true });
          return;
        case 'CL_GET_REPORT': {
          const r = await chrome.storage.session.get(`report:${msg.tabId}`);
          sendResponse(r[`report:${msg.tabId}`] ?? null);
          return;
        }
        case 'CL_HIGHLIGHT':
          await ensureContentScript(msg.tabId);
          sendResponse(await sendToTab(msg.tabId, { type: 'CL_HIGHLIGHT_QUOTE', quote: msg.quote }));
          return;
        case 'CL_HEALTH':
          sendResponse(await checkHealth((await getSettings()).backendUrl));
          return;
        case 'CL_AGENT_FETCH':
          sendResponse(await agentFetch(sender.tab?.id, msg.body));
          return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  prepared.delete(tabId);
  void chrome.storage.session.remove([`report:${tabId}`, `result:${tabId}`, `progress:${tabId}`]);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) {
    prepared.delete(tabId);
    void chrome.storage.session.remove([`report:${tabId}`, `result:${tabId}`, `progress:${tabId}`]);
  }
});
