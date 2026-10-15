import { useEffect, useState } from 'react';
import { DOCUMENT_TYPE_LABEL_TR } from '../lib/detect';
import { SUFFICIENCY } from '../lib/config';
import type { AnalysisPhase, AnalyzeOutcome, HealthInfo, InspectResult, Settings } from '../lib/messages';
import { DOCUMENT_TYPES, type DocumentType, type Report } from '../lib/schema';
import type { ContractLensApi } from './api';
import { Disclaimer, FindingCard, Header, ScoreBlock } from './components';

type State =
  | { kind: 'inspecting' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'inspect_error'; message: string }
  | { kind: 'ready'; info: InspectResult }
  | { kind: 'analyzing'; info: InspectResult; phase: AnalysisPhase; done?: number; total?: number }
  | { kind: 'result'; info: InspectResult; report: Report }
  | { kind: 'error'; info: InspectResult; outcome: Extract<AnalyzeOutcome, { ok: false }> };

const PHASES: Array<[AnalysisPhase, string]> = [
  ['extracting', 'Sayfa metni çıkarılıyor'],
  ['locating', 'Page Agent ilgili bölümleri buluyor'],
  ['sending', 'Metin analiz ediliyor, alıntılar kaynakta doğrulanıyor'],
];

export function Popup({ api }: { api: ContractLensApi }) {
  const [state, setState] = useState<State>({ kind: 'inspecting' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [typeOverride, setTypeOverride] = useState<DocumentType | ''>('');
  const [showSettings, setShowSettings] = useState(false);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, h, insp, existing] = await Promise.all([
        api.getSettings(),
        api.health(),
        api.inspect().catch((e: Error) => ({ ok: false as const, error: e.message, unsupported: false })),
        api.getReport().catch(() => null),
      ]);
      setSettings(s);
      setAck(s.privacyAcknowledged);
      setHealth(h);
      if (!insp.ok) {
        setState(insp.unsupported ? { kind: 'unsupported', message: insp.error } : { kind: 'inspect_error', message: insp.error });
        return;
      }
      const info = insp.result;
      const onPhase = (phase: AnalysisPhase, pr?: { done?: number; total?: number }) =>
        setState((st) => (st.kind === 'analyzing' ? { ...st, phase, done: pr?.done, total: pr?.total } : st));
      // An analysis started earlier may still be running in the background (popup was closed).
      const pendingPromise = api.resumePending((phase, pr) => {
        setState((st) => (st.kind === 'analyzing' ? st : { kind: 'analyzing', info, phase, done: pr?.done, total: pr?.total }));
        onPhase(phase, pr);
      });
      const pending = await pendingPromise;
      if (pending) {
        setState(pending.ok ? { kind: 'result', info, report: pending.report } : { kind: 'error', info, outcome: pending });
        return;
      }
      if (existing && existing.url === info.url) setState({ kind: 'result', info, report: existing });
      else setState({ kind: 'ready', info });
    })();
  }, [api]);

  const run = async (info: InspectResult, demo = false) => {
    if (!ack) return;
    if (settings && !settings.privacyAcknowledged) await api.saveSettings({ privacyAcknowledged: true });
    setState({ kind: 'analyzing', info, phase: 'extracting' });
    const outcome = await api.analyze({ typeOverride: typeOverride || undefined, demo }, (phase, pr) =>
      setState((s) => (s.kind === 'analyzing' ? { ...s, phase, done: pr?.done, total: pr?.total } : s)),
    );
    if (outcome.ok) setState({ kind: 'result', info, report: outcome.report });
    else setState({ kind: 'error', info, outcome });
  };

  const settingsButton = (
    <button type="button" className="cl-icon-btn" aria-label="Ayarlar" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
      ⚙
    </button>
  );

  return (
    <div className="cl-app cl-popup" data-testid="popup">
      <Header right={settingsButton} />
      <main className="cl-body">
        {showSettings && settings && <SettingsPanel api={api} settings={settings} onChange={setSettings} health={health} />}

        {state.kind === 'inspecting' && <p className="cl-muted" data-testid="state-inspecting">Sayfa inceleniyor…</p>}

        {state.kind === 'unsupported' && (
          <div className="cl-alert cl-alert-info" data-testid="state-unsupported">
            <strong>Bu sayfa desteklenmiyor</strong>
            {state.message}
          </div>
        )}
        {state.kind === 'inspect_error' && (
          <div className="cl-alert cl-alert-danger" data-testid="state-inspect-error">
            <strong>Sayfa okunamadı</strong>
            {state.message}
          </div>
        )}

        {'info' in state && <PageMeta info={state.info} />}

        {state.kind === 'ready' && (
          <>
            {state.info.injectionSignals > 0 && (
              <div className="cl-alert cl-alert-warn" data-testid="injection-warning-pre">
                <strong>Güvenlik uyarısı</strong>
                Sayfada yapay zekâyı yönlendirmeye çalışan {state.info.injectionSignals} şüpheli ifade tespit edildi. Bu ifadeler talimat olarak değil, belge içeriği olarak ele alınır.
              </div>
            )}
            {(state.info.classification.confidence < SUFFICIENCY.minClassificationConfidence || !state.info.classification.isLikelyLegal) && (
              <div className="cl-alert cl-alert-warn" data-testid="classification-uncertain">
                <strong>Belge türü belirsiz</strong>
                Bu sayfa bir hukuki belge olmayabilir. Yine de analiz etmek istiyor musunuz? İsterseniz türü seçin:
                <select className="cl-select" style={{ marginTop: 8 }} value={typeOverride} onChange={(e) => setTypeOverride(e.target.value as DocumentType | '')} aria-label="Belge türü">
                  <option value="">Otomatik</option>
                  {DOCUMENT_TYPES.filter((t) => t !== 'unknown' && t !== 'not_legal').map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENT_TYPE_LABEL_TR[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <PrivacyNotice info={state.info} health={health} ack={ack} setAck={setAck} />
            {health && !health.reachable && (
              <div className="cl-alert cl-alert-info" data-testid="backend-offline">
                <strong>Analiz sunucusu çalışmıyor</strong>
                LLM analizi için yerel sunucuyu başlatın (<code>npm run backend</code>) veya kural tabanlı demo modunu kullanın.
              </div>
            )}
            <button type="button" className="cl-btn cl-btn-primary cl-btn-block" data-testid="analyze-btn" disabled={!ack || (health !== null && !health.reachable)} onClick={() => run(state.info)}>
              Sayfayı Analiz Et
            </button>
            {health && !health.reachable && (
              <button type="button" className="cl-btn cl-btn-block" data-testid="demo-btn" disabled={!ack} onClick={() => run(state.info, true)}>
                Kural tabanlı modda çalıştır (LLM yok)
              </button>
            )}
          </>
        )}

        {state.kind === 'analyzing' && (
          <div className="cl-card" data-testid="state-analyzing" aria-live="polite">
            <ol className="cl-steps">
              {PHASES.map(([p, label]) => {
                const idx = PHASES.findIndex(([x]) => x === state.phase);
                const me = PHASES.findIndex(([x]) => x === p);
                return (
                  <li key={p} className={me === idx ? 'active' : me < idx ? 'done' : ''}>
                    <span className="cl-dot" />
                    {label}
                    {p === 'sending' && me === idx && state.total ? ` (${state.done ?? 0}/${state.total} bölüm)` : ''}
                  </li>
                );
              })}
            </ol>
            <p className="cl-muted" style={{ margin: '10px 0 0' }}>
              Ücretsiz LLM katmanlarında bu işlem birkaç dakika sürebilir. Bu pencereyi kapatabilirsiniz; analiz arka planda sürer ve simgeye tekrar tıkladığınızda sonuç görünür.
            </p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="cl-alert cl-alert-danger" data-testid={`state-error-${state.outcome.code}`}>
            <strong>{errorTitle(state.outcome.code)}</strong>
            {state.outcome.error}
            <div className="cl-row" style={{ marginTop: 8 }}>
              <button type="button" className="cl-btn" onClick={() => setState({ kind: 'ready', info: state.info })}>
                Tekrar dene
              </button>
              {state.outcome.code === 'backend_unreachable' && (
                <button type="button" className="cl-btn" onClick={() => run(state.info, true)}>
                  Kural tabanlı modda çalıştır
                </button>
              )}
            </div>
          </div>
        )}

        {state.kind === 'result' && <CompactResult report={state.report} api={api} onRerun={() => setState({ kind: 'ready', info: state.info })} />}
      </main>
      <Disclaimer />
    </div>
  );
}

function errorTitle(code: string): string {
  switch (code) {
    case 'backend_unreachable':
      return 'Sunucuya ulaşılamadı';
    case 'malformed':
      return 'Geçersiz yanıt';
    case 'network':
      return 'Ağ hatası';
    case 'extraction':
      return 'Metin çıkarılamadı';
    default:
      return 'Beklenmeyen hata';
  }
}

function PageMeta({ info }: { info: InspectResult }) {
  return (
    <dl className="cl-meta" data-testid="page-meta">
      <dt>Alan adı</dt>
      <dd data-testid="page-domain">{info.domain || '—'}</dd>
      <dt>Belge türü</dt>
      <dd data-testid="doc-type" data-type={info.classification.type}>
        {DOCUMENT_TYPE_LABEL_TR[info.classification.type]}
        <span className="cl-muted"> · güven %{Math.round(info.classification.confidence * 100)}</span>
      </dd>
      <dt>Metin</dt>
      <dd>
        {info.stats.words.toLocaleString('tr-TR')} kelime · {info.sectionsCount} bölüm
      </dd>
      <dt>Page Agent</dt>
      <dd title={info.pageAgent.error ?? ''}>
        {info.pageAgent.available ? `${info.pageAgent.interactiveCount} etkileşimli öğe indekslendi` : 'kullanılamadı'}
        {info.pageAgent.consentControls.length > 0 && ` · ${info.pageAgent.consentControls.length} onay düğmesi (dokunulmaz)`}
      </dd>
    </dl>
  );
}

function PrivacyNotice({ info, health, ack, setAck }: { info: InspectResult; health: HealthInfo | null; ack: boolean; setAck: (v: boolean) => void }) {
  const dest = health?.reachable ? (health.mode === 'llm' ? `yerel ContractLens sunucusuna ve oradan ${health.provider} (${health.model}) LLM sağlayıcısına` : 'yerel ContractLens sunucusuna (demo modu, dışarı gönderilmez)') : 'hiçbir yere (demo modu tarayıcıda çalışır)';
  return (
    <div className="cl-card cl-small" data-testid="privacy-notice">
      <strong style={{ color: 'var(--ink)' }}>Gizlilik</strong>
      <p style={{ margin: '4px 0 8px' }}>
        Analiz başlatıldığında, kural motorunun bu sayfadan seçtiği {info.candidateCount} madde (yaklaşık {info.candidateChars.toLocaleString('tr-TR')} karakter), sayfa adresi ve başlığıyla birlikte {dest} gönderilir. Şifre, form alanı, çerez veya başka sekmelerden veri okunmaz. Tam metin kalıcı olarak saklanmaz; rapor tarayıcı kapanınca silinir.
      </p>
      <label className="cl-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="privacy-ack" />
        Anladım, metnin analiz için gönderilmesini onaylıyorum.
      </label>
    </div>
  );
}

function CompactResult({ report, api, onRerun }: { report: Report; api: ContractLensApi; onRerun: () => void }) {
  const top = report.verifiedFindings.slice(0, 3);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="state-result" data-status={report.status}>
      <ScoreBlock report={report} />
      <p className="cl-small" style={{ margin: 0 }} data-testid="score-explanation">
        {report.scoreExplanationTr}
      </p>
      {report.security.injectionDetected && (
        <div className="cl-alert cl-alert-warn" data-testid="injection-warning">
          <strong>Güvenlik uyarısı</strong>
          Sayfada analizi yönlendirmeye çalışan talimatlar bulundu. Bunlar uygulanmadı; bulgular yine de bağımsız alıntı doğrulamasından geçti.
        </div>
      )}
      {top.length > 0 ? (
        <ul className="cl-list" aria-label="Önemli bulgular">
          {top.map((f) => (
            <li key={f.id}>
              <FindingCard f={f} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cl-muted" data-testid="no-findings">
          Doğrulanmış bulgu yok. Bu sonuç belgenin güvenli olduğunu göstermez.
        </p>
      )}
      <div className="cl-row">
        <button type="button" className="cl-btn cl-btn-primary" style={{ flex: 1 }} onClick={() => api.openFullReport()} data-testid="full-report-btn">
          Tüm Raporu Gör
        </button>
        <button type="button" className="cl-btn" onClick={onRerun}>
          Yeniden analiz
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({ api, settings, onChange, health }: { api: ContractLensApi; settings: Settings; onChange: (s: Settings) => void; health: HealthInfo | null }) {
  const [url, setUrl] = useState(settings.backendUrl);
  return (
    <div className="cl-card" data-testid="settings">
      <label className="cl-small" htmlFor="cl-backend">
        Sunucu adresi
      </label>
      <div className="cl-row" style={{ marginTop: 4 }}>
        <input id="cl-backend" className="cl-input" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button
          type="button"
          className="cl-btn"
          onClick={async () => {
            await api.saveSettings({ backendUrl: url });
            onChange({ ...settings, backendUrl: url });
          }}
        >
          Kaydet
        </button>
      </div>
      <label className="cl-check" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={settings.usePageAgentLocator}
          onChange={async (e) => {
            await api.saveSettings({ usePageAgentLocator: e.target.checked });
            onChange({ ...settings, usePageAgentLocator: e.target.checked });
          }}
        />
        Uzun belgelerde ilgili bölümleri Page Agent ile bul (salt okunur)
      </label>
      <p className="cl-muted" style={{ margin: '6px 0 0' }}>
        Durum: {health?.reachable ? `${health.mode === 'llm' ? 'LLM' : 'Demo'} · ${health.provider} ${health.model}` : 'sunucuya ulaşılamıyor'}
      </p>
    </div>
  );
}
