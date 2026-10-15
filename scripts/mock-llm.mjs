// Deterministic OpenAI-compatible mock LLM for offline end-to-end tests.
// - JSON analysis requests: quotes real sentences from the untrusted chunk that contain risk keywords
//   (+ one deliberately fabricated quote, which ContractLens must reject).
// - Page Agent requests (tools present): reports some headings, then calls `done`.
// Logs request metadata to MOCK_LOG (JSON lines) so tests can inspect what Page Agent sent.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.env.MOCK_PORT ?? 9999);
// Simulates a slow provider for analysis calls (e.g. free-tier rate-limit waits).
const delayMs = Number(process.env.MOCK_DELAY_MS ?? 0);
const log = process.env.MOCK_LOG ?? 'mock-llm.log';
let agentStep = 0;

function analysis(user) {
  const m = /<<<UNTRUSTED_DOCUMENT_START ([0-9a-f]+)>>>\n([\s\S]*)\n<<<UNTRUSTED_DOCUMENT_END \1>>>/.exec(user);
  const chunk = m ? m[2] : '';
  const sentences = chunk.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 500);
  const rules = [
    [/not be liable|limitation of liability|shall not be liable/i, 'liability_limitation', 'unfavorable_term', 'high', 'Sorumluluğun sınırlandırılması'],
    [/terminate|suspend/i, 'termination_suspension', 'contractual', 'moderate', 'Hesabın kapatılabilmesi'],
    [/advertis|share/i, 'data_sharing', 'privacy', 'moderate', 'Verilerin paylaşılması'],
    [/refund/i, 'refunds', 'financial', 'moderate', 'İade kısıtlaması'],
  ];
  const findings = [];
  for (const [re, category, concernType, severity, titleTr] of rules) {
    const s = sentences.find((x) => re.test(x));
    if (!s) continue;
    findings.push({ id: `risk-${String(findings.length + 1).padStart(3, '0')}`, category, concernType, severity, titleTr, originalQuote: s,
      explanationTr: 'Bu madde kullanıcı aleyhine sonuçlar doğurabilir.', potentialImpactTr: 'Haklarınız sınırlanabilir.', sourceSection: null,
      startOffset: null, endOffset: null, confidence: 0.8, uncertaintyTr: null });
  }
  findings.push({ id: `risk-${String(findings.length + 1).padStart(3, '0')}`, category: 'other', concernType: 'uncertainty', severity: 'critical', titleTr: 'Uydurma alıntı (test)',
    originalQuote: 'The company may sell your kidneys to the highest bidder at any time.', explanationTr: 'Bu bir test uydurmasıdır.', potentialImpactTr: 'Test.', sourceSection: null,
    startOffset: null, endOffset: null, confidence: 0.9, uncertaintyTr: null });
  return { documentType: 'terms_of_service', overallRiskScore: 10, riskLevel: 'low', summaryTr: 'Belgede dikkat edilmesi gereken maddeler bulunmaktadır.', findings, limitationsTr: [], injectionSuspected: false, needsHumanReview: true };
}

function review(user) {
  const lines = user.split('\n').filter((l) => /^\[k\d+\]/.test(l));
  const rules = [
    [/not be liable|shall not be liable|sorumlu tutulamaz/i, 'liability_limitation', 'unfavorable_term', 'high', 'Sorumluluğun sınırlandırılması'],
    [/terminate|suspend|askıya/i, 'termination_suspension', 'contractual', 'moderate', 'Hesabın kapatılabilmesi'],
    [/advertis|paylaşıl/i, 'data_sharing', 'privacy', 'moderate', 'Verilerin paylaşılması'],
    [/refund|iade edilmez/i, 'refunds', 'financial', 'moderate', 'İade kısıtlaması'],
  ];
  const findings = [];
  for (const [re, category, concernType, severity, titleTr] of rules) {
    const l = lines.find((x) => re.test(x) && !findings.some((f) => x.startsWith(`[${f.candidateId}]`)));
    if (!l) continue;
    findings.push({ candidateId: /^\[(k\d+)\]/.exec(l)[1], category, concernType, severity, titleTr, explanationTr: 'Bu madde kullanıcı aleyhine sonuçlar doğurabilir.', potentialImpactTr: 'Haklarınız sınırlanabilir.', confidence: 0.8, uncertaintyTr: null });
  }
  findings.push({ candidateId: 'k999', category: 'other', concernType: 'uncertainty', severity: 'critical', titleTr: 'Uydurma aday (test)', explanationTr: 'Bu bir test uydurmasıdır.', potentialImpactTr: 'Test.', confidence: 0.9, uncertaintyTr: null });
  return { documentType: 'terms_of_service', overallRiskScore: 10, riskLevel: 'low', summaryTr: 'Belgede dikkat edilmesi gereken maddeler bulunmaktadır.', findings, limitationsTr: [], injectionSuspected: false, needsHumanReview: true };
}

function agentReply(body) {
  const user = JSON.stringify(body.messages);
  const headings = [...user.matchAll(/(?:^|\\n)([A-Z]\. [A-Z][A-Za-z ,&]+)(?=\\n)/g)].map((m) => m[1]).slice(0, 6);
  const action = agentStep++ % 2 === 0 ? { report_legal_sections: { headings: headings.length ? headings : ['P. Limitation of Liability'] } } : { done: { text: 'ok', success: true } };
  return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'AgentOutput', arguments: JSON.stringify({ evaluation_previous_goal: '-', memory: '-', next_goal: '-', action }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}

http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || '{}');
  const isAgent = Array.isArray(body.tools) && body.tools.length > 0;
  appendFileSync(log, JSON.stringify({ path: req.url, auth: Boolean(req.headers.authorization), model: body.model, agent: isAgent, toolsJson: isAgent ? JSON.stringify(body.tools).slice(0, 20000) : null }) + '\n');
  res.writeHead(200, { 'content-type': 'application/json' });
  if (isAgent) return res.end(JSON.stringify(agentReply(body)));
  const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
  if (delayMs) await new Promise((r) => globalThis.setTimeout(r, delayMs));
  const out = user.includes('UNTRUSTED_CANDIDATES_START') ? review(user) : analysis(user);
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
}).listen(port, '127.0.0.1', () => console.log(`mock LLM on ${port}`));
