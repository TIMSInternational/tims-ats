/**
 * Maps a failed offer action (tRPC mutation) to a user-facing message.
 * FORBIDDEN gets a specific, actionable message instead of the raw server text.
 */

export interface OfferActionErrorLabels {
  forbidden: string;
  generic: string;
}

function errorCode(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object') return null;
  const data = (cause as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function describeOfferActionError(cause: unknown, labels: OfferActionErrorLabels): string {
  if (errorCode(cause) === 'FORBIDDEN') return labels.forbidden;
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return labels.generic;
}
