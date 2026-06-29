import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Behavioral tests for engagement.activateSurvey ──────────────────────────
//
// Harness mirrors survey-contributor-skip-suppression.test.ts:
//   - mock `../../packages/api/src/trpc` so permissionProcedure is a bare pass-through
//   - mock `@tims/db`'s tenantDb with trackable fns
//   - mock `../../packages/api/src/access` to no-op the org gates
//   - import the REAL engagementRouter and build a caller via createCallerFactory
//
// Cases:
//   (a) findFirst → null  ⟹  TRPCError NOT_FOUND
//   (b) findFirst → { id, startsAt: null }  ⟹  update called with status:'active',
//       startsAt is a Date (new Date() fallback applied); returns { id, status }
//   (c) findFirst → { id, startsAt: <existing Date> }  ⟹  update.data.startsAt
//       equals the existing Date (fallback NOT applied)

const surveyFindFirst = vi.fn();
const surveyUpdate = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    survey: {
      findFirst: (...a: unknown[]) => surveyFindFirst(...a),
      update: (...a: unknown[]) => surveyUpdate(...a),
    },
  },
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return {
    ...actual,
    requireOrgScope: vi.fn(),
    assertScoped: vi.fn(),
    assertSubjectInScope: vi.fn(),
    scopeWhereFor: vi.fn(async () => ({})),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { engagementRouter } from '../../packages/api/src/routers/engagement';

interface ActivateSurveyCaller {
  activateSurvey(input: { id: string }): Promise<{ id: string; status: string }>;
}

const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
const createCaller = t.createCallerFactory(
  engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0],
);
const ctx = { user: { organizationId: 'org-1', id: 'u-1' }, access: {} };
const caller = () => createCaller(ctx) as unknown as ActivateSurveyCaller;

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => vi.clearAllMocks());

// ── Behavioral tests (core) ──────────────────────────────────────────────────

describe('engagement.activateSurvey — behavioral', () => {
  it('(a) rejects with TRPCError NOT_FOUND when survey does not exist', async () => {
    surveyFindFirst.mockResolvedValue(null);

    await expect(caller().activateSurvey({ id: VALID_UUID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(surveyUpdate).not.toHaveBeenCalled();
  });

  it('(b) calls update with status:active and a Date startsAt when startsAt is null', async () => {
    surveyFindFirst.mockResolvedValue({ id: 'srv-1', startsAt: null });
    surveyUpdate.mockResolvedValue({ id: 'srv-1', status: 'active' });

    const result = await caller().activateSurvey({ id: VALID_UUID });

    expect(surveyUpdate).toHaveBeenCalledOnce();
    const call = surveyUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; startsAt: unknown };
    };
    expect(call.where.id).toBe('srv-1');
    expect(call.data.status).toBe('active');
    expect(call.data.startsAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ id: 'srv-1', status: 'active' });
  });

  it('(c) preserves existing startsAt — does not apply the new Date() fallback', async () => {
    const existingDate = new Date('2026-03-01T08:00:00.000Z');
    surveyFindFirst.mockResolvedValue({ id: 'srv-2', startsAt: existingDate });
    surveyUpdate.mockResolvedValue({ id: 'srv-2', status: 'active' });

    await caller().activateSurvey({ id: VALID_UUID });

    const call = surveyUpdate.mock.calls[0]![0] as {
      data: { startsAt: unknown };
    };
    expect(call.data.startsAt).toBe(existingDate);
  });
});

// ── Supplementary static-source assertions ───────────────────────────────────

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('engagement.activateSurvey — static invariants', () => {
  const router = read('packages/api/src/routers/engagement.ts');
  const block = (() => {
    const start = router.indexOf('activateSurvey');
    const end = router.indexOf('getSurveyResults');
    return router.slice(start, end);
  })();

  it('is declared as a permissionProcedure for engagement:create', () => {
    expect(router).toMatch(/activateSurvey:\s*permissionProcedure\(\s*'engagement'\s*,\s*'create'\s*\)/);
  });

  it('scopes findFirst by organizationId (cross-org guard)', () => {
    expect(block).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it('sets status:active on db.survey.update', () => {
    expect(block).toMatch(/status:\s*'active'/);
    expect(block).toMatch(/db\.survey\.update/);
  });

  it('uses startsAt null-coalesce fallback (existing.startsAt ?? new Date())', () => {
    expect(block).toMatch(/existing\.startsAt\s*\?\?\s*new Date\(\)/);
  });

  it('returns only { id, status } via explicit select', () => {
    expect(block).toMatch(/select:\s*\{\s*id:\s*true[,\s]+status:\s*true\s*\}/);
  });

  it('throws TRPCError NOT_FOUND when survey is not found in org', () => {
    expect(block).toMatch(/NOT_FOUND/);
    expect(block).toMatch(/TRPCError/);
  });

  it('does NOT call assertScoped (survey is not a ScopedEntity)', () => {
    expect(block).not.toMatch(/assertScoped/);
  });
});
