import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 Slice 2 — endpoint hardening. Static-source assertions in the same
// style as tests/security/auth-authorization.test.ts: these are tripwires that
// fail if an ungated procedure is ever reintroduced.
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('notification router hardening', () => {
  const src = () => read('packages/api/src/routers/notification.ts');

  it('create is gated by permissionProcedure(notification, create)', () => {
    expect(src()).toMatch(/create:\s*permissionProcedure\('notification',\s*'create'\)/);
  });

  it('bulkCreate is gated by permissionProcedure(notification, create)', () => {
    expect(src()).toMatch(/bulkCreate:\s*permissionProcedure\('notification',\s*'create'\)/);
  });

  it('no mutation in the router uses bare protectedProcedure except self-scoped ones', () => {
    // The self-scoped mutations (markAsRead/markAllAsRead/archive/archiveAllRead/
    // delete/updatePreferences) filter by ctx.user.id and stay protectedProcedure.
    // create/bulkCreate must NOT appear with protectedProcedure.
    expect(src()).not.toMatch(/create:\s*protectedProcedure/);
    expect(src()).not.toMatch(/bulkCreate:\s*protectedProcedure/);
  });
});

describe('organization router hardening', () => {
  const src = () => read('packages/api/src/routers/organization.ts');

  it('listCompanies / listBusinessUnits / listTeams are gated by organization:read', () => {
    expect(src()).toMatch(/listCompanies:\s*permissionProcedure\('organization',\s*'read'\)/);
    expect(src()).toMatch(/listBusinessUnits:\s*permissionProcedure\('organization',\s*'read'\)/);
    expect(src()).toMatch(/listTeams:\s*permissionProcedure\('organization',\s*'read'\)/);
  });

  it('getCurrent stays protectedProcedure (own-org lookup, deliberate)', () => {
    expect(src()).toMatch(/getCurrent:\s*protectedProcedure/);
  });
});

describe('portal router contains only public career-site procedures', () => {
  const src = () => read('packages/api/src/routers/portal.ts');

  it('has NO protectedProcedure procedures (dead staff-session stubs removed)', () => {
    // The pre-candidateProcedure staff stubs (uploadDocument, getMyAssessments,
    // startAssessment, acceptOffer, declineOffer, updateProfile,
    // requestDataDeletion, submitNps) are dead: zero client callers; live
    // candidate flows are candidatePortal (candidateProcedure) + /offers/sign/[token].
    expect(src()).not.toMatch(/:\s*protectedProcedure/);
  });

  it('keeps the four public procedures', () => {
    for (const p of ['getPortalStats', 'listVacancies', 'getVacancy', 'applyToVacancy']) {
      expect(src()).toMatch(new RegExp(`${p}:\\s*publicProcedure`));
    }
  });

  it('does not import protectedProcedure anymore', () => {
    expect(src()).not.toMatch(/import\s*{[^}]*protectedProcedure[^}]*}\s*from\s*'\.\.\/trpc'/);
  });
});
