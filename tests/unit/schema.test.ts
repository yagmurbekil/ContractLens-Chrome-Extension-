import { describe, expect, it } from 'vitest';
import { LlmChunkOutputSchema } from '../../src/lib/schema';
import { llmOutputJsonSchema } from '../../src/lib/prompt';
import { validateModelOutput, parseModelJson } from '../../src/lib/llm/analyze';
import { finding, output } from '../helpers/fakes';

describe('LLM output schema', () => {
  it('accepts a valid output', () => {
    expect(LlmChunkOutputSchema.safeParse(output([finding()])).success).toBe(true);
  });
  it('rejects unexpected fields at root and in findings', () => {
    expect(LlmChunkOutputSchema.safeParse({ ...output([]), extra: 1 }).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([{ ...finding(), verified: true } as never])).success).toBe(false);
  });
  it('enforces enums and numeric ranges', () => {
    expect(LlmChunkOutputSchema.safeParse(output([], { documentType: 'blog' as never })).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([], { overallRiskScore: 101 })).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([], { overallRiskScore: 12.5 })).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ confidence: 1.2 })])).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ severity: 'extreme' as never })])).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ category: 'misc' as never })])).success).toBe(false);
  });
  it('requires a non-empty quotation of minimum length', () => {
    expect(LlmChunkOutputSchema.safeParse(output([finding({ originalQuote: '' })])).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ originalQuote: 'short' })])).success).toBe(false);
  });
  it('requires Turkish user-facing explanations', () => {
    const en = finding({ explanationTr: 'This clause allows the company to share your data with third parties for any purpose.' });
    expect(LlmChunkOutputSchema.safeParse(output([en])).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([], { summaryTr: 'The document contains several risky clauses for the user.' })).success).toBe(false);
  });
  it('limits finding count and field lengths', () => {
    const many = Array.from({ length: 13 }, (_, i) => finding({ id: `risk-${String(i + 1).padStart(3, '0')}` }));
    expect(LlmChunkOutputSchema.safeParse(output(many)).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ originalQuote: 'x'.repeat(601) })])).success).toBe(false);
  });
  it('rejects duplicate ids and inverted offsets', () => {
    expect(LlmChunkOutputSchema.safeParse(output([finding(), finding()])).success).toBe(false);
    expect(LlmChunkOutputSchema.safeParse(output([finding({ startOffset: 50, endOffset: 10 })])).success).toBe(false);
  });
});

describe('model output parsing', () => {
  it('rejects malformed JSON and free text', () => {
    expect(validateModelOutput('Sure! Here is the analysis: the site is fine.').ok).toBe(false);
    expect(validateModelOutput('{"documentType": "privacy_policy"').ok).toBe(false);
  });
  it('only strips a surrounding markdown fence and does not invent fields', () => {
    const json = JSON.stringify(output([finding()]));
    expect(validateModelOutput('```json\n' + json + '\n```').ok).toBe(true);
    const missing = JSON.stringify({ ...output([]), limitationsTr: undefined });
    expect(validateModelOutput(missing).ok).toBe(false);
    expect(() => parseModelJson('not json')).toThrow();
  });
});

describe('JSON Schema export', () => {
  it('exports a draft 2020-12 schema with additionalProperties=false', () => {
    const s = llmOutputJsonSchema() as { $schema: string; additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    expect(s.$schema).toContain('2020-12');
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(expect.arrayContaining(['documentType', 'findings', 'overallRiskScore', 'riskLevel']));
  });
});
