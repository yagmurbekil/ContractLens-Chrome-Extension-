import { useEffect, useState } from 'react';
import { DOCUMENT_TYPE_LABEL_TR } from '../lib/detect';
import { INJECTION_KIND_TR } from '../lib/injection';
import type { Report } from '../lib/schema';
import type { ContractLensApi } from './api';
import { Disclaimer, FindingCard, Header, ScoreBlock } from './components';
import { reportToMarkdown } from './exportReport';

export function ReportView({ api, initial }: { api: ContractLensApi; initial?: Report | null }) {
  const [report, setReport] = useState<Report | null | undefined>(initial);
  const [copied, setCopied] = useState(false);
  const [highlightMsg, setHighlightMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initial !== undefined) {
      setReport(initial);
      return;
    }
    void api.getReport().then(setReport);
  }, [api, initial]);

  const showSource = async (quote: string) => {
    const ok = await api.highlight(quote);
    setHighlightMsg(ok ? 'Alıntı sayfada seçildi.' : 'Alıntı sayfada otomatik bulunamadı; metni sayfada arayabilirsiniz.');
  };

  if (report === undefined) return <p className="cl-muted" style={{ padding: 16 }}>Yükleniyor…</p>;
  if (report === null)
    return (
      <div className="cl-app cl-report">
        <Header subtitle="Ayrıntılı rapor" />
        <main className="cl-body">
          <div className="cl-alert cl-alert-info" data-testid="report-empty">
            <strong>Henüz rapor yok</strong>
            Bu sekme için önce açılır pencereden “Sayfayı Analiz Et” ile analiz başlatın.
          </div>
        </main>
        <Disclaimer />
      </div>
    );

  const exportMd = async () => {
    const md = reportToMarkdown(report);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `contractlens-${report.domain || 'rapor'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="cl-app cl-report" data-testid="full-report" data-status={report.status}>
      <Header subtitle="Ayrıntılı rapor" />
      <main className="cl-body">
        <div>
          <div className="cl-muted">{report.domain}</div>
          <h1 style={{ fontSize: 18, margin: '2px 0 0', lineHeight: 1.3 }}>{report.title || report.url}</h1>
          <div className="cl-muted">
            {DOCUMENT_TYPE_LABEL_TR[report.documentType]} · {new Date(report.generatedAt).toLocaleString('tr-TR')} · {report.mode === 'llm' ? `${report.provider} / ${report.model}` : 'Kural tabanlı mod (LLM değil)'}
          </div>
        </div>

        <ScoreBlock report={report} />
        <p className="cl-small" style={{ margin: 0 }}>{report.scoreExplanationTr}</p>
        {report.summaryTr && <p style={{ margin: 0 }}>{report.summaryTr}</p>}

        {report.security.injectionDetected && (
          <div className="cl-alert cl-alert-warn" data-testid="injection-warning">
            <strong>Güvenlik uyarısı: olası istem enjeksiyonu</strong>
            Sayfa, yapay zekâyı yönlendirmeye çalışan ifadeler içeriyor. ContractLens bu ifadeleri talimat olarak uygulamadı, hiçbir düğmeye tıklamadı ve veriyi yalnızca yapılandırılmış sunucuya gönderdi. Bu durum tek başına sözleşmenin riskli olduğu anlamına gelmez.
            {report.security.signals.length > 0 && (
              <ul className="cl-bullets" style={{ marginTop: 6 }}>
                {report.security.signals.slice(0, 6).map((s, i) => (
                  <li key={i}>
                    {INJECTION_KIND_TR[s.kind] ?? s.kind} ({s.location === 'visible' ? 'görünür metin' : s.location === 'hidden' ? 'gizli öğe' : s.location === 'comment' ? 'HTML yorumu' : 'öznitelik'}): <i>{s.excerpt}</i>
                  </li>
                ))}
              </ul>
            )}
            {report.security.modelFlagged && <div style={{ marginTop: 4 }}>Model de bu bölümde enjeksiyon girişimi olduğunu işaretledi.</div>}
          </div>
        )}

        <h2 className="cl-section-title">Doğrulanmış bulgular ({report.verifiedFindings.length})</h2>
        {highlightMsg && <p className="cl-muted" role="status">{highlightMsg}</p>}
        {report.verifiedFindings.length === 0 ? (
          <p className="cl-muted" data-testid="no-findings">
            Kaynakta doğrulanabilen riskli madde bulunamadı. Bu, belgenin risksiz olduğu anlamına gelmez.
          </p>
        ) : (
          <ul className="cl-list">
            {report.verifiedFindings.map((f) => (
              <li key={f.id}>
                <FindingCard f={f} onShowSource={showSource} />
              </li>
            ))}
          </ul>
        )}

        {(report.unclearTermsTr.length > 0 || report.unverifiedFindings.length > 0) && (
          <>
            <h2 className="cl-section-title">Tam anlaşılamayan veya doğrulanamayan noktalar</h2>
            <div className="cl-card" data-testid="unclear-section">
              <p className="cl-small" style={{ marginTop: 0 }}>
                Aşağıdaki gözlemler doğrulanmış risk olarak <b>gösterilmez</b> ve puana katkı yapmaz. Alıntısı kaynakta bulunamayan model çıktıları burada listelenir; yeni bir analiz isteyebilir veya orijinal metni inceleyebilirsiniz.
              </p>
              <ul className="cl-bullets">
                {report.unclearTermsTr.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              {report.unverifiedFindings.length > 0 && (
                <details className="cl-details" style={{ marginTop: 8 }}>
                  <summary>Doğrulanamayan {report.unverifiedFindings.length} model çıktısını göster</summary>
                  <ul className="cl-list" style={{ marginTop: 8 }}>
                    {report.unverifiedFindings.map((f) => (
                      <li key={f.id}>
                        <FindingCard f={f} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </>
        )}

        <h2 className="cl-section-title">Sınırlamalar ve kapsam</h2>
        <div className="cl-card">
          <div className="cl-grid-2" style={{ marginBottom: 8 }}>
            <div className="cl-stat">Çıkarılan metin<b>{report.coverage.extractedChars.toLocaleString('tr-TR')} kr.</b></div>
            <div className="cl-stat">Analiz edilen<b>{report.coverage.analyzedChars.toLocaleString('tr-TR')} kr.</b></div>
            <div className="cl-stat">Analiz edilen bölüm<b>{report.coverage.chunksAnalyzed} / {report.coverage.chunksTotal}</b></div>
            <div className="cl-stat">Şema hatası<b>{report.coverage.schemaFailures}</b></div>
          </div>
          {report.limitationsTr.length > 0 ? (
            <ul className="cl-bullets" data-testid="limitations">
              {report.limitationsTr.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="cl-muted" style={{ margin: 0 }}>Belirtilmiş ek sınırlama yok.</p>
          )}
          {report.needsHumanReview && <p className="cl-small" style={{ marginBottom: 0 }}><b>İnsan incelemesi önerilir.</b></p>}
        </div>

        <div className="cl-row">
          <button type="button" className="cl-btn" onClick={exportMd} data-testid="copy-report">
            {copied ? 'Kopyalandı' : 'Raporu kopyala (Markdown)'}
          </button>
          <button type="button" className="cl-btn" onClick={download}>
            JSON indir
          </button>
        </div>
      </main>
      <Disclaimer />
    </div>
  );
}
