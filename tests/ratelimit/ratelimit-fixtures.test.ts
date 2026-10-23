import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// WP2.6 rate-limit parity fixtures (contracts/ratelimit-fixtures/*.json), asserted here against
// the REAL TS `getRateLimitCategory` and the identifier logic mirrored from `trpc.ts`, and
// identically by Tims.UnitTests (RateLimitCategoryFixtureTests / RateLimitIdentityFixtureTests).
// A behavior change edits the JSON once; either stack disagreeing turns its CI red. This pins the
// C# limiter's category + bucket-key logic to the TS source so the two stacks share Redis buckets.

import { getRateLimitCategory } from '../../packages/api/src/middleware/rate-limit';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../contracts/ratelimit-fixtures/${name}`, import.meta.url)),
      'utf8',
    ),
  );

// --- category.json: assert the REAL getRateLimitCategory --------------------------------
describe('ratelimit-fixtures: category.json', () => {
  const data = fixture('category.json') as {
    cases: Array<{ name: string; path: string; type: 'query' | 'mutation'; expected: string }>;
  };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(getRateLimitCategory(c.path, c.type)).toBe(c.expected);
  });
});

// --- identifier.json: mirror the trpc.ts identifier logic (lines ~29-49 + ~207) ---------
// `anonymousIdentifier` / `withRateLimit` / the external per-key limit are not exported from
// trpc.ts, so this reproduces them VERBATIM (kept in lockstep with trpc.ts). The C# port
// (RateLimitIdentity.For) asserts the SAME fixture, so the JSON is the cross-stack pin.
function anonymousIdentifier(xRealIp: string | null, xForwardedFor: string | null): string {
  const realIp = xRealIp?.trim();
  if (realIp) return `ip:${realIp}`;
  if (xForwardedFor) {
    const hops = xForwardedFor
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (hops.length > 0) return `ip:${hops[hops.length - 1]}`;
  }
  return 'anonymous';
}

interface IdentifierCase {
  name: string;
  category: string;
  userId: string | null;
  organizationId: string | null;
  apiKeyId: string | null;
  xRealIp: string | null;
  xForwardedFor: string | null;
  expected: string;
}

function buildIdentifier(c: IdentifierCase): string {
  // (1) external API-key surface — trpc.ts line ~207: `apikey:${principal.apiKeyId}`.
  if (c.apiKeyId) return `apikey:${c.apiKeyId}`;
  // (2)/(3) withRateLimit — trpc.ts lines ~46-49: AI is per-org, else user id, else anonymous IP.
  if (c.category === 'ai' && c.organizationId) return `org:${c.organizationId}`;
  return c.userId ?? anonymousIdentifier(c.xRealIp, c.xForwardedFor);
}

describe('ratelimit-fixtures: identifier.json', () => {
  const data = fixture('identifier.json') as { cases: IdentifierCase[] };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(buildIdentifier(c)).toBe(c.expected);
  });
});
