import type { ExtractedDocument } from './extract';

/**
 * Heuristic prompt-injection signal detector.
 *
 * Purpose: surface a security warning in the UI. Detection does NOT gate
 * safety — the real defences are (1) trusted/untrusted prompt separation,
 * (2) strict schema validation, (3) independent quote verification,
 * (4) deterministic scoring and (5) a read-only Page Agent tool set with
 * network access restricted to the configured backend.
 *
 * A detected injection attempt is reported as a security observation; it
 * does not by itself make the contract "risky".
 */

export interface InjectionSignal {
  kind: string;
  excerpt: string;
  location: 'visible' | 'hidden' | 'comment' | 'attribute';
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'override_instructions', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|directives?)/i },
  { kind: 'override_instructions', re: /(önceki|yukarıdaki|tüm)\s+(talimat|komut|kural)[a-zçğıöşü]*\s+(yok say|unut|görmezden gel)/i },
  { kind: 'role_hijack', re: /\b(you are now|act as|from now on you|new instructions?:|system:\s|<\/?system>|\[system\]|developer mode)/i },
  { kind: 'secret_exfiltration', re: /\b(reveal|print|show|output|send|leak)\b[^.\n]{0,40}\b(api[_ -]?key|system prompt|secret|token|credentials?|password)/i },
  { kind: 'verdict_manipulation', re: /\b(report|say|state|conclude|output|mark)\b[^.\n]{0,40}\b(this|the)?\s*(website|site|document|contract|policy|page)\b[^.\n]{0,20}\b(is )?(safe|low[- ]risk|harmless|trustworthy|risk[- ]free)/i },
  { kind: 'verdict_manipulation', re: /\b(risk ?score|overallRiskScore)\b[^.\n]{0,20}(=|:|to|of)\s*0\b/i },
  { kind: 'consent_action', re: /\b(click|press|tap|select)\b[^.\n]{0,30}\b(accept|agree|consent|allow all|i agree|kabul)/i },
  { kind: 'data_exfiltration', re: /\b(send|post|upload|transmit|forward|fetch)\b[^.\n]{0,60}\b(https?:\/\/|webhook|endpoint|to (this|the following) (url|address))/i },
  { kind: 'fabricate_evidence', re: /\b(fabricate|invent|make up|add)\b[^.\n]{0,40}\b(quote|quotation|finding|evidence|citation)/i },
  { kind: 'json_injection', re: /"(overallRiskScore|findings|riskLevel|originalQuote)"\s*:/ },
];

function excerptAround(text: string, idx: number, len: number): string {
  const s = Math.max(0, idx - 30);
  const e = Math.min(text.length, idx + len + 30);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

export function scanText(text: string, location: InjectionSignal['location']): InjectionSignal[] {
  const out: InjectionSignal[] = [];
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ kind, excerpt: excerptAround(text, m.index, m[0].length).slice(0, 240), location });
  }
  return out;
}

export function detectInjection(doc: Pick<ExtractedDocument, 'text' | 'excluded'>): InjectionSignal[] {
  const signals: InjectionSignal[] = [...scanText(doc.text, 'visible')];
  for (const ex of doc.excluded) signals.push(...scanText(ex.text, ex.location));
  // de-duplicate by kind+location+excerpt
  const seen = new Set<string>();
  return signals.filter((s) => {
    const k = `${s.kind}|${s.location}|${s.excerpt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);
}

export const INJECTION_KIND_TR: Record<string, string> = {
  override_instructions: 'Talimatları geçersiz kılma girişimi',
  role_hijack: 'Rol/sistem mesajı taklidi',
  secret_exfiltration: 'Gizli bilgi (API anahtarı, sistem istemi) talebi',
  verdict_manipulation: 'Analiz sonucunu yönlendirme girişimi',
  consent_action: 'Onay/kabul düğmesine tıklatma talimatı',
  data_exfiltration: 'Veriyi dış adrese gönderme talimatı',
  fabricate_evidence: 'Sahte alıntı/kanıt üretme talimatı',
  json_injection: 'Sayfa içinde sahte JSON çıktı yapısı',
};
