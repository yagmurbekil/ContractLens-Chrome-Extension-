/**
 * Runs the ContractLens analysis on every evaluation document and stores the
 * raw, unmodified analyzer responses (and raw model text, for LLM runs).
 *
 *   npm run eval -- --provider demo        # rule-based demo analyzer (no key)
 *   npm run eval -- --provider llm         # provider from .env (e.g. Groq)
 *
 * Then:  npm run eval:score -- --provider <same>
 * Nothing here edits model output; scoring re-runs the deterministic
 * validation/verification/scoring pipeline on the stored responses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../src/backend/env';
import { analyzeRequest, analyzeReview } from '../src/lib/llm/analyze';
import { selectCandidates } from '../src/lib/candidates';
import { buildReviewRequest } from '../src/lib/review';
import { demoAnalyze } from '../src/lib/llm/demo';
import { buildAnalyzeRequests, prepareDocument } from '../src/lib/pipeline';
import type { AnalyzeResponse } from '../src/lib/schema';
import { loadEvalDoc, loadPage, manifest } from './lib';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1]! : def;
};
const providerArg = arg('provider', 'demo');
const only = arg('only', '');
const strategy = arg('strategy', 'review') as 'review' | 'chunks';

await loadDotEnv();
const cfg = providerArg === 'llm' ? loadConfig() : null;
if (providerArg === 'llm' && !cfg?.provider) {
  console.error('No LLM provider configured. Copy .env.example to .env and set LLM_PROVIDER / API key.');
  process.exit(1);
}
const label = providerArg === 'llm' ? `${cfg!.provider!.name}-${cfg!.provider!.model}`.replace(/[^a-z0-9.-]+/gi, '_') : 'demo';
const outDir = `eval/results/${label}${strategy === 'chunks' ? '-chunks' : ''}`;
mkdirSync(`${outDir}/raw`, { recursive: true });

const targets = [
  ...manifest.documents.map((d) => ({ id: d.id, load: () => loadEvalDoc(d).prepared })),
  // Security probe (not part of precision/recall): the prompt-injection fixture.
  { id: 'security-injection-fixture', load: () => prepareDocument(loadPage('fixtures/sites/injection.html', 'https://shopsphere.example/privacy')) },
].filter((t) => !only || t.id === only);

for (const t of targets) {
  const p = t.load();
  const started = Date.now();
  const raw: Array<{ chunkId: string; attempt: number; content: string }> = [];
  if (strategy === 'review') {
    const candidates = selectCandidates(p.doc).candidates;
    const reviewResult =
      providerArg === 'llm' && candidates.length
        ? await analyzeReview(cfg!.provider!, buildReviewRequest(p, candidates), {
            onRawOutput: (chunkId, attempt, content) => raw.push({ chunkId, attempt, content }),
            onEvent: (e) => process.stdout.write(`  ${t.id} review ${e.type}#${e.attempt}${e.detail && e.type !== 'valid' ? ' ' + e.detail.slice(0, 120) : ''}\n`),
          })
        : null;
    writeFileSync(
      `${outDir}/raw/${t.id}.json`,
      JSON.stringify({ docId: t.id, strategy, ranAt: new Date().toISOString(), durationMs: Date.now() - started, candidates: candidates.length, candidateChars: candidates.reduce((a, c) => a + c.text.length, 0), reviewResult, rawModelOutputs: raw }, null, 1),
    );
    console.log(`${t.id}: ${candidates.length} candidates, ${reviewResult ? (reviewResult.ok ? 'LLM ok' : 'LLM failed: ' + reviewResult.errorCode) : 'rules only'} (${Date.now() - started} ms)`);
    continue;
  }
  const merged: AnalyzeResponse = { mode: providerArg === 'llm' ? 'llm' : 'demo', provider: '', model: '', results: [] };
  for (const req of buildAnalyzeRequests(p)) {
    if (providerArg === 'llm') {
      const results = await analyzeRequest(cfg!.provider!, req, {
        onRawOutput: (chunkId, attempt, content) => raw.push({ chunkId, attempt, content }),
        onEvent: (e) => process.stdout.write(`  ${t.id} ${e.chunkId} ${e.type}#${e.attempt}\n`),
      });
      merged.provider = cfg!.provider!.name;
      merged.model = cfg!.provider!.model;
      merged.results.push(...results);
    } else {
      const r = demoAnalyze(req);
      merged.provider = r.provider;
      merged.model = r.model;
      merged.results.push(...r.results);
    }
  }
  writeFileSync(
    `${outDir}/raw/${t.id}.json`,
    JSON.stringify(
      {
        docId: t.id,
        strategy,
        ranAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        chunksTotal: p.chunks.length,
        chunksAnalyzed: p.selected.map((c) => c.id),
        analyzedChars: p.analyzedChars,
        response: merged,
        rawModelOutputs: raw,
      },
      null,
      1,
    ),
  );
  const ok = merged.results.filter((r) => r.ok).length;
  console.log(`${t.id}: ${ok}/${merged.results.length} chunks valid (${Date.now() - started} ms)`);
}
console.log(`raw results → ${outDir}/raw`);
