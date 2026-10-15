import type { DocumentType } from './schema';

/**
 * Heuristic document-type classifier using URL, title, headings and body
 * keywords. Returns a confidence in [0, 1]; the UI asks the user to confirm
 * when confidence is below SUFFICIENCY.minClassificationConfidence.
 */

export interface ClassificationInput {
  url: string;
  title: string;
  headings: string[];
  text: string;
}

export interface Classification {
  type: DocumentType;
  confidence: number;
  isLikelyLegal: boolean;
  signals: string[];
}

type Rule = { type: DocumentType; url: RegExp; title: RegExp; body: RegExp[] };

const RULES: Rule[] = [
  {
    type: 'privacy_policy',
    url: /privacy|gizlilik|kvkk|datenschutz|data-?policy/i,
    title: /privacy|gizlilik|kişisel veri|aydınlatma metni|datenschutz/i,
    body: [/personal (data|information)/gi, /\bprocess(ing)? (your|personal)/gi, /\bdata controller\b/gi, /kişisel veri/gi, /\bGDPR\b|\bCCPA\b|\bKVKK\b/g],
  },
  {
    type: 'terms_of_service',
    url: /terms|tos\b|conditions|legal|kullanim-?kosullari|sozlesme|user-?agreement/i,
    title: /terms|conditions|user agreement|kullanım koşulları|sözleşme|şartlar/i,
    body: [/\bterms of (service|use)\b/gi, /\bgoverning law\b/gi, /\bliability\b/gi, /\bindemnif/gi, /\byou agree\b/gi],
  },
  {
    type: 'subscription_terms',
    url: /subscription|billing|renewal|abonelik/i,
    title: /subscription|billing|abonelik|üyelik/i,
    body: [/auto(matic(ally)?)?[- ]renew/gi, /\bsubscription\b/gi, /\bbilling (cycle|period)\b/gi, /\bcancel(lation)?\b/gi, /otomatik (olarak )?yenilen/gi],
  },
  {
    type: 'cookie_policy',
    url: /cookie|cerez/i,
    title: /cookie|çerez/i,
    body: [/\bcookies?\b/gi, /\btracking technolog/gi, /\bpixel/gi, /çerez/gi],
  },
  {
    type: 'refund_policy',
    url: /refund|return|iade/i,
    title: /refund|return policy|iade/i,
    body: [/\brefund/gi, /\bchargeback/gi, /\bnon-?refundable\b/gi, /iade/gi],
  },
  {
    type: 'data_processing',
    url: /dpa|data-?processing/i,
    title: /data processing|veri işleme/i,
    body: [/\bsub-?processor/gi, /\bdata processor\b/gi, /\bstandard contractual clauses\b/gi],
  },
  {
    type: 'eula',
    url: /eula|license-?agreement/i,
    title: /end user license|eula|lisans sözleşmesi/i,
    body: [/\blicensed, not sold\b/gi, /\breverse engineer/gi],
  },
];

const GENERIC_LEGAL = [/\bshall\b/gi, /\bhereby\b/gi, /\bherein\b/gi, /\bpursuant\b/gi, /\bwarrant/gi, /\bagreement\b/gi, /\bpolicy\b/gi, /\bconsent\b/gi];

function count(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

export function classifyDocument(input: ClassificationInput): Classification {
  const signals: string[] = [];
  const text = input.text.slice(0, 120_000);
  const words = Math.max(1, text.split(/\s+/).length);
  const headingText = input.headings.join(' | ');
  let path = '';
  try {
    path = new URL(input.url).pathname;
  } catch {
    path = input.url;
  }

  const scores = RULES.map((r) => {
    let s = 0;
    if (r.url.test(path)) { s += 2.0; signals.push(`url:${r.type}`); }
    if (r.title.test(input.title)) { s += 2.5; signals.push(`title:${r.type}`); }
    if (r.title.test(headingText)) { s += 1.0; signals.push(`heading:${r.type}`); }
    const hits = r.body.reduce((a, re) => a + count(text, re), 0);
    s += Math.min(3, (hits / words) * 400);
    // Generic words like "Terms" appear in most legal titles; prefer the more specific type on ties.
    if (r.type !== 'terms_of_service' && (r.url.test(path) || r.title.test(input.title))) s += 0.75;
    return { type: r.type, s };
  }).sort((a, b) => b.s - a.s);

  const generic = GENERIC_LEGAL.reduce((a, re) => a + count(text, re), 0);
  const genericDensity = Math.min(1, (generic / words) * 60);
  const top = scores[0]!;
  const second = scores[1]!;

  if (top.s < 1.2 && genericDensity < 0.35) {
    return { type: words < 120 ? 'unknown' : 'not_legal', confidence: 0.6 - genericDensity, isLikelyLegal: false, signals };
  }
  if (top.s < 1.2) {
    return { type: 'other_legal', confidence: 0.3 + genericDensity * 0.3, isLikelyLegal: true, signals };
  }
  const margin = (top.s - second.s) / Math.max(top.s, 1);
  const confidence = Math.max(0, Math.min(1, 0.25 + Math.min(top.s, 7) / 10 + margin * 0.25 + genericDensity * 0.1));
  return { type: top.type, confidence: Number(confidence.toFixed(2)), isLikelyLegal: true, signals };
}

export const DOCUMENT_TYPE_LABEL_TR: Record<DocumentType, string> = {
  terms_of_service: 'Kullanım Koşulları',
  privacy_policy: 'Gizlilik Politikası',
  subscription_terms: 'Abonelik Koşulları',
  cookie_policy: 'Çerez Politikası',
  refund_policy: 'İade ve Ödeme Koşulları',
  data_processing: 'Veri İşleme Sözleşmesi',
  eula: 'Son Kullanıcı Lisans Sözleşmesi',
  other_legal: 'Diğer Hukuki Metin',
  not_legal: 'Hukuki metin değil',
  unknown: 'Belirlenemedi',
};
