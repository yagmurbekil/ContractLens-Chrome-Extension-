/**
 * Lightweight, deterministic language heuristics used by the schema to
 * enforce that user-facing explanations are written in Turkish.
 * These are heuristics, not a language identifier: they reject obvious
 * English output and accept natural Turkish prose.
 */

const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TURKISH_WORDS = new Set([
  've', 'bu', 'bir', 'için', 'ile', 'olabilir', 'veya', 'de', 'da', 'ki', 'gibi', 'daha',
  'sizin', 'kullanıcı', 'veri', 'hizmet', 'olarak', 'göre', 'kadar', 'ancak', 'madde',
  'belge', 'eder', 'edebilir', 'olan', 'yok', 'var', 'çok', 'tüm', 'her', 'şirket',
]);
const ENGLISH_STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'your', 'you', 'will', 'may', 'is', 'are', 'with', 'for',
  'this', 'that', 'data', 'we', 'our', 'or', 'be', 'by', 'any', 'in', 'on', 'not', 'can',
]);

function words(text: string): string[] {
  return text
    .toLocaleLowerCase('tr-TR')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

export function isLikelyEnglish(text: string): boolean {
  const w = words(text);
  if (w.length < 3) return false;
  const en = w.filter((x) => ENGLISH_STOPWORDS.has(x)).length;
  return en >= 2 && en / w.length >= 0.2;
}

export function looksTurkish(text: string): boolean {
  if (TURKISH_CHARS.test(text)) return true;
  return words(text).some((x) => TURKISH_WORDS.has(x));
}

/** Accept short labels unless they are clearly English; long text must look Turkish. */
export function isAcceptableTurkish(text: string): boolean {
  if (isLikelyEnglish(text)) return false;
  if (text.trim().length >= 40) return looksTurkish(text);
  return true;
}
