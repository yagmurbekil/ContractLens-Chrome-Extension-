import type { ChatMessage, CompletionResult, LlmProvider } from '../../src/lib/llm/providers';
import type { LlmChunkOutput, LlmFinding } from '../../src/lib/schema';

/** Scripted provider: returns queued responses (string or Error) and records every call. */
export class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  calls: ChatMessage[][] = [];
  constructor(private queue: Array<string | Error | ((msgs: ChatMessage[]) => string)>) {}
  async complete(messages: ChatMessage[]): Promise<CompletionResult> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const next = this.queue.length > 1 ? this.queue.shift()! : this.queue[0]!;
    if (next instanceof Error) throw next;
    return { content: typeof next === 'function' ? next(messages) : next };
  }
}

export function finding(over: Partial<LlmFinding> = {}): LlmFinding {
  return {
    id: 'risk-001',
    category: 'data_sharing',
    concernType: 'privacy',
    severity: 'high',
    titleTr: 'Verilerin üçüncü taraflarla paylaşılması',
    originalQuote: 'We may share your personal information with advertising partners and other third parties for marketing purposes',
    explanationTr: 'Bu madde, kişisel verilerinizin reklam ortaklarıyla paylaşılabileceğini belirtiyor.',
    potentialImpactTr: 'Verilerinizin kimlerle paylaşıldığını kontrol etmeniz zorlaşabilir.',
    sourceSection: '3. Sharing of Information',
    startOffset: null,
    endOffset: null,
    confidence: 0.9,
    uncertaintyTr: null,
    ...over,
  };
}

export function output(findings: LlmFinding[], over: Partial<LlmChunkOutput> = {}): LlmChunkOutput {
  return {
    documentType: 'privacy_policy',
    overallRiskScore: 50,
    riskLevel: 'moderate',
    summaryTr: 'Belgede dikkat edilmesi gereken maddeler bulunmaktadır.',
    findings,
    limitationsTr: [],
    injectionSuspected: false,
    needsHumanReview: true,
    ...over,
  };
}
