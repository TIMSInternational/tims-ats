// Error handling for the interview room's `interview.getById` query.

// A missing, foreign or malformed interview id will not start working on a
// retry. Without this, react-query's default 3 retries with backoff keep the
// room on its skeleton for several seconds before the error state appears.
const NON_RETRYABLE_CODES = new Set(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED', 'BAD_REQUEST']);

const MAX_RETRIES = 3;

export function trpcErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function shouldRetryInterviewQuery(failureCount: number, err: unknown): boolean {
  const code = trpcErrorCode(err);
  if (code && NON_RETRYABLE_CODES.has(code)) return false;
  return failureCount < MAX_RETRIES;
}
