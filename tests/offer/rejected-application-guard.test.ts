import { describe, expect, it, vi } from 'vitest';
import {
  assertApplicationNotRejected,
  closedApplicationReason,
  lockAndAssertApplicationNotRejected,
  notRejectedApplication,
  WITHDRAWN_APPLICATION_MESSAGE,
} from '../../packages/api/src/routers/offer/rejected-application-guard';

const ORG = '11111111-1111-4111-8111-111111111111';
const OFFER = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const CAND = '44444444-4444-4444-8444-444444444444';
const VAC = '55555555-5555-4555-8555-555555555555';

function client(offer: { applicationId: string | null } | null, statuses: string[]) {
  return {
    offer: {
      findFirst: vi.fn().mockResolvedValue(offer ? { ...offer, candidateId: CAND, vacancyId: VAC } : null),
    },
    application: { findMany: vi.fn().mockResolvedValue(statuses.map((status) => ({ status }))) },
  };
}

describe('assertApplicationNotRejected', () => {
  it("refuses when the offer's linked application was rejected", async () => {
    const c = client({ applicationId: APP }, ['rejected']);
    await expect(assertApplicationNotRejected(c as never, ORG, OFFER, 'no')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'no',
    });
    expect(c.offer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OFFER, organizationId: ORG } }),
    );
    expect(c.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APP, organizationId: ORG } }),
    );
  });

  it('allows an active or hired linked application', async () => {
    for (const status of ['active', 'hired']) {
      await expect(
        assertApplicationNotRejected(client({ applicationId: APP }, [status]) as never, ORG, OFFER, 'no'),
      ).resolves.toBeUndefined();
    }
  });

  it("falls back to the candidate's applications for the vacancy when the offer has no link", async () => {
    const c = client({ applicationId: null }, ['rejected', 'rejected']);
    await expect(assertApplicationNotRejected(c as never, ORG, OFFER, 'no')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(c.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, candidateId: CAND, vacancyId: VAC } }),
    );
  });

  it('allows an unlinked offer when any application for the vacancy is still open, or none exists', async () => {
    await expect(
      assertApplicationNotRejected(client({ applicationId: null }, ['rejected', 'active']) as never, ORG, OFFER, 'no'),
    ).resolves.toBeUndefined();
    await expect(
      assertApplicationNotRejected(client({ applicationId: null }, []) as never, ORG, OFFER, 'no'),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when the offer is not in the organization', async () => {
    const c = client(null, ['rejected']);
    await expect(assertApplicationNotRejected(c as never, ORG, OFFER, 'no')).resolves.toBeUndefined();
    expect(c.application.findMany).not.toHaveBeenCalled();
  });

  it('notRejectedApplication checks linked offers by application and unlinked offers by candidate+vacancy', () => {
    const open = { notIn: ['rejected', 'withdrawn'] };
    expect(notRejectedApplication(VAC)).toEqual({
      OR: [
        { applicationId: { not: null }, application: { status: open } },
        { applicationId: null, candidate: { applications: { none: { vacancyId: VAC } } } },
        { applicationId: null, candidate: { applications: { some: { vacancyId: VAC, status: open } } } },
      ],
    });
  });

  // Codex review of release/pilot-ux-wave2 (P1): a withdrawn application (C-33) closes the offer too, and says so.
  it('refuses when the linked application was withdrawn by the candidate, with the withdrawal message', async () => {
    await expect(
      assertApplicationNotRejected(client({ applicationId: APP }, ['withdrawn']) as never, ORG, OFFER, 'no'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: WITHDRAWN_APPLICATION_MESSAGE });
  });

  it('refuses an unlinked offer when every application is closed and one was withdrawn; allows one still open', async () => {
    await expect(
      assertApplicationNotRejected(client({ applicationId: null }, ['rejected', 'withdrawn']) as never, ORG, OFFER, 'no'),
    ).rejects.toMatchObject({ message: WITHDRAWN_APPLICATION_MESSAGE });
    await expect(
      assertApplicationNotRejected(client({ applicationId: null }, ['withdrawn', 'active']) as never, ORG, OFFER, 'no'),
    ).resolves.toBeUndefined();
  });

  it('closedApplicationReason: null while open or absent, withdrawn over rejected when all are closed', () => {
    expect(closedApplicationReason([])).toBeNull();
    expect(closedApplicationReason(['active'])).toBeNull();
    expect(closedApplicationReason(['hired'])).toBeNull();
    expect(closedApplicationReason(['rejected', 'active'])).toBeNull();
    expect(closedApplicationReason(['rejected'])).toBe('rejected');
    expect(closedApplicationReason(['withdrawn'])).toBe('withdrawn');
    expect(closedApplicationReason(['rejected', 'withdrawn'])).toBe('withdrawn');
  });
});

describe('lockAndAssertApplicationNotRejected', () => {
  const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

  it('refuses a withdrawn application under the lock, with the withdrawal message', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ status: 'withdrawn' }]) };
    await expect(
      lockAndAssertApplicationNotRejected(
        tx as never,
        ORG,
        { applicationId: APP, candidateId: CAND, vacancyId: VAC },
        'no',
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: WITHDRAWN_APPLICATION_MESSAGE });
  });

  it('locks the linked application FOR SHARE (tenant-scoped) and refuses when it is rejected', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ status: 'rejected' }]) };
    await expect(
      lockAndAssertApplicationNotRejected(
        tx as never,
        ORG,
        { applicationId: APP, candidateId: CAND, vacancyId: VAC },
        'no',
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'no' });
    const call = tx.$queryRaw.mock.calls[0]!;
    expect(sqlOf(call)).toMatch(/FROM applications[\s\S]*organization_id[\s\S]*FOR SHARE/);
    expect(call.slice(1)).toEqual([APP, ORG]);
  });

  it('locks the candidate+vacancy applications FOR SHARE for an unlinked offer', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ status: 'rejected' }, { status: 'active' }]) };
    await expect(
      lockAndAssertApplicationNotRejected(
        tx as never,
        ORG,
        { applicationId: null, candidateId: CAND, vacancyId: VAC },
        'no',
      ),
    ).resolves.toBeUndefined();
    const call = tx.$queryRaw.mock.calls[0]!;
    expect(sqlOf(call)).toMatch(/candidate_id[\s\S]*vacancy_id[\s\S]*FOR SHARE/);
    expect(call.slice(1)).toEqual([ORG, CAND, VAC]);
  });

  it('allows when no application exists or one is still open', async () => {
    for (const rows of [[], [{ status: 'active' }], [{ status: 'hired' }]]) {
      const tx = { $queryRaw: vi.fn().mockResolvedValue(rows) };
      await expect(
        lockAndAssertApplicationNotRejected(
          tx as never,
          ORG,
          { applicationId: APP, candidateId: CAND, vacancyId: VAC },
          'no',
        ),
      ).resolves.toBeUndefined();
    }
  });
});
