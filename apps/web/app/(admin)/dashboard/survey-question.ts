import { z } from 'zod';

// The Survey.questions column is Prisma `Json`, so the tRPC output types it as
// JsonValue — the stored array shape is NOT inferred. Worse, TWO real shapes
// exist in the wild and they disagree on vocabulary:
//
//   1. LEGACY / SEED (packages/db/prisma/seed-demo.ts): authored by hand and by
//      older tooling. Uses `{ id, text, type, min?, max? }` with type one of
//      'scale' | 'nps' | 'open_text' | 'yes_no' (plus 'emoji' etc. we can't render).
//   2. AUTHORING (the C# create-survey endpoint's question shape, since 2026-07-29 —
//      Tims.Domain/Engagement/EngagementWriteModels.cs record + validation in
//      Tims.Api/Engagement/EngagementWriteEndpoints.cs; formerly createSurvey's Zod in
//      packages/api/.../engagement.ts before its TS side was deleted): produces
//      `{ text, type, options?, required, category? }` with type one of
//      'scale' | 'text' | 'multiple_choice' | 'yes_no' (no id/min/max).
//
// The take form must render BOTH. The previous all-or-nothing
// `z.array(authoringSchema).safeParse` rejected the WHOLE survey when one
// question used an unrecognized type ('open_text'/'nps'), so a populated survey
// rendered empty. Instead we parse each element INDEPENDENTLY and DROP only the
// invalid ones, normalizing every accepted element into ONE renderable union
// (`SurveyQuestion`) that the field component consumes — no `any`, with the
// answer value staying `string | number` (matches the C# submit-survey-response
// endpoint's input; formerly submitSurveyResponse's Zod input before its TS side
// was deleted 2026-07-29).

// Default numeric ranges when the stored question omits min/max.
const SCALE_DEFAULT_MIN = 1;
const SCALE_DEFAULT_MAX = 5;
const NPS_DEFAULT_MIN = 0;
const NPS_DEFAULT_MAX = 10;

// --- Renderable, normalized union the field component renders ---
// `kind` is the SINGLE discriminant the UI switches on (mapped from both stored
// vocabularies). `text` is the answer key (answers are keyed by question text).

/** Numeric scale (covers stored `scale` and `nps`) → number answer. */
export interface ScaleQuestion {
  kind: 'scale';
  text: string;
  required: boolean;
  min: number;
  max: number;
}

/** Free text (covers stored `open_text` and authoring `text`) → string answer. */
export interface TextQuestion {
  kind: 'text';
  text: string;
  required: boolean;
}

/** Single-choice radios from `options` (stored `multiple_choice`) → string answer. */
export interface ChoiceQuestion {
  kind: 'choice';
  text: string;
  required: boolean;
  options: string[];
}

/** Two-radio yes/no (stored `yes_no`) → string answer. */
export interface YesNoQuestion {
  kind: 'yes_no';
  text: string;
  required: boolean;
}

export type SurveyQuestion = ScaleQuestion | TextQuestion | ChoiceQuestion | YesNoQuestion;

// An answer is a number (scale/nps) or a string (text / choice / yes_no),
// matching the C# submit-survey-response endpoint's input (still
// z.union([z.string(), z.number()]) shape server-side, now enforced in
// EngagementWriteEndpoints.cs rather than a TS Zod schema).
export type SurveyAnswer = string | number;

// Tolerant per-element schema: accept the SUPERSET of fields across both stored
// shapes, with every distinguishing field optional. We then map `type` →
// normalized `kind`. Unknown fields (id, category, emoji options) are ignored.
const rawQuestionSchema = z.object({
  text: z.string().min(1).max(500),
  type: z.string(),
  options: z.array(z.string().max(200)).optional(),
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

type RawQuestion = z.infer<typeof rawQuestionSchema>;

// Normalize one raw question into a renderable union member, or null to DROP it
// (unmappable type, or a choice with no usable options). `required` defaults true.
function normalizeQuestion(raw: RawQuestion): SurveyQuestion | null {
  const required = raw.required ?? true;

  switch (raw.type) {
    case 'scale':
      return {
        kind: 'scale',
        text: raw.text,
        required,
        min: raw.min ?? SCALE_DEFAULT_MIN,
        max: raw.max ?? SCALE_DEFAULT_MAX,
      };
    case 'nps':
      return {
        kind: 'scale',
        text: raw.text,
        required,
        min: raw.min ?? NPS_DEFAULT_MIN,
        max: raw.max ?? NPS_DEFAULT_MAX,
      };
    case 'open_text':
    case 'text':
      return { kind: 'text', text: raw.text, required };
    case 'multiple_choice': {
      const options = (raw.options ?? []).filter((o) => o.length > 0);
      if (options.length === 0) return null; // unrenderable without choices → drop
      return { kind: 'choice', text: raw.text, required, options };
    }
    case 'yes_no':
      return { kind: 'yes_no', text: raw.text, required };
    default:
      return null; // unknown/unmappable type (e.g. 'emoji') → drop this question
  }
}

// Typed, per-question-tolerant guard over the raw JsonValue. Non-array / non-object
// input → []. Each element is parsed and normalized INDEPENDENTLY; invalid or
// unmappable elements are dropped without rejecting the whole survey.
export function parseSurveyQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw)) return [];

  const out: SurveyQuestion[] = [];
  for (const element of raw) {
    const parsed = rawQuestionSchema.safeParse(element);
    if (!parsed.success) continue; // missing text / wrong primitive shape → drop
    const normalized = normalizeQuestion(parsed.data);
    if (normalized) out.push(normalized);
  }
  return out;
}
