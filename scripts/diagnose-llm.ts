/**
 * Checks the configured LLM provider end-to-end with one small, fictional Turkish
 * contract chunk and prints exactly what happens (status, retries, validation errors).
 *   npm run diagnose
 */
import { loadConfig, loadDotEnv } from '../src/backend/env';
import { analyzeReview } from '../src/lib/llm/analyze';
import type { Candidate } from '../src/lib/schema';

await loadDotEnv();
const cfg = loadConfig();
for (const w of cfg.warnings) console.log('UYARI:', w);
if (!cfg.provider) {
  console.log('LLM sağlayıcı yapılandırılmamış (.env kontrol edin).');
  process.exitCode = 1;
} else {
  await main();
}

/** Lists the models this API key can use (OpenAI-compatible GET /models). */
async function listModels(): Promise<string[]> {
  const base = (process.env.OPENAI_BASE_URL ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { data?: Array<{ id: string; active?: boolean }> };
  return (j.data ?? []).filter((m) => m.active !== false).map((m) => m.id).sort();
}

async function main() {
if (!cfg.provider) return;
console.log(`Sağlayıcı: ${cfg.provider.name} · model: ${cfg.provider.model}`);
const clauses = [
  'Şirket, bu sözleşmeyi herhangi bir zamanda önceden bildirimde bulunmaksızın tek taraflı olarak değiştirme hakkını saklı tutar.',
  'Üyelik ücretleri hiçbir koşulda iade edilmez.',
  'Kullanıcının kişisel verileri iş ortaklarımızla ve reklam verenlerle paylaşılabilir.',
  'Müşteri hizmetlerimiz hafta içi 09:00-18:00 saatleri arasında hizmet vermektedir.',
];
let pos = 0;
const candidates: Candidate[] = clauses.map((text, i) => {
  const c = { id: `k${i}`, text, heading: null, start: pos, end: pos + text.length, ruleHints: [] };
  pos += text.length + 1;
  return c;
});
const started = Date.now();
const r = await analyzeReview(
  cfg.provider,
  { url: 'https://example.test/sozlesme', title: 'Kullanıcı Sözleşmesi', documentTypeHint: 'terms_of_service', language: 'tr', candidates },
  {
    onEvent: (e) => console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${e.type} (deneme ${e.attempt})${e.detail ? ' — ' + e.detail : ''}`),
    onRawOutput: (_c, a, raw) => console.log(`  ham model çıktısı #${a} (ilk 300 kr.): ${raw.slice(0, 300).replace(/\s+/g, ' ')}`),
  },
);
if (r.ok) {
  console.log(`\nBAŞARILI (${r.provider} / ${r.model}, ${((Date.now() - started) / 1000).toFixed(1)} sn): ${r.output.findings.length} bulgu, şema geçerli.`);
  for (const f of r.output.findings) console.log(`  - [${f.candidateId}] ${f.titleTr} (${f.severity})${candidates.some((c) => c.id === f.candidateId) ? '' : '  ← GEÇERSİZ ID, rapora girmez'}`);
  console.log('  (k3 zararsız bir maddedir; modelin onu atlaması beklenir.)');
} else {
  console.log(`\nBAŞARISIZ (${r.errorCode}): ${r.errorMessage}`);
  process.exitCode = 1;
  if (/model_not_found|does not exist/i.test(r.errorMessage) && cfg.env.LLM_PROVIDER === 'openai') {
    try {
      const models = await listModels();
      console.log(`\nBu API anahtarının erişebildiği modeller (${models.length}):`);
      for (const m of models) console.log(`  ${m}`);
      console.log('\n.env içindeki OPENAI_MODEL satırını bu listedeki bir modelle değiştirin (sohbet/metin modeli seçin; whisper/tts/guard modelleri değil).');
    } catch (e) {
      console.log(`Model listesi alınamadı: ${(e as Error).message}`);
    }
  }
}
}
