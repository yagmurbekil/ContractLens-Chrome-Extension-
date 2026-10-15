import { DOCUMENT_TYPE_LABEL_TR } from '../lib/detect';
import type { Report } from '../lib/schema';
import { RISK_LEVEL_TR } from '../lib/score';
import { CATEGORY_TR } from './components';

/**
 * Report export. Contains only the report itself (no settings, backend URL,
 * keys or prompts), so it is safe to share.
 */
export function reportToMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# ContractLens raporu — ${r.domain}`);
  lines.push('');
  lines.push(`- Sayfa: ${r.url}`);
  lines.push(`- Belge türü: ${DOCUMENT_TYPE_LABEL_TR[r.documentType]}`);
  lines.push(`- Tarih: ${r.generatedAt}`);
  lines.push(`- Mod: ${r.mode === 'llm' ? `LLM (${r.provider} / ${r.model})` : 'Demo (kural tabanlı, LLM değil)'}`);
  lines.push(`- Puan: ${r.overallRiskScore ?? '—'} / 100 · Seviye: ${r.riskLevel ? RISK_LEVEL_TR[r.riskLevel] : 'Belirsiz'} · Durum: ${r.status}`);
  lines.push('');
  lines.push(r.scoreExplanationTr);
  lines.push('');
  lines.push(`## Doğrulanmış bulgular (${r.verifiedFindings.length})`);
  for (const f of r.verifiedFindings) {
    lines.push('');
    lines.push(`### ${f.titleTr} — ${RISK_LEVEL_TR[f.severity]} (${CATEGORY_TR[f.category]})`);
    lines.push(`> ${f.originalQuote}`);
    lines.push('');
    lines.push(f.explanationTr);
    lines.push(`- Olası etkisi: ${f.potentialImpactTr}`);
    if (f.uncertaintyTr) lines.push(`- Belirsizlik: ${f.uncertaintyTr}`);
    lines.push(`- Kaynak bölüm: ${f.sourceSection ?? '—'} · Güven: %${Math.round(f.confidence * 100)} · Kanıt: doğrulandı`);
  }
  if (r.unclearTermsTr.length) {
    lines.push('', '## Tam anlaşılamayan / doğrulanamayan noktalar');
    r.unclearTermsTr.forEach((t) => lines.push(`- ${t}`));
  }
  if (r.limitationsTr.length) {
    lines.push('', '## Sınırlamalar');
    r.limitationsTr.forEach((t) => lines.push(`- ${t}`));
  }
  if (r.security.injectionDetected) lines.push('', '**Güvenlik uyarısı:** Sayfada istem enjeksiyonu girişimi tespit edildi; uygulanmadı.');
  lines.push('', '---', r.disclaimerTr);
  return lines.join('\n');
}
