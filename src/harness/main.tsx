/**
 * ContractLens test harness (development & Cypress only — not part of the
 * extension bundle).
 *
 * Why: Cypress cannot open or drive a chrome-extension:// popup. The harness
 * renders the SAME Popup and ReportView components and runs the SAME
 * pipeline (extract → classify → chunk → analyze → validate → verify → score)
 * against a fixture page loaded in a same-origin iframe. Only the transport
 * differs: direct function calls instead of chrome.runtime messages.
 *
 * Query parameters:
 *   fixture=<file in /fixtures/>   page to load (default privacy-normal.html)
 *   mode=demo|backend              demo = local rule-based demo (labelled);
 *                                  backend = POST to ?backend=<url>/v1/analyze
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import type { ContractLensApi } from '../ui/api';
import { Popup } from '../ui/Popup';
import { ReportView } from '../ui/ReportView';
import { prepareDocument, type PreparedDocument } from '../lib/pipeline';
import { candidateStats } from '../lib/candidates';
import { analyzePrepared, AnalysisError, checkHealth } from '../lib/service';
import type { InspectResult, Settings } from '../lib/messages';
import type { Report } from '../lib/schema';

const params = new URLSearchParams(location.search);
const fixture = params.get('fixture') ?? 'privacy-normal.html';
const mode = (params.get('mode') ?? 'demo') as 'demo' | 'backend';
const backendUrl = params.get('backend') ?? 'http://localhost:8787';

let frameReady: Promise<HTMLIFrameElement> | null = null;
function frame(): Promise<HTMLIFrameElement> {
  if (frameReady) return frameReady;
  frameReady = new Promise((resolve) => {
    const iframe = document.getElementById('cl-frame') as HTMLIFrameElement;
    const onLoad = () => {
      const d = iframe.contentDocument!;
      const s = d.createElement('script');
      s.src = `${location.origin}/harness-agent.js`;
      s.onload = () => resolve(iframe);
      d.head.appendChild(s);
    };
    if (iframe.contentDocument?.readyState === 'complete' && iframe.contentWindow?.location.href !== 'about:blank') onLoad();
    else iframe.addEventListener('load', onLoad, { once: true });
  });
  return frameReady;
}

let prepared: PreparedDocument | null = null;
let lastReport: Report | null = null;
let settings: Settings = { backendUrl, usePageAgentLocator: false, privacyAcknowledged: false };
let openReport: () => void = () => undefined;

const harnessApi: ContractLensApi = {
  async inspect() {
    const iframe = await frame();
    const w = iframe.contentWindow!;
    const doc = w.__clAgent!.extract();
    prepared = prepareDocument(doc);
    const pageAgent = await w.__clAgent!.inspect();
    const info: InspectResult = {
      tabId: 0,
      url: doc.url,
      domain: new URL(doc.url).hostname,
      title: doc.title,
      classification: prepared.classification,
      stats: doc.stats,
      sectionsCount: doc.sections.length,
      chunksTotal: prepared.chunks.length,
      chunksSelected: prepared.selected.length,
      analyzedChars: prepared.analyzedChars,
      injectionSignals: prepared.injectionSignals.length,
      ...candidateStats(prepared),
      pageAgent,
    };
    return { ok: true, result: info };
  },
  async analyze(opts, onPhase) {
    if (!prepared) return { ok: false, code: 'extraction', error: 'Sayfa henüz incelenmedi.' };
    onPhase('extracting');
    await new Promise((r) => setTimeout(r, 250));
    onPhase('sending');
    try {
      const report = await analyzePrepared(prepared, { backendUrl: settings.backendUrl, typeOverride: opts.typeOverride, demo: mode === 'demo' || opts.demo });
      lastReport = report;
      (window as unknown as { __clLastReport: Report }).__clLastReport = report;
      return { ok: true, report };
    } catch (e) {
      if (e instanceof AnalysisError) return { ok: false, code: e.code, error: e.message };
      return { ok: false, code: 'unknown', error: (e as Error).message };
    }
  },
  async resumePending() {
    return null;
  },
  async getReport() {
    return lastReport;
  },
  async openFullReport() {
    openReport();
  },
  async highlight(quote) {
    const iframe = await frame();
    const w = iframe.contentWindow as unknown as { find?: (s: string, cs: boolean, b: boolean, wrap: boolean) => boolean };
    return Boolean(w.find?.(quote.replace(/\s+/g, ' ').trim().slice(0, 120), true, false, true));
  },
  async health() {
    if (mode === 'demo') return { reachable: true, mode: 'demo', provider: 'demo-rules', model: 'keyword-rules-v1', agentProxy: false };
    return checkHealth(settings.backendUrl);
  },
  async getSettings() {
    return settings;
  },
  async saveSettings(patch) {
    settings = { ...settings, ...patch };
  },
};

function Harness() {
  const [view, setView] = useState<'popup' | 'report'>('popup');
  const aside = useRef<HTMLElement>(null);
  openReport = () => setView('report');
  useEffect(() => {
    aside.current?.scrollTo({ top: 0 });
  }, [view]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 420px', height: '100vh' }}>
      <section style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="cl-muted" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }} data-testid="harness-bar">
          Test sayfası: <code>{fixture}</code> · mod: <b>{mode === 'demo' ? 'demo (kural tabanlı)' : `sunucu ${backendUrl}`}</b>
        </div>
        <iframe id="cl-frame" title="Analiz edilen sayfa" src={`/fixtures/${encodeURIComponent(fixture)}`} style={{ border: 0, flex: 1, width: '100%', background: '#fff' }} />
      </section>
      <aside ref={aside} style={{ overflow: 'auto', background: 'var(--bg)' }}>
        {view === 'popup' ? (
          <div style={{ margin: '0 auto', width: 380, boxShadow: '0 1px 0 var(--line)' }}>
            <Popup api={harnessApi} />
          </div>
        ) : (
          <div>
            <button type="button" className="cl-link" style={{ margin: '10px 16px 0' }} onClick={() => setView('popup')} data-testid="back-to-popup">
              ← Açılır pencereye dön
            </button>
            <ReportView api={harnessApi} initial={lastReport} />
          </div>
        )}
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
