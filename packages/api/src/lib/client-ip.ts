/**
 * Trusted client-IP derivation, shared by the rate limiter and the audit writers.
 *
 * NEVER trust the client-controlled left-most `x-forwarded-for` value — an attacker
 * sets it freely. Prefer `x-real-ip` (written by the platform edge, not spoofable);
 * otherwise take the LAST hop of `x-forwarded-for`, the entry appended by the
 * trusted proxy, never the first.
 *
 * This lives in its own leaf module rather than in `trpc.ts` because `trpc.ts`
 * bootstraps auth, env validation and Redis at import time. Anything that needs the
 * derivation — including tests that want to exercise it for real rather than mock
 * it — can import this without dragging that in.
 */
export function clientIpFrom(headers: Headers): string | null {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return null;
}
