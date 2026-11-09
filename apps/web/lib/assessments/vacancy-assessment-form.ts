import { z } from 'zod';
import {
  CEFR_LEVELS,
  INSTRUMENT_USES,
  FIT_REQUIREMENT_INSTRUMENTS,
  type AssessmentRequirement,
  type AssessmentRequirementInput,
  type CefrLevel,
  type FitRequirementInstrument,
  type InstrumentUse,
} from '../platform-api/vacancy-assessments';

// The vacancy assessments editor's rules, mirroring what FIT v2 accepts (Tims.Domain FitV2Kernels): every entry names
// an instrument, how the vacancy uses it (scored / gate / advisory), the minimum that use needs, and the
// job-relatedness reason (design §6.3: a test is assigned only when the vacancy lists it, with a reason). The server
// is strict too, so nothing the editor sends is silently dropped.

export const MAX_REASON_LENGTH = 500;
export const MIN_REASON_LENGTH = 3;

/**
 * The reason as it is sent: whitespace runs (a textarea's line breaks included) collapse to one space, so the stored
 * text has no control character. The server and every assignment then apply the same rule: 3 to 500 characters, no
 * control characters (ProviderFormats.IsReason).
 */
export function normalizeReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim();
}

// Unicode Cc, as .NET char.IsControl counts it.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Personality, MI and PCA are never scored and never gate (no evidence a higher result predicts performance). */
export function allowedUses(instrument: FitRequirementInstrument): readonly InstrumentUse[] {
  return instrument === 'personality' || instrument === 'mi' || instrument === 'pca' ? ['advisory'] : INSTRUMENT_USES;
}

/** The default use FIT v2 applies when none is configured. */
export function defaultUse(instrument: FitRequirementInstrument): InstrumentUse {
  if (instrument === 'english') return 'gate';
  if (instrument === 'lia' || instrument === 'itcia' || instrument === 'native_quiz') return 'scored';
  return 'advisory';
}

export type MinimumKind = 'globalPercentile' | 'cefr' | 'level' | 'score';

/** The kind of minimum an instrument takes; null for the advisory-only instruments. */
export function minimumKind(instrument: FitRequirementInstrument): MinimumKind | null {
  switch (instrument) {
    case 'lia':
      return 'globalPercentile';
    case 'english':
      return 'cefr';
    case 'itcia':
      return 'level';
    case 'native_quiz':
      return 'score';
    default:
      return null;
  }
}

/** A minimum is needed for every scored or gated use, except a scored ATS quiz (optional there). */
export function minimumRequired(instrument: FitRequirementInstrument, use: InstrumentUse): boolean {
  if (use === 'advisory' || minimumKind(instrument) === null) return false;
  return instrument !== 'native_quiz' || use === 'gate';
}

/** One editor row; `minimum` holds the field's text so a half-typed number is not lost. */
export interface AssessmentRow {
  instrument: FitRequirementInstrument;
  use: InstrumentUse;
  minimum: string;
  reason: string;
  /** A stored weight, kept as is (the editor does not set weights). */
  weight: number | null;
}

export function toRow(requirement: AssessmentRequirement): AssessmentRow {
  const min = requirement.min;
  const minimum = min?.globalPercentile ?? min?.level ?? min?.score ?? (min?.cefr ? min.cefr : null);
  return {
    instrument: requirement.instrument,
    use: requirement.use,
    minimum: minimum === null || minimum === undefined ? '' : String(minimum),
    reason: requirement.reason ?? '',
    weight: requirement.weight,
  };
}

export function newRow(instrument: FitRequirementInstrument): AssessmentRow {
  return { instrument, use: defaultUse(instrument), minimum: '', reason: '', weight: null };
}

/** The entry sent to the server: a minimum only where the use takes one, a weight only on a scored non-English entry. */
export function toInput(row: AssessmentRow): AssessmentRequirementInput {
  const input: AssessmentRequirementInput = {
    instrument: row.instrument,
    use: row.use,
    reason: normalizeReason(row.reason),
  };
  const kind = minimumKind(row.instrument);
  if (row.use !== 'advisory' && kind && row.minimum.trim() !== '') {
    input.min = kind === 'cefr' ? { cefr: row.minimum as CefrLevel } : { [kind]: Number(row.minimum) };
  }
  if (row.use === 'scored' && row.instrument !== 'english' && row.weight !== null) input.weight = row.weight;
  return input;
}

function minimumIsValid(instrument: FitRequirementInstrument, text: string): boolean {
  const kind = minimumKind(instrument);
  if (kind === 'cefr') return (CEFR_LEVELS as readonly string[]).includes(text);
  const value = Number(text);
  if (!Number.isFinite(value) || text.trim() === '') return false;
  if (kind === 'level') return Number.isInteger(value) && value >= 1 && value <= 5;
  return value >= 0 && value <= 100;
}

/** Validation messages are i18n keys of `t.vacancyAssessments`. */
export const ROW_ERRORS = {
  reason: 'errorReasonRequired',
  minimum: 'errorMinimumInvalid',
  use: 'errorUseNotAllowed',
} as const;

const rowSchema = z
  .object({
    instrument: z.enum(FIT_REQUIREMENT_INSTRUMENTS),
    use: z.enum(INSTRUMENT_USES),
    minimum: z.string().max(8),
    reason: z.string().max(MAX_REASON_LENGTH * 2),
    weight: z.number().nullable(),
  })
  .superRefine((row, ctx) => {
    const reason = normalizeReason(row.reason);
    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH || CONTROL.test(reason)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: ROW_ERRORS.reason });
    }
    if (!allowedUses(row.instrument).includes(row.use)) {
      ctx.addIssue({ code: 'custom', path: ['use'], message: ROW_ERRORS.use });
    }
    const hasMinimum = row.minimum.trim() !== '';
    const needsCheck = row.use !== 'advisory' && minimumKind(row.instrument) !== null;
    if (
      needsCheck &&
      (hasMinimum ? !minimumIsValid(row.instrument, row.minimum) : minimumRequired(row.instrument, row.use))
    ) {
      ctx.addIssue({ code: 'custom', path: ['minimum'], message: ROW_ERRORS.minimum });
    }
  });

/** The editor form: every listed instrument once. */
export const assessmentFormSchema = z.object({
  rows: z
    .array(rowSchema)
    .max(FIT_REQUIREMENT_INSTRUMENTS.length)
    .refine((rows) => new Set(rows.map((r) => r.instrument)).size === rows.length),
});

export type AssessmentForm = z.infer<typeof assessmentFormSchema>;
