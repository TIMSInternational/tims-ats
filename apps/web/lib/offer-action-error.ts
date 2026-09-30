/**
 * Maps a failed offer action (tRPC mutation) to a user-facing message.
 * FORBIDDEN gets a specific, actionable message instead of the raw server text.
 * Only codes whose server messages are written for users (NOT_FOUND, CONFLICT, and a plain-text
 * BAD_REQUEST such as "Solo se pueden editar ofertas en estado borrador") are shown verbatim.
 * Everything else — INTERNAL_SERVER_ERROR, a BAD_REQUEST carrying serialized Zod issues, network
 * failures, unknown codes — falls back to the generic label so internals never reach the user.
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

const HUMAN_MESSAGE_CODES = new Set(['NOT_FOUND', 'CONFLICT', 'BAD_REQUEST']);

/** tRPC's default formatter puts Zod input issues in `message` as a JSON array — not user text. */
function looksSerialized(message: string): boolean {
  return message.startsWith('[') || message.startsWith('{');
}

export function describeOfferActionError(cause: unknown, labels: OfferActionErrorLabels): string {
  const code = errorCode(cause);
  if (code === 'FORBIDDEN') return labels.forbidden;
  if (code === null || !HUMAN_MESSAGE_CODES.has(code)) return labels.generic;
  const message = cause instanceof Error ? cause.message.trim() : '';
  if (!message || looksSerialized(message)) return labels.generic;
  return message;
}
