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

describe('engagement.submitSurveyResponse hardening', () => {
  const src = () => read('packages/api/src/routers/engagement.ts');

  it('is gated by engagement:create', () => {
    expect(src()).toMatch(/submitSurveyResponse:\s*permissionProcedure\('engagement',\s*'create'\)/);
  });

  it('respondent identity comes from ctx, never from input; no anonymous bypass', () => {
    // The input schema must not accept a userId; the create data derives userId
    // from ctx.user.id. No `anonymous` flag: userId NULL would bypass the
    // @@unique([surveyId, userId]) dedup (Postgres NULLs never collide) —
    // ballot-stuffing. Display anonymity is the slice-6 aggregation layer's job.
    const block = src().slice(src().indexOf('submitSurveyResponse'));
    const inputBlock = block.slice(0, block.indexOf('.mutation'));
    expect(inputBlock).not.toContain('userId');
    expect(inputBlock).not.toContain('anonymous');
    expect(block).toContain('userId: ctx.user.id');
  });

  it('answers record is bounded (max 100 keys, bounded key/value sizes)', () => {
    const block = src().slice(src().indexOf('submitSurveyResponse'));
    expect(block).toMatch(/\.max\(200\)/);   // key bound
    expect(block).toMatch(/\.max\(5000\)/);  // string-answer bound
    expect(block).toMatch(/length\s*<=\s*100/); // key-count bound
  });

  it('maps duplicate-submission P2002 to a clean CONFLICT (not a 500)', () => {
    const block = src().slice(src().indexOf('submitSurveyResponse'));
    expect(block).toMatch(/P2002/);
    expect(block).toMatch(/CONFLICT/);
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
