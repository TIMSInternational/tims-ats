import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot UX audit B-18 / E-23: the "Oferta aceptada / declinada" staff email reaches HR, the offer's recruiter
// and the hiring manager, links to the offer, and dates the answer in the organization's time zone.

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  offer: { findFirst: vi.fn() },
  organization: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
}));
const email = vi.hoisted(() => ({ notifyOfferAccepted: vi.fn(), notifyOfferDeclined: vi.fn() }));

vi.mock('@tims/db', () => ({ tenantDb: db, runWithTenant: (_org: string, fn: () => unknown) => fn() }));
vi.mock('../../packages/api/src/services/email.service', () => ({ emailService: email }));

import {
  buildOfferResponseNotice,
  sendOfferResponseNotice,
  uniqueEmails,
} from '../../packages/api/src/services/offer-response-notice.service';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  db.offer.findFirst.mockResolvedValue({
    createdById: 'recruiter-1',
    candidate: { firstName: 'Ana', lastName: 'Mora' },
    vacancy: { title: 'Analista', assignedTo: 'leader-1', company: { timezone: 'America/Bogota' } },
  });
  db.organization.findFirst.mockResolvedValue({ name: 'Empresa', settings: { timezone: 'America/Costa_Rica' } });
  db.user.findMany.mockResolvedValue([
    { email: 'RRHH@empresa.test' },
    { email: 'rrhh@empresa.test' },
    { email: 'reclutadora@empresa.test' },
  ]);
  email.notifyOfferAccepted.mockResolvedValue(true);
  email.notifyOfferDeclined.mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('offer response notice', () => {
  it('asks for HR/super admins OR the offer creator OR the hiring manager, active and not deleted', async () => {
    await buildOfferResponseNotice(ORG_ID, OFFER_ID);
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        isActive: true,
        deletedAt: null,
        OR: [
          { userRoles: { some: { role: { slug: { in: ['hr_admin', 'super_admin'] } } } } },
          { id: { in: ['recruiter-1', 'leader-1'] } },
        ],
      },
      select: { email: true },
    });
  });

  it('de-duplicates recipients, links to the offer and uses the organization zone (not the company one)', async () => {
    const notice = await buildOfferResponseNotice(ORG_ID, OFFER_ID);
    expect(notice).toEqual({
      hrEmails: ['rrhh@empresa.test', 'reclutadora@empresa.test'],
      recipientName: 'equipo',
      candidateName: 'Ana Mora',
      vacancyTitle: 'Analista',
      companyName: 'Empresa',
      offerUrl: `https://app.example.test/recruitment/offers/${OFFER_ID}`,
      timeZone: 'America/Costa_Rica',
    });
  });

  it('falls back to the company zone, then UTC', async () => {
    db.organization.findFirst.mockResolvedValueOnce({ name: 'Empresa', settings: {} });
    expect((await buildOfferResponseNotice(ORG_ID, OFFER_ID))?.timeZone).toBe('America/Bogota');
    db.organization.findFirst.mockResolvedValueOnce({ name: 'Empresa', settings: {} });
    db.offer.findFirst.mockResolvedValueOnce({
      createdById: 'recruiter-1',
      candidate: { firstName: 'Ana', lastName: 'Mora' },
      vacancy: { title: 'Analista', assignedTo: null, company: null },
    });
    expect((await buildOfferResponseNotice(ORG_ID, OFFER_ID))?.timeZone).toBe('UTC');
  });

  it('sends the accepted / declined email with the answer time; skips when nobody can receive it', async () => {
    const at = new Date('2026-11-04T22:51:00Z');
    await sendOfferResponseNotice(ORG_ID, OFFER_ID, { kind: 'accepted', at });
    expect(email.notifyOfferAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedAt: at, timeZone: 'America/Costa_Rica' }),
    );
    await sendOfferResponseNotice(ORG_ID, OFFER_ID, { kind: 'declined', at });
    expect(email.notifyOfferDeclined).toHaveBeenCalledWith(expect.objectContaining({ declinedAt: at }));

    email.notifyOfferAccepted.mockClear();
    db.user.findMany.mockResolvedValueOnce([]);
    await sendOfferResponseNotice(ORG_ID, OFFER_ID, { kind: 'accepted', at });
    expect(email.notifyOfferAccepted).not.toHaveBeenCalled();
  });

  it('never throws (the candidate already got their answer)', async () => {
    db.offer.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(
      sendOfferResponseNotice(ORG_ID, OFFER_ID, { kind: 'accepted', at: new Date() }),
    ).resolves.toBeUndefined();
  });

  it('uniqueEmails trims, lower-cases and drops empties', () => {
    expect(uniqueEmails([' A@x.test ', 'a@x.test', '', null, undefined, 'b@x.test'])).toEqual(['a@x.test', 'b@x.test']);
  });
});
