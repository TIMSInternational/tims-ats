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
 * is always visible (no silent failures): 409 → duplicate name, 403 → no permission, 404 → gone (or the C# route
 * is dark), 400/validation → input rules, anything else → generic retry message.
 */
export function assessmentTypeErrorMessage(error: unknown, messages: AssessmentTypeErrorMessages): string {
  if (error instanceof PlatformApiError) {
    if (error.status === 409) return messages.duplicateName;
    if (error.status === 401 || error.status === 403) return messages.forbidden;
    if (error.status === 404) return messages.notFound;
    if (error.status === 400) return messages.nameRequired;
    return messages.failed;
  }
  if (error instanceof ZodError) return messages.failed;
  if (error instanceof Error && error.message === messages.unavailable) return messages.unavailable;
  return messages.failed;
}
