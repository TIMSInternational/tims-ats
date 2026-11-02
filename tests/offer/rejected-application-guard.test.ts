import { describe, expect, it, vi } from 'vitest';
import {
  assertApplicationNotRejected,
  notRejectedApplication,
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
    expect(notRejectedApplication(VAC)).toEqual({
      OR: [
        { applicationId: { not: null }, application: { status: { not: 'rejected' } } },
        { applicationId: null, candidate: { applications: { none: { vacancyId: VAC } } } },
        { applicationId: null, candidate: { applications: { some: { vacancyId: VAC, status: { not: 'rejected' } } } } },
      ],
    });
  });
});
