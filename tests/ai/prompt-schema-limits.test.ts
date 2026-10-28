import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Drift guard: every length/count limit an agent's output schema ENFORCES must
// also be STATED in that agent's system prompt. Otherwise a model that follows
// the prompt can still be rejected, and the whole answer is discarded for the
// fallback. Walks each schema and requires every string/array .max() number to
// appear in the prompt.
import {
  CANDIDATE_SCREENER_SYSTEM_PROMPT,
  candidateScreenerOutputSchema,
} from '../../packages/ai/src/agents/candidate-screener';
import {
  CANDIDATE_MATCHER_SYSTEM_PROMPT,
  candidateMatcherOutputSchema,
} from '../../packages/ai/src/agents/candidate-matcher';
import { FIT_EXPLAINER_SYSTEM_PROMPT, fitExplainerOutputSchema } from '../../packages/ai/src/agents/fit-explainer';
import {
  INTERVIEW_FIT_SCORE_SYSTEM_PROMPT,
  fitScoreOutputSchema,
} from '../../packages/ai/src/agents/interview-fit-score';
import {
  INCLUSIVE_LANGUAGE_SYSTEM_PROMPT,
  inclusiveLanguageOutputSchema,
} from '../../packages/ai/src/agents/inclusive-language';
import { CV_PARSER_SYSTEM_PROMPT, cvParserOutputSchema } from '../../packages/ai/src/agents/cv-parser';
import { BIAS_DETECTOR_SYSTEM_PROMPT, biasDetectorOutputSchema } from '../../packages/ai/src/agents/bias-detector';
import {
  INTERVIEW_GUIDE_SYSTEM_PROMPT,
  interviewGuideOutputSchema,
} from '../../packages/ai/src/agents/interview-guide';
import {
  INTERVIEW_SUMMARIZER_SYSTEM_PROMPT,
  interviewSummarizerOutputSchema,
} from '../../packages/ai/src/agents/interview-summarizer';
import { CANDIDATE_FAQ_SYSTEM_PROMPT, candidateFaqOutputSchema } from '../../packages/ai/src/agents/candidate-faq';
import {
  PIPELINE_OPTIMIZER_SYSTEM_PROMPT,
  pipelineOptimizerOutputSchema,
} from '../../packages/ai/src/agents/pipeline-optimizer';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { VACANCY_WRITER_SYSTEM_PROMPT, vacancyWriterOutputSchema } from '../../packages/ai/src/agents/vacancy-writer';

/** Collect "path: max" for every string/array maximum in a Zod schema. */
function collectMaxima(schema: z.ZodTypeAny, path = '$'): Array<{ path: string; max: number }> {
  const def = schema._def as { typeName?: string };
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodTypeAny>).flatMap(([k, v]) =>
      collectMaxima(v, `${path}.${k}`),
    );
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return collectMaxima(schema.unwrap() as z.ZodTypeAny, path);
  }
  if (schema instanceof z.ZodArray) {
    const own = schema._def.maxLength ? [{ path: `${path}[]count`, max: schema._def.maxLength.value }] : [];
    return [...own, ...collectMaxima(schema.element as z.ZodTypeAny, `${path}[]`)];
  }
  if (schema instanceof z.ZodString) {
    return schema._def.checks
      .filter((c) => c.kind === 'max')
      .map((c) => ({ path, max: (c as { value: number }).value }));
  }
  if (def.typeName === 'ZodNumber' || def.typeName === 'ZodEnum') return [];
  return [];
}

const CASES = [
  ['candidate-faq', CANDIDATE_FAQ_SYSTEM_PROMPT, candidateFaqOutputSchema],
  ['pipeline-optimizer', PIPELINE_OPTIMIZER_SYSTEM_PROMPT, pipelineOptimizerOutputSchema],
  ['candidate-screener', CANDIDATE_SCREENER_SYSTEM_PROMPT, candidateScreenerOutputSchema],
  ['candidate-matcher', CANDIDATE_MATCHER_SYSTEM_PROMPT, candidateMatcherOutputSchema],
  ['fit-explainer', FIT_EXPLAINER_SYSTEM_PROMPT, fitExplainerOutputSchema],
  ['interview-fit-score', INTERVIEW_FIT_SCORE_SYSTEM_PROMPT, fitScoreOutputSchema],
  ['inclusive-language', INCLUSIVE_LANGUAGE_SYSTEM_PROMPT, inclusiveLanguageOutputSchema],
  ['cv-parser', CV_PARSER_SYSTEM_PROMPT, cvParserOutputSchema],
  ['bias-detector', BIAS_DETECTOR_SYSTEM_PROMPT, biasDetectorOutputSchema],
  ['interview-guide', INTERVIEW_GUIDE_SYSTEM_PROMPT, interviewGuideOutputSchema],
  ['interview-summarizer', INTERVIEW_SUMMARIZER_SYSTEM_PROMPT, interviewSummarizerOutputSchema],
  ['vacancy-writer', VACANCY_WRITER_SYSTEM_PROMPT, vacancyWriterOutputSchema],
] as const;

describe('every enforced output limit is stated in the agent prompt', () => {
  it('covers every agent in packages/ai/src/agents', () => {
    const files = readdirSync(resolve(__dirname, '../../packages/ai/src/agents'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();
    expect(CASES.map(([slug]) => slug).sort()).toEqual(files);
  });

  it.each(CASES)('%s', (_slug, prompt, schema) => {
    const maxima = collectMaxima(schema as z.ZodTypeAny);
    expect(maxima.length).toBeGreaterThan(0);
    const unstated = maxima.filter(({ max }) => !new RegExp(`(?<!\\d)${max}(?!\\d)`).test(prompt));
    expect(unstated).toEqual([]);
  });
});
