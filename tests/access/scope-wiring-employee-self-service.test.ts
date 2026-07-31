import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave (role rebuild) Slice 5B — static tripwires for the OWN-scoped employee
// self-service reads. An employee sees ONLY their own data, never an org-wide
// rollup. These guards fail closed if a future edit widens scope. (The third
// read, compensation.myCompensation, was deleted 2026-07-29 — C#-only now.)
//
//   engagement.myPendingSurveys → REMOVED 2026-07-31 (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP
//                                 confirmed live in prod; its TS procedure was deleted, C# is the
//                                 sole implementation now). Its own-scoped anti-join guarantee
//                                 (org filter + `responses: { none: { userId: ctx.user.id } } }`,
//                                 no requireOrgScope) is now asserted against the live C# API by
//                                 services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/
//                                 EngagementReadEndpointTests.cs.
//   consent.myConsents          → CURRENT user's DataConsent rows, subjectUserId
//                                 hard-pinned to ctx.user.id. protectedProcedure
//                                 (reading your own consent is inherently safe).

const ROOT = join(__dirname, '..', '..');
const readConsent = () => readFileSync(join(ROOT, 'packages/api/src/routers/consent.ts'), 'utf8');

describe('consent.myConsents — own-pinned DataConsent read', () => {
  const src = () => readConsent();

  it('router file exists', () => {
    expect(() => readConsent()).not.toThrow();
  });

  it('myConsents exists and uses protectedProcedure', () => {
    const s = src();
    expect(s).toMatch(/myConsents:/);
    expect(s).toMatch(/protectedProcedure/);
  });

  it('does NOT call requireOrgScope', () => {
    expect(src()).not.toMatch(/requireOrgScope/);
  });

  it('takes NO userId input — subjectUserId is hard-pinned to ctx.user.id', () => {
    const s = src();
    expect(s).not.toMatch(/input\.userId/);
    expect(s).toMatch(/subjectUserId:\s*ctx\.user\.id/);
  });

  it('filters by organizationId', () => {
    expect(src()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it('uses an explicit select (no full-row findMany)', () => {
    expect(src()).toMatch(/select:\s*\{/);
  });
});

describe('consent router is wired into the appRouter', () => {
  it('root.ts mounts the consent router', () => {
    const root = readFileSync(join(ROOT, 'packages/api/src/root.ts'), 'utf8');
    expect(root).toMatch(/consentRouter/);
    expect(root).toMatch(/consent:\s*consentRouter/);
  });
});
