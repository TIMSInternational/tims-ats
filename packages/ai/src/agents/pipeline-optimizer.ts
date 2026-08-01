import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';

const SYSTEM_PROMPT = `You are a recruitment pipeline optimizer for an HR/ATS platform.
You receive a single candidate application's current pipeline position (candidate name,
current stage name, stage order) and recommend the single highest-leverage next action a
recruiter should take to keep the application moving.

Output format: JSON with the following structure:
{
  "recommendation": "one short sentence naming the next action",
  "confidence": 0.0-1.0,
  "suggestedActions": [
    { "action": "snake_case_action_id", "label": "Etiqueta corta para el boton", "priority": "high" | "medium" | "low" }
  ]
}

Rules:
- Ground the recommendation ONLY in the provided stage/candidate context — never invent
  facts about the candidate's skills, history, or documents you were not given
- suggestedActions must contain between 1 and 3 items, ordered by priority (high first)
- action must be a short snake_case identifier (e.g. "schedule_interview")
- confidence reflects how clear-cut the next step is given a stage name alone, not
  candidate quality — a well-defined stage (e.g. "Entrevistas") warrants higher confidence
  than an ambiguous/custom stage name
- recommendation must be under 300 characters
- Respond in Spanish unless the candidate name suggests otherwise`;

export const pipelineOptimizerOutputSchema = z.object({
  recommendation: z.string().max(300),
  confidence: z.number().min(0).max(1),
  suggestedActions: z
    .array(
      z.object({
        action: z.string().max(50),
        label: z.string().max(100),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(3),
});

export type PipelineOptimizerResult = z.infer<typeof pipelineOptimizerOutputSchema>;

const DEGRADED_FALLBACK: PipelineOptimizerResult = {
  recommendation: 'No se pudo generar una recomendacion automatica. Revision manual del pipeline recomendada.',
  confidence: 0,
  suggestedActions: [],
};

export interface PipelineOptimizerInput {
  candidateName: string;
  currentStageName: string;
  currentStageOrder: number;
}

export async function suggestNextBestAction(
  orgId: string,
  input: PipelineOptimizerInput,
): Promise<{ result: PipelineOptimizerResult; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'pipeline-optimizer',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ candidateName, currentStageName, currentStageOrder }) => {
      const context = wrapAsData(
        'application_context',
        `Candidate: ${sanitizeInput(candidateName, 200)}\nCurrent stage: ${sanitizeInput(currentStageName, 100)}\nStage order: ${currentStageOrder}`,
      );
      return `${context}\n\nSuggest the next best action for this application. Return JSON.`;
    },
    schema: pipelineOptimizerOutputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 500,
  });

  return { result: data, model };
}
