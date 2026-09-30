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

export interface ApplyErrorCopy {
  applySubmitError: string;
  applyConsentVersionChanged: string;
}

// Toast text for a failed portal.applyToVacancy. A stale page bundle sends a superseded
// consentTextVersion, which the server rejects — the fix for the candidate is a reload.
export function applyErrorMessage(err: unknown, copy: ApplyErrorCopy): string {
  const message = err instanceof Error ? err.message : '';
  const issues = message ? parseZodIssues(message) : null;
  if (issues) {
    return issues.some((i) => i.path[0] === 'consentTextVersion')
      ? copy.applyConsentVersionChanged
      : copy.applySubmitError;
  }
  // Only a deliberate BAD_REQUEST message (e.g. the captcha failure) is user-facing copy;
  // anything else (an internal/DB error) never reaches the candidate verbatim.
  const data = errorDataSchema.safeParse(err);
  if (message && data.success && data.data.data.code === 'BAD_REQUEST') return message;
  return copy.applySubmitError;
}
