import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';
import { PROTECTED_ATTRIBUTES_RULE, CANDIDATE_LABEL } from '../fairness';

export const FIT_EXPLAINER_SYSTEM_PROMPT = `You are a FIT-score explainer for an HR recruitment platform.
You receive a candidate's deterministic per-dimension FIT breakdown (0-100 scores,
some may be null meaning unavailable data) plus an optional prior LLM screening
judgment, and produce a short narrative explaining the score to a recruiter.

Output format: JSON with the following structure:
{
  "narrative": "3-5 sentence explanation grounded ONLY in the provided scores"
}

Rules:
- Reference the actual dimension scores and names (assessment, interview, experience, education, languages)
- If a dimension is null, say the data is unavailable — never guess a number for it
- If assessmentInstruments is present, explain each instrument the vacancy uses: a "scored" instrument's score
  feeds the assessment dimension in proportion to its effectiveWeight, except english, which counts once and only in
  the languages dimension (its effectiveWeight is its share of languages); a "gate" is only met, not_met or unknown,
  it never lowers the score and never rejects the candidate; an "advisory" instrument is never scored
- An instrument with status needs_review must be reviewed by a person before it counts — never describe it as a
  low score; no_result and no_value mean the result is unavailable
- If reviewPending is true, the overall score is provisional: say a person must review it before it is final,
  even when every instrument shows completed
- Do NOT recommend hire/no-hire — explain the score composition only
- narrative must be under 1200 characters
- Respond in Spanish unless the vacancy title is clearly in another language

${PROTECTED_ATTRIBUTES_RULE}`;

export const fitExplainerOutputSchema = z.object({
  narrative: z.string().max(1200),
});

export type FitExplainerResult = z.infer<typeof fitExplainerOutputSchema>;

// FIT v2 (C# compute behind Platform:FitEngineV2Enabled) adds `assessments` to the stored breakdown. The jsonb
// is untrusted input here: each entry is validated on its own, unknown keys are stripped (result ids, content
// and norm versions never reach the model), and a bad entry is dropped rather than failing the explanation.
const MAX_INSTRUMENT_ENTRIES = 16;
const MAX_REASON_CHARS = 200;

const instrumentEntrySchema = z.object({
  instrument: z.enum(['lia', 'english', 'itcia', 'personality', 'mi', 'pca', 'native_quiz']),
  use: z.enum(['scored', 'gate', 'advisory']),
  status: z.enum(['completed', 'no_result', 'needs_review', 'no_value']),
  score: z.number().finite().nullable().optional(),
  gate: z.enum(['met', 'not_met', 'unknown']).nullable().optional(),
  effectiveWeight: z.number().finite().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

type InstrumentSummary = {
  instrument: string;
  use: string;
  status: string;
  score: number | null;
  gate: string | null;
  effectiveWeight: number | null;
  reason: string | null;
};

/** The valid per-instrument entries of a v2 breakdown, in order; [] for a v1 breakdown or garbage. */
export function summarizeInstruments(assessments: unknown): InstrumentSummary[] {
  if (!Array.isArray(assessments)) return [];
  const out: InstrumentSummary[] = [];
  for (const raw of assessments.slice(0, MAX_INSTRUMENT_ENTRIES)) {
    const parsed = instrumentEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    out.push({
      instrument: e.instrument,
      use: e.use,
      status: e.status,
      score: e.score ?? null,
      gate: e.gate ?? null,
      effectiveWeight: e.effectiveWeight ?? null,
      reason: e.reason ? sanitizeInput(e.reason, MAX_REASON_CHARS) : null,
    });
  }
  return out;
}

const DEGRADED_FALLBACK: FitExplainerResult = {
  narrative: 'No se pudo generar la explicación automática. Revisión manual del desglose recomendada.',
};

export interface FitExplainerInput {
  overallScore: number;
  breakdown: {
    assessment: number | null;
    interview: number | null;
    experience: number | null;
    education: number | null;
    languages: number | null;
    llmJudgment: { score: number | null; recommendation: string; reasoning: string; strengths: string[]; gaps: string[] } | null;
    /** FIT v2 only (absent on v1 rows). Validated by {@link summarizeInstruments} before use. */
    fitVersion?: number;
    assessments?: unknown;
    /** FIT v2 only. Forwarded to the model only when it is exactly `true`. */
    reviewPending?: unknown;
  };
  /**
   * Accepted for call-site compatibility but NEVER sent to the model: the
   * prompt refers to "the candidate" (a name is a proxy for sex/ethnicity).
   */
  candidateName?: string;
  vacancyTitle: string;
}

export async function explainFit(
  orgId: string,
  input: FitExplainerInput,
): Promise<{ result: FitExplainerResult; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'fit-explainer',
    orgId,
    // candidateName is dropped here so it reaches neither the prompt nor the cache key.
    input: { overallScore: input.overallScore, breakdown: input.breakdown, vacancyTitle: input.vacancyTitle },
    systemPrompt: FIT_EXPLAINER_SYSTEM_PROMPT,
    buildUserMessage: ({ overallScore, breakdown, vacancyTitle }) => {
      const instruments = summarizeInstruments(breakdown.assessments);
      const summary = {
        overallScore,
        assessment: breakdown.assessment,
        interview: breakdown.interview,
        experience: breakdown.experience,
        education: breakdown.education,
        languages: breakdown.languages,
        // Only on v2 rows, so the user message built for a v1 row is unchanged.
        ...(instruments.length > 0 ? { assessmentInstruments: instruments } : {}),
        // A provisional v2 row (e.g. a settling write after the retries ran out) can show every instrument as
        // completed; this marker is the only sign it is not final. Absent otherwise, so v1 messages are unchanged.
        ...(breakdown.reviewPending === true ? { reviewPending: true } : {}),
      };
      const judgmentBlock = breakdown.llmJudgment
        ? wrapAsData(
            'prior_llm_judgment',
            `recommendation: ${sanitizeInput(breakdown.llmJudgment.recommendation, 50)}\nreasoning: ${sanitizeInput(breakdown.llmJudgment.reasoning, 1000)}\nstrengths: ${breakdown.llmJudgment.strengths.map((s) => sanitizeInput(s, 200)).join(', ')}\ngaps: ${breakdown.llmJudgment.gaps.map((g) => sanitizeInput(g, 200)).join(', ')}`,
          )
        : '';
      const candidateContext = wrapAsData(
        'candidate_context',
        `Candidate: ${CANDIDATE_LABEL}\nRole: ${sanitizeInput(vacancyTitle, 200)}`,
      );
      return `${wrapAsData('fit_scores', JSON.stringify(summary))}\n\n${candidateContext}\n\n${judgmentBlock}\n\nExplain this FIT score. Return JSON.`;
    },
    schema: fitExplainerOutputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 800,
  });

  return { result: data, model };
}
