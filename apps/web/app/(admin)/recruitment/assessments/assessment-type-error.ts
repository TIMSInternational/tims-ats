import { ZodError } from 'zod';
import { PlatformApiError } from '../../../../lib/platform-api/client';

export interface AssessmentTypeErrorMessages {
  duplicateName: string;
  forbidden: string;
  notFound: string;
  nameRequired: string;
  failed: string;
  unavailable: string;
}

/**
 * Maps a failed assessment-type mutation to a user-facing message. Never returns an empty string, so a failure
 * is always visible (no silent failures): 409 → duplicate name, 403 → no permission, 400/validation → input rules,
 * anything else → generic retry message.
 *
 * 404 has two causes and they must not share a message. The C# handler's own 404 (the type id is not in the
 * caller's org) carries a `{ message }` body → "no longer exists". A 404 with NO handler body means the route
 * itself is not mapped — `Platform:AssessmentTypeWriteEnabled` is off on the API while the web flag
 * `NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP` is on (a flip-order mistake: enable the API flag FIRST) → "unavailable".
 */
export function assessmentTypeErrorMessage(error: unknown, messages: AssessmentTypeErrorMessages): string {
  if (error instanceof PlatformApiError) {
    if (error.status === 409) return messages.duplicateName;
    if (error.status === 401 || error.status === 403) return messages.forbidden;
    if (error.status === 404) return error.hasHandlerMessage ? messages.notFound : messages.unavailable;
    if (error.status === 400) return messages.nameRequired;
    return messages.failed;
  }
  if (error instanceof ZodError) return messages.failed;
  if (error instanceof Error && error.message === messages.unavailable) return messages.unavailable;
  return messages.failed;
}
