import type { AnalysisPhase, AnalysisProgress, AnalyzeOutcome, HealthInfo, InspectResult, Settings } from '../lib/messages';
import type { DocumentType, Report } from '../lib/schema';
import { DEFAULT_BACKEND_URL } from '../lib/config';

/**
 * UI ↔ engine boundary. The popup and report view only talk to this
 * interface. `chromeApi` is used inside the extension; the test harness
 * provides an implementation that runs the same pipeline modules directly
 * against a fixture iframe (Cypress cannot open chrome-extension:// popups).
 */
export interface ContractLensApi {
  inspect(): Promise<{ ok: true; result: InspectResult } | { ok: false; error: string; unsupported?: boolean }>;
  analyze(opts: { typeOverride?: DocumentType; demo?: boolean }, onPhase: PhaseCallback): Promise<AnalyzeOutcome>;
  /** If an analysis for this tab is already running (popup was closed and reopened), wait for it. */
  resumePending(onPhase: PhaseCallback): Promise<AnalyzeOutcome | null>;
  getReport(): Promise<Report | null>;
  openFullReport(): Promise<void>;
  highlight(quote: string): Promise<boolean>;
  health(): Promise<HealthInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<void>;
}

export type PhaseCallback = (p: AnalysisPhase, progress?: { done?: number; total?: number }) => void;

const DEFAULTS: Settings = { backendUrl: DEFAULT_BACKEND_URL, usePageAgentLocator: false, privacyAcknowledged: false };

async function activeTabId(): Promise<number | null> {
  const fromQuery = new URLSearchParams(location.search).get('tabId');
  if (fromQuery) return Number(fromQuery);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/** Resolves when the background worker writes `result:<tabId>`; forwards progress updates. */
function waitForResult(tabId: number, onPhase: PhaseCallback): Promise<AnalyzeOutcome> {
  const pKey = `progress:${tabId}`;
  const rKey = `result:${tabId}`;
  return new Promise((resolve) => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      const p = changes[pKey]?.newValue as AnalysisProgress | undefined;
      if (p && typeof p === 'object') onPhase(p.phase, p);
      const r = changes[rKey]?.newValue as (AnalyzeOutcome & { ts: number }) | undefined;
      if (r) {
        chrome.storage.onChanged.removeListener(listener);
        resolve(r);
      }
    };
    chrome.storage.onChanged.addListener(listener);
  });
}

export const chromeApi: ContractLensApi = {
  async inspect() {
    const tabId = await activeTabId();
    if (tabId === null || !Number.isFinite(tabId)) return { ok: false, error: 'Etkin sekme bulunamadı.' };
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return { ok: false, error: `Sekme okunamadı: ${(e as Error).message}` };
    }
    if (!tab.url || !/^https?:|^file:/.test(tab.url)) return { ok: false, unsupported: true, error: 'Bu sayfa türü analiz edilemez (tarayıcı veya uzantı sayfası).' };
    const res = (await chrome.runtime.sendMessage({ type: 'CL_INSPECT', tabId })) as { ok: boolean; result?: InspectResult; error?: string };
    if (res?.ok && res.result) return { ok: true, result: res.result };
    const err = res?.error ?? 'Bilinmeyen hata';
    return { ok: false, error: err, unsupported: /Cannot access|cannot be scripted|chrome:\/\//i.test(err) };
  },
  async analyze(opts, onPhase) {
    const tabId = await activeTabId();
    if (tabId === null) return { ok: false, code: 'unknown', error: 'Etkin sekme bulunamadı.' };
    await chrome.storage.session.remove(`result:${tabId}`);
    const wait = waitForResult(tabId, onPhase);
    await chrome.runtime.sendMessage({ type: 'CL_ANALYZE', tabId, ...opts });
    return wait;
  },
  async resumePending(onPhase) {
    const tabId = await activeTabId();
    if (tabId === null) return null;
    const p = (await chrome.storage.session.get(`progress:${tabId}`))[`progress:${tabId}`] as AnalysisProgress | undefined;
    if (!p || typeof p !== 'object' || p.phase === 'done' || p.phase === 'error' || Date.now() - p.ts > 2 * 60_000) return null;
    onPhase(p.phase, p);
    return waitForResult(tabId, onPhase);
  },
  async getReport() {
    const tabId = await activeTabId();
    if (tabId === null) return null;
    return (await chrome.runtime.sendMessage({ type: 'CL_GET_REPORT', tabId })) as Report | null;
  },
  async openFullReport() {
    const tabId = await activeTabId();
    if (tabId === null) return;
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.setOptions({ tabId, path: `sidepanel.html?tabId=${tabId}`, enabled: true });
      await chrome.sidePanel.open({ tabId });
    } else {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}`) });
    }
  },
  async highlight(quote) {
    const tabId = await activeTabId();
    if (tabId === null) return false;
    const r = (await chrome.runtime.sendMessage({ type: 'CL_HIGHLIGHT', tabId, quote })) as { found?: boolean };
    return Boolean(r?.found);
  },
  async health() {
    return (await chrome.runtime.sendMessage({ type: 'CL_HEALTH' })) as HealthInfo;
  },
  async getSettings() {
    const s = await chrome.storage.local.get('settings');
    const stored = (s.settings as Partial<Settings> | undefined) ?? {};
    if ((stored.settingsVersion ?? 1) < 2) delete stored.usePageAgentLocator; // locator became opt-in in v2
    return { ...DEFAULTS, ...stored, settingsVersion: 2 };
  },
  async saveSettings(patch) {
    const cur = await this.getSettings();
    await chrome.storage.local.set({ settings: { ...cur, ...patch } });
  },
};
