import { z } from 'zod';

// tRPC reports an input-validation failure as BAD_REQUEST whose message is the JSON list of
// zod issues. Never toast that raw: map it to translated copy instead.
const zodIssuesSchema = z.array(z.object({ path: z.array(z.union([z.string(), z.number()])).max(20) })).max(100);
const errorDataSchema = z.object({ data: z.object({ code: z.string().max(64) }) });

function parseZodIssues(message: string): z.infer<typeof zodIssuesSchema> | null {
  try {
    const parsed = zodIssuesSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function errorCode(err: unknown): string | null {
  const data = errorDataSchema.safeParse(err);
  return data.success ? data.data.data.code : null;
}

export interface ApplyErrorCopy {
  applySubmitError: string;
  applyConsentVersionChanged: string;
  applyVacancyClosed: string;
  emailInvalid: string;
  linkedinInvalid: string;
}

/** A form field the server rejected, so the modal can return the candidate to the step that holds it. */
export type ApplyErrorField = 'email' | 'linkedinUrl';

const FIELD_STEP: Record<ApplyErrorField, 1 | 2> = { email: 1, linkedinUrl: 2 };

/** The first rejected field the candidate can fix, or null. */
export function applyErrorField(err: unknown): ApplyErrorField | null {
  const message = err instanceof Error ? err.message : '';
  const issues = message ? parseZodIssues(message) : null;
  const field = issues?.map((i) => i.path[0]).find((p): p is ApplyErrorField => p === 'email' || p === 'linkedinUrl');
  return field ?? null;
}

/** The apply-modal step that holds a rejected field. */
export function applyErrorStep(field: ApplyErrorField): 1 | 2 {
  return FIELD_STEP[field];
}

// Toast text for a failed portal.applyToVacancy. A stale page bundle sends a superseded
// consentTextVersion, which the server rejects — the fix for the candidate is a reload.
export function applyErrorMessage(err: unknown, copy: ApplyErrorCopy): string {
  const message = err instanceof Error ? err.message : '';
  const issues = message ? parseZodIssues(message) : null;
  if (issues) {
    if (issues.some((i) => i.path[0] === 'consentTextVersion')) return copy.applyConsentVersionChanged;
    const field = applyErrorField(err);
    if (field === 'email') return copy.emailInvalid;
    if (field === 'linkedinUrl') return copy.linkedinInvalid;
    return copy.applySubmitError;
  }
  const code = errorCode(err);
  // The vacancy is no longer published (closed or frozen while the form was open): the apply
  // lookup finds nothing, which the API reports as NOT_FOUND.
  if (code === 'NOT_FOUND') return copy.applyVacancyClosed;
  // Only a deliberate BAD_REQUEST message (e.g. the captcha failure) is user-facing copy;
  // anything else (an internal/DB error) never reaches the candidate verbatim.
  if (message && code === 'BAD_REQUEST') return message;
  return copy.applySubmitError;
}

/** True when the failure means the vacancy stopped taking applications (see applyErrorMessage). */
export function isVacancyClosedError(err: unknown): boolean {
  return errorCode(err) === 'NOT_FOUND';
}
