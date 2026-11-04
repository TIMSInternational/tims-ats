// Recognises a permission denial among the errors a failed read can carry. Pure (no React / tRPC
// imports) so node tests can exercise it.
//
// - tRPC: a TRPCClientError carries the server shape in `data` (`code: 'FORBIDDEN'`, `httpStatus: 403`).
// - C# Platform API: lib/platform-api/client.ts throws PlatformApiError with the HTTP `status`.
//
// Used by ErrorState to show "no access" instead of "unexpected error + retry": retrying a denial can
// never succeed, so offering it only sends the user round in circles.

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

export function isForbiddenError(error: unknown): boolean {
  const data = field(error, 'data');
  if (field(data, 'code') === 'FORBIDDEN' || field(data, 'httpStatus') === 403) return true;
  return field(error, 'status') === 403;
}
