import type { Category, Report, ReportFinding, RiskLevel, Severity } from '../lib/schema';
import { RISK_LEVEL_TR } from '../lib/score';
import { DISCLAIMER_TR } from '../lib/config';

export const CATEGORY_TR: Record<Category, string> = {
  data_collection: 'Veri toplama',
  data_sharing: 'Veri paylaşımı',
  data_retention: 'Veri saklama',
  tracking_cookies: 'Takip / çerezler',
  ai_training: 'Yapay zekâ eğitimi',
  auto_renewal: 'Otomatik yenileme',
  cancellation: 'İptal',
  refunds: 'İade',
  price_changes: 'Fiyat değişikliği',
  unilateral_changes: 'Tek taraflı değişiklik',
  termination_suspension: 'Fesih / askıya alma',
  liability_limitation: 'Sorumluluk sınırlaması',
  indemnification: 'Tazmin',
  arbitration_class_waiver: 'Tahkim / toplu dava',
  jurisdiction: 'Yetkili mahkeme / hukuk',
  content_license: 'İçerik lisansı',
  warranty_disclaimer: 'Garanti reddi',
  other: 'Diğer',
};

export const CONCERN_TR: Record<ReportFinding['concernType'], string> = {
  privacy: 'Gizlilik',
  financial: 'Finansal',
  contractual: 'Sözleşmesel',
  unfavorable_term: 'Aleyhe koşul',
  uncertainty: 'Belirsizlik',
};

export const SEVERITY_TR: Record<Severity, string> = RISK_LEVEL_TR;

export function Logo() {
  return (
    <svg className="cl-logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M10 9h9l4 4v10H10z" fill="none" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 15h7M13 18.5h5" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="21.5" cy="21.5" r="3.4" fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth="1.8" />
      <path d="m24 24 2.4 2.4" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Header({ subtitle, right }: { subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="cl-header">
      <Logo />
      <div className="cl-brand">
        ContractLens
        <small>{subtitle ?? 'Sözleşme risk analizi'}</small>
      </div>
      <div className="cl-spacer" />
      {right}
    </header>
  );
}

export function Disclaimer() {
  return (
    <footer className="cl-disclaimer" role="note" data-testid="disclaimer">
      {DISCLAIMER_TR}
    </footer>
  );
}

export function LevelPill({ level, label }: { level: RiskLevel | null; label?: string }) {
  return <span className={`cl-pill lvl-${level ?? 'none'}`}>{label ?? (level ? RISK_LEVEL_TR[level] : 'Belirsiz')}</span>;
}

export function statusHeadline(r: Report): string {
  switch (r.status) {
    case 'insufficient_data':
      return 'Yetersiz veri';
    case 'uncertain':
      return 'Analiz belirsiz';
    case 'failed':
      return 'Analiz başarısız';
    default:
      return r.riskLevel ? `${RISK_LEVEL_TR[r.riskLevel]} risk` : '';
  }
}

export function ScoreBlock({ report }: { report: Report }) {
  const score = report.overallRiskScore;
  return (
    <div className="cl-card" data-testid="score-block">
      <div className="cl-score">
        <div className="cl-score-num" data-testid="risk-score" aria-label={score === null ? 'Puan yok' : `Risk puanı ${score} / 100`}>
          {score === null ? '—' : score}
          <small> / 100</small>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="cl-row">
            <LevelPill level={report.status === 'ok' || report.status === 'uncertain' ? report.riskLevel : null} label={statusHeadline(report)} />
          </div>
          {report.mode === 'demo' && (
            <span className="cl-tag cl-tag-warn" data-testid="demo-badge">
              Kural tabanlı analiz — LLM değil
            </span>
          )}
        </div>
      </div>
      {score !== null && report.riskLevel && (
        <div className="cl-meter" aria-hidden="true">
          <span className={`bar-${report.riskLevel}`} style={{ width: `${Math.max(2, score)}%` }} />
        </div>
      )}
    </div>
  );
}

export function EvidenceTag({ f }: { f: ReportFinding }) {
  if (f.evidence.status === 'verified') return <span className="cl-tag cl-tag-ok" data-testid="evidence-verified">Kanıt doğrulandı</span>;
  return <span className="cl-tag cl-tag-warn" data-testid="evidence-unverified">Doğrulanamadı</span>;
}

export function FindingCard({ f, onShowSource, compact }: { f: ReportFinding; onShowSource?: (q: string) => void; compact?: boolean }) {
  return (
    <article className="cl-finding" data-testid="finding" data-category={f.category} data-evidence={f.evidence.status}>
      <div className="cl-finding-head">
        <h3>{f.titleTr}</h3>
        <LevelPill level={f.severity} />
      </div>
      <div className="cl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="cl-tag">{CATEGORY_TR[f.category]}</span>
        <span className="cl-tag">{CONCERN_TR[f.concernType]}</span>
        <EvidenceTag f={f} />
        <span className="cl-tag">Güven: %{Math.round(f.confidence * 100)}</span>
      </div>
      <blockquote className="cl-quote" lang="" data-testid="original-quote">
        “{f.originalQuote}”
      </blockquote>
      <p data-testid="explanation">{f.explanationTr}</p>
      {!compact && (
        <>
          <p className="cl-kv">
            <b>Olası etkisi: </b>
            {f.potentialImpactTr}
          </p>
          {f.uncertaintyTr && (
            <p className="cl-kv">
              <b>Belirsizlik: </b>
              {f.uncertaintyTr}
            </p>
          )}
          <p className="cl-kv">
            <b>Kaynak bölüm: </b>
            {f.sourceSection ?? 'Belirtilmemiş'} · <b>Kanıt: </b>
            {f.evidence.detailTr}
            {f.evidence.docStart !== null && ` (karakter ${f.evidence.docStart}–${f.evidence.docEnd})`}
          </p>
        </>
      )}
      {onShowSource && f.evidence.status === 'verified' && (
        <div>
          <button type="button" className="cl-link" onClick={() => onShowSource(f.originalQuote)}>
            Sayfada kaynağı göster
          </button>
        </div>
      )}
    </article>
  );
}
