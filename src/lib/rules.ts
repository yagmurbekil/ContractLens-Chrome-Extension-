import { LIMITS } from './config';
import type { Category, LlmFinding, Severity } from './schema';

/**
 * Deterministic clause rules (English + Turkish).
 *
 * Used in two places:
 *  1. Candidate selection for the LLM review (rules only *propose* clauses).
 *  2. Rule-based mode — when no LLM is configured or the LLM is unavailable —
 *     clearly labelled in the UI as "Kural tabanlı analiz (LLM değil)".
 * Rules are keyword heuristics; they cannot read context or negation reliably.
 */

export interface Rule {
  re: RegExp;
  category: Category;
  concernType: LlmFinding['concernType'];
  severity: Severity;
  titleTr: string;
  explanationTr: string;
  potentialImpactTr: string;
  confidence: number;
}

const T = (
  re: RegExp,
  category: Category,
  concernType: Rule['concernType'],
  severity: Severity,
  titleTr: string,
  explanationTr: string,
  potentialImpactTr: string,
  confidence: number,
): Rule => ({ re, category, concernType, severity, titleTr, explanationTr, potentialImpactTr, confidence });

export const RULES: Rule[] = [
  // ---- data sale / sharing -------------------------------------------------
  T(/\b(sell|rent)\b[^.]{0,80}\b(personal (data|information)|your (data|information))|(kişisel veri|verileriniz|bilgileriniz)[^.]{0,80}(satıl|satabil|satış)|(satıl|satabil)[^.]{0,60}(kişisel veri|verileriniz)/i,
    'data_sharing', 'privacy', 'critical', 'Kişisel verilerin satılabilmesi', 'Bu madde, kişisel verilerinizin satılabileceğini veya kiralanabileceğini belirtiyor.', 'Verileriniz sizin kontrolünüz dışında birçok şirkete ulaşabilir.', 0.8),
  T(/\b(share|disclose|provide|transfer)\b[^.]{0,100}\b(third[- ]part(y|ies)|partners|advertis(ers|ing partners)|affiliates)|(üçüncü (kişi|taraf)|iş ortak|reklam ver|grup şirket|yurt ?dışı|tedarikçi)[^.]{0,100}(paylaş|aktar|açıkla)|(paylaş|aktar)[^.]{0,100}(üçüncü (kişi|taraf)|iş ortak|reklam|yurt ?dışı)/i,
    'data_sharing', 'privacy', 'high', 'Verilerin üçüncü taraflarla paylaşılması', 'Bu madde, verilerinizin iş ortakları, reklam verenler veya diğer üçüncü taraflarla paylaşılabileceğini belirtiyor.', 'Kişisel bilgilerinizin kimlerle paylaşıldığını kontrol etmeniz zorlaşabilir.', 0.7),
  T(/\b(retain|store|keep)\b[^.]{0,80}\b(indefinitely|as long as (we|necessary)|for an unlimited)|(süresiz|süre sınırı olmaksızın|gerekli gördüğü(müz)? süre)[^.]{0,60}(sakla|muhafaza|tut)|(sakla|muhafaza)[^.]{0,80}(süresiz|gerekli görül|sınırsız)/i,
    'data_retention', 'privacy', 'moderate', 'Belirsiz veya süresiz veri saklama', 'Bu madde, verilerin ne kadar süre saklanacağını net bir süreyle sınırlamıyor.', 'Verileriniz hizmeti bıraktıktan sonra da uzun süre tutulabilir.', 0.65),
  T(/(konum|rehber|kişi listesi|biyometrik|cihaz kimli|arama geçmiş)[^.]{0,80}(topla|işle|eriş|kaydet)|\b(collect|access)\b[^.]{0,60}\b(precise location|contacts|biometric)/i,
    'data_collection', 'privacy', 'moderate', 'Hassas veya kapsamlı veri toplama', 'Bu madde, konum, rehber veya cihaz bilgisi gibi kapsamlı verilerin toplanabileceğini belirtiyor.', 'Günlük davranışlarınız hakkında ayrıntılı bir profil oluşabilir.', 0.55),
  // ---- billing ---------------------------------------------------------------
  T(/\b(automatically renew|auto[- ]renew|renews automatically|will renew)|otomatik(\s+olarak)?\s+(yenilen|uzatıl|tahsil)|kendiliğinden (yenilen|uzar)/i,
    'auto_renewal', 'financial', 'high', 'Otomatik yenileme', 'Bu madde, aboneliğin siz iptal etmedikçe otomatik olarak yenileneceğini belirtiyor.', 'İptal etmeyi unutursanız yeni dönem için ücret ödeyebilirsiniz.', 0.8),
  T(/\b(no refunds?|non-?refundable|not (be )?refund(ed|able))|iade (edilmez|edilmeyecek|yapılmaz|yapılmayacak|söz konusu (değil|olmayacak))|(ücret|bedel)(ler)?[^.]{0,30}(iade edilmez|geri ödenmez)|geri ödeme (yapılmaz|yapılmayacak)/i,
    'refunds', 'financial', 'moderate', 'İade yapılmaması', 'Bu madde, ödemelerin iade edilmeyeceğini belirtiyor.', 'Hizmeti kullanmasanız bile ödediğiniz tutarı geri alamayabilirsiniz.', 0.75),
  T(/\bcancel[^.]{0,120}\b(at least \d+|\d+ days|before the (end|renewal)|in writing|by (phone|mail|calling))|iptal[^.]{0,100}(en az \d+ gün|\d+ gün önce|yazılı|noter|telefon)/i,
    'cancellation', 'financial', 'moderate', 'İptal için koşullar', 'Bu madde, iptal için belirli bir süre veya yöntem şartı koyuyor.', 'Koşulu kaçırırsanız iptaliniz bir sonraki döneme kalabilir.', 0.6),
  T(/\b(change|increase|modify)\b[^.]{0,60}\b(price|prices|fees?|pricing)\b|(ücret|fiyat|bedel)(ler|leri)?[^.]{0,80}(değiştir|artır|güncelle)/i,
    'price_changes', 'financial', 'moderate', 'Fiyat değişikliği hakkı', 'Bu madde, şirkete ücretleri değiştirme hakkı tanıyor.', 'Ödediğiniz ücret zamanla artabilir.', 0.6),
  // ---- contract terms --------------------------------------------------------
  T(/\b(at any time|sole discretion)\b[^.]{0,120}\b(modify|change|amend|update)\b|\b(modify|change|amend|update)\b[^.]{0,80}\b(these terms|this (agreement|policy))\b[^.]{0,60}\b(at any time|without (prior )?notice)|(tek taraflı|dilediği zaman|herhangi bir zamanda|önceden bildirim(de bulunmaksızın| yapmaksızın| yapılmaksızın))[^.]{0,100}(değiştir|güncelle|tadil|düzenle)|(değiştirme|güncelleme|tadil) hakkı(nı)? saklı/i,
    'unilateral_changes', 'contractual', 'moderate', 'Koşulların tek taraflı değiştirilmesi', 'Bu madde, şirketin koşulları tek taraflı olarak değiştirebileceğini belirtiyor.', 'Kabul ettiğiniz koşullar, haberiniz olmadan aleyhinize değişebilir.', 0.6),
  T(/\b(terminate|suspend)\b[^.]{0,80}\b(at any time|for any reason|without (prior )?notice|sole discretion)|(hesab|üyeliğ|hizmet)[^.]{0,60}(askıya al|kapat|sonlandır|feshed|durdur)[^.]{0,80}(dilediği|herhangi bir|bildirim(de bulunmaksızın| yapmaksızın)|gerekçe göstermeksizin|tek taraflı)|(gerekçe göstermeksizin|tek taraflı olarak|herhangi bir sebeple)[^.]{0,80}(feshet|sonlandır|askıya|kapat)/i,
    'termination_suspension', 'contractual', 'moderate', 'Hesabın sebepsiz kapatılabilmesi', 'Bu madde, hesabınızın önceden bildirim yapılmadan veya herhangi bir sebeple kapatılabileceğini belirtiyor.', 'Hizmete ve içeriklerinize erişiminizi aniden kaybedebilirsiniz.', 0.6),
  T(/\b(binding arbitration|class action|jury trial)\b|tahkim|toplu dava|grup davası/i,
    'arbitration_class_waiver', 'contractual', 'high', 'Tahkim veya toplu dava feragati', 'Bu madde, anlaşmazlıkların mahkeme yerine tahkimle çözülmesini veya toplu dava hakkından feragati öngörüyor.', 'Hak arama yollarınız kısıtlanabilir.', 0.75),
  T(/\b(exclusive jurisdiction|governing law)\b|mahkemeleri[^.]{0,40}(yetkili|münhasıran)|yetkili mahkeme/i,
    'jurisdiction', 'contractual', 'low', 'Yetkili mahkeme veya uygulanacak hukuk', 'Bu madde, uyuşmazlıklarda hangi mahkemenin veya hukukun geçerli olacağını belirliyor.', 'Bir uyuşmazlıkta uzak bir yerde veya farklı bir hukuka göre hak aramanız gerekebilir.', 0.5),
  T(/\b(not (be )?liable|in no event|limitation of liability|maximum (aggregate )?liability)\b|sorumlu (tutulamaz|değildir|olmayacak|tutulmayacak)|sorumluluk kabul (etmez|edilmez|etmemektedir)|hiçbir (şekilde |surette )?sorumlulu/i,
    'liability_limitation', 'unfavorable_term', 'moderate', 'Sorumluluğun sınırlandırılması', 'Bu madde, şirketin zararlardan sorumluluğunu sınırlıyor veya hariç tutuyor.', 'Bir zarar yaşarsanız tazminat almanız zorlaşabilir.', 0.65),
  T(/\bindemnif(y|ication)\b|tazmin (etmeyi|edeceğini|etmekle|edecektir)|zararları?[^.]{0,40}(karşılamayı|karşılayacağını|karşılamakla)/i,
    'indemnification', 'unfavorable_term', 'moderate', 'Tazmin yükümlülüğü', 'Bu madde, belirli durumlarda şirketin zararlarını sizin karşılamanızı öngörüyor.', 'Üçüncü kişilerin talepleri nedeniyle masraflarla karşılaşabilirsiniz.', 0.6),
  T(/\b(perpetual|irrevocable)\b[^.]{0,80}\blicen[cs]e\b|\blicen[cs]e\b[^.]{0,80}\b(perpetual|irrevocable)|(süresiz|geri alınamaz|dünya çapında|devredilebilir)[^.]{0,80}(lisans|kullanım hakkı)/i,
    'content_license', 'contractual', 'moderate', 'İçerikleriniz için geniş lisans', 'Bu madde, yüklediğiniz içerikler üzerinde şirkete süresiz veya geri alınamaz bir kullanım hakkı veriyor.', 'İçeriklerinizin kullanımını sonradan sınırlamanız zor olabilir.', 0.6),
  T(/\b(train|improve)\b[^.]{0,60}\b(machine learning|artificial intelligence|AI|models?)\b|(yapay zek[aâ]|makine öğren)[^.]{0,80}(eğit|geliştir|kullan)/i,
    'ai_training', 'privacy', 'moderate', 'Verilerin yapay zekâ eğitimi için kullanılması', 'Bu madde, verilerinizin modelleri eğitmek veya geliştirmek için kullanılabileceğini belirtiyor.', 'İçerikleriniz beklemediğiniz amaçlarla işlenebilir.', 0.55),
  T(/\b(cookies?|pixels?|web beacons?)\b[^.]{0,80}\b(advertis|track|third[- ]part)|(çerez|piksel|izleme teknoloji)[^.]{0,80}(reklam|üçüncü taraf|pazarlama|profil)|ticari elektronik ileti/i,
    'tracking_cookies', 'privacy', 'low', 'Takip, reklam ve pazarlama iletileri', 'Bu madde, çerez gibi teknolojilerle takip, reklam veya pazarlama amaçlı veri işlendiğini belirtiyor.', 'Çevrim içi davranışlarınız profillenebilir veya pazarlama iletileri alabilirsiniz.', 0.55),
  T(/\breserves? the right\b[^.]{0,80}\b(remove|refuse|disable|suspend|terminate|cancel)|\b(remove|refuse|disable)\b[^.]{0,60}\b(at any time|for any reason|sole discretion)|\bcancel accounts?\b[^.]{0,60}\binactive|(kaldırma|reddetme|engelleme)[^.]{0,40}hakkı(nı)? saklı/i,
    'termination_suspension', 'contractual', 'moderate', 'İçeriğin veya hesabın tek taraflı kaldırılması', 'Bu madde, şirkete içeriğinizi veya hesabınızı kendi takdirine göre kaldırma ya da kısıtlama yetkisi veriyor.', 'Bilgilerinize veya hizmete erişiminizi beklenmedik şekilde kaybedebilirsiniz.', 0.55),
  T(/\breserves? the right\b[^.]{0,60}\b(change|modify|amend|update|discontinue)|\b(continued use|continue to use|further use)\b[^.]{0,120}\b(accept|agree|constitutes|subject to the updated)|agreeing to the latest|\b(suspend|discontinue)\b[^.]{0,40}\b(any part of )?the services?\b|kullanmaya devam[^.]{0,80}(kabul|onay)/i,
    'unilateral_changes', 'contractual', 'moderate', 'Değişikliklerin kullanımla kabul sayılması', 'Bu madde, şirketin koşulları veya hizmeti değiştirebileceğini ve hizmeti kullanmaya devam etmenizin bu değişiklikleri kabul anlamına geleceğini belirtiyor.', 'Fark etmediğiniz değişikliklerle bağlı hale gelebilirsiniz.', 0.55),
  T(/\b(assign|transfer|delegate)\b[^.]{0,80}\bwithout (your )?(consent|notice)|\bwith or without your consent\b|(sözleşme|hak)[^.]{0,60}(devredebilir|devretme hakkı)/i,
    'other', 'contractual', 'moderate', 'Sözleşmenin onayınız olmadan devredilebilmesi', 'Bu madde, şirketin sözleşmeyi veya haklarını sizin onayınız olmadan başka bir şirkete devredebileceğini belirtiyor.', 'Verileriniz ve hesabınız tanımadığınız bir şirkete geçebilir.', 0.5),
  T(/\b(you (hereby )?waive|waive (any|all|these|your) rights?)\b|\brelease\b[^.]{0,60}\bfrom (any and all )?(claims|liabilit)|feragat ed|ibra ed/i,
    'indemnification', 'unfavorable_term', 'moderate', 'Haklardan feragat veya ibra', 'Bu madde, bazı yasal haklarınızdan vazgeçmenizi veya şirketi taleplerden muaf tutmanızı öngörüyor.', 'Bir sorun yaşadığınızda hak talep etme imkânınız daralabilir.', 0.55),
  T(/\b(governing law|laws of the state|law applies to this|exclusive jurisdiction)\b|hukuku uygulan/i,
    'jurisdiction', 'contractual', 'low', 'Uygulanacak hukuk', 'Bu madde, sözleşmeye hangi ülkenin veya eyaletin hukukunun uygulanacağını belirliyor.', 'Bir uyuşmazlıkta size yabancı bir hukuk sistemine göre hak aramanız gerekebilir.', 0.45),
  T(/\bprorat(e|ed|ion)\b|kıst(elyevm)? iade/i,
    'refunds', 'financial', 'low', 'Kalan süre için iade yapılmaması', 'Bu madde, kullanılmayan süre için orantılı iade yapılmayacağını belirtiyor.', 'Erken iptal etseniz bile ödediğiniz dönemin tamamı için ücret ödersiniz.', 0.55),
  T(/\b(trial)\b[^.]{0,100}\b(charged|automatically convert|paid membership)|\bavoid being charged\b|deneme süresi[^.]{0,80}(ücret|tahsil|ücretli)/i,
    'auto_renewal', 'financial', 'moderate', 'Deneme süresinin ücretliye dönüşmesi', 'Bu madde, deneme süresi bitiminde iptal etmezseniz ücretlendirileceğinizi belirtiyor.', 'Unutursanız istemediğiniz bir ödeme yapabilirsiniz.', 0.6),
  T(/\bnot (be )?possible to (completely )?delete\b|\bremain (on|in) (our )?(backups|caches|records)\b|\bcontinue to retain\b|\bretain (and use )?your information\b|silin(e)?meyebilir|yedeklerde/i,
    'data_retention', 'privacy', 'moderate', 'Verilerin tamamen silinmemesi', 'Bu madde, silme talebinden veya hesap kapatıldıktan sonra da bazı verilerin saklanabileceğini belirtiyor.', 'Silindiğini düşündüğünüz bilgiler bir süre daha şirkette kalabilir.', 0.55),
  T(/\b(transfer of your information|outside (of )?the country where you live|outside the European Economic Area|processed on servers located)\b|\b(merger|acquisition|bankruptcy)\b[^.]{0,120}\b(transfer|acquired|assets)|\bone of the assets\b|birleşme|devralma/i,
    'data_sharing', 'privacy', 'moderate', 'Verilerin başka ülkelere veya şirketlere aktarılması', 'Bu madde, verilerinizin yurt dışına ya da şirket satışı gibi durumlarda başka bir şirkete aktarılabileceğini belirtiyor.', 'Verileriniz farklı koruma kurallarına tabi yerlere veya şirketlere geçebilir.', 0.55),
  T(/\b(targeted ads|personali[sz]ed ad|ad campaigns|ad networks?)\b|hedefli reklam|kişiselleştirilmiş reklam/i,
    'tracking_cookies', 'privacy', 'moderate', 'Hedefli reklam için veri kullanımı', 'Bu madde, bilgilerinizin size veya başkalarına hedefli reklam göstermek için kullanılabileceğini belirtiyor.', 'Çevrim içi davranışlarınız reklam amaçlı profillenebilir.', 0.55),
  T(/\b(as is|as available)\b|olduğu gibi( sunul| sağlan)|garanti (vermez|verilmez|etmez)/i,
    'warranty_disclaimer', 'unfavorable_term', 'low', 'Garanti verilmemesi', 'Bu madde, hizmetin "olduğu gibi" sunulduğunu ve garanti verilmediğini belirtiyor.', 'Hizmet beklendiği gibi çalışmazsa talepte bulunmanız zorlaşabilir.', 0.5),
];

/** Words that indicate a clause is worth a closer look even without a full rule match (EN + TR). */
export const RELEVANCE_TERMS = [
  /share|disclos|third[- ]part|sell|partner|affiliate|advertis/gi,
  /retain|retention|delete|store/gi,
  /cookie|track|pixel|analytics|profil/gi,
  /renew|subscription|cancel|refund|fee|charge|price|billing|trial/gi,
  /terminat|suspend|modify|change (these|the) terms|at any time|sole discretion/gi,
  /liabilit|indemnif|warrant|as is|damages/gi,
  /arbitrat|class action|jury|waive|governing law|jurisdiction/gi,
  /license|royalty|perpetual|irrevocable|sublicens/gi,
  /train|machine learning|artificial intelligence|\bAI\b/gi,
  /paylaş|aktar|üçüncü (kişi|taraf)|sakla|çerez|yenilen|iptal|iade|ücret|fesih|feshet|askıya|sorumlu|tazmin|tahkim|lisans|değiştir|bildirim|kişisel veri|rıza|onay/gi,
];

export interface SentenceSpan {
  s: number;
  e: number;
}

/** Sentence-like spans (offsets into `text`) of a reasonable length for quoting. */
export function sentences(text: string, minLen: number = LIMITS.minQuoteChars): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const re = /[^.!?\n]+(?:[.!?]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let s = m.index;
    let e = m.index + m[0].length;
    while (s < e && /\s|•/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e - s >= minLen) out.push({ s, e: Math.min(e, s + LIMITS.maxQuoteChars) });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/**
 * JavaScript's /i flag does not fold Turkish İ/I correctly ("İade" ≠ /iade/i),
 * so each rule is tested on the original text and on its Turkish lower-case form.
 * (Only Turkish-lowercasing would break English rules: "IN" → "ın".)
 */
export function ruleMatches(rule: Rule, text: string): boolean {
  return rule.re.test(text) || rule.re.test(text.toLocaleLowerCase('tr-TR'));
}

export function matchingRules(sentence: string): Rule[] {
  return RULES.filter((r) => ruleMatches(r, sentence));
}

export function relevanceHits(sentence: string): number {
  const lower = sentence.toLocaleLowerCase('tr-TR');
  let n = 0;
  for (const re of RELEVANCE_TERMS) {
    re.lastIndex = 0;
    n += Math.max((sentence.match(re) ?? []).length, (lower.match(re) ?? []).length);
  }
  return n;
}
