/** Writes the JSON Schema (draft 2020-12) of the LLM output contract to docs/schema/. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { llmOutputJsonSchema, llmReviewJsonSchema } from '../src/lib/prompt';
import { AnalyzeRequestSchema, ReportSchema, ReviewRequestSchema } from '../src/lib/schema';

mkdirSync('docs/schema', { recursive: true });
writeFileSync('docs/schema/llm-chunk-output.schema.json', JSON.stringify(llmOutputJsonSchema(), null, 2));
writeFileSync('docs/schema/analyze-request.schema.json', JSON.stringify(z.toJSONSchema(AnalyzeRequestSchema, { target: 'draft-2020-12' }), null, 2));
writeFileSync('docs/schema/llm-review-output.schema.json', JSON.stringify(llmReviewJsonSchema(), null, 2));
writeFileSync('docs/schema/review-request.schema.json', JSON.stringify(z.toJSONSchema(ReviewRequestSchema, { target: 'draft-2020-12' }), null, 2));
writeFileSync('docs/schema/report.schema.json', JSON.stringify(z.toJSONSchema(ReportSchema, { target: 'draft-2020-12' }), null, 2));
console.log('schemas → docs/schema/');
