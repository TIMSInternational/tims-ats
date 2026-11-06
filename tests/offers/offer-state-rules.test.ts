import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  displayOfferStatus,
  isOfferLinkExpired,
  isOpenOffer,
  isWithdrawableOffer,
  OPEN_OFFER_STATUSES,
} from '@tims/shared';
import { OFFER_FILTER_STATUSES, offerDisplayLabel, offerStatusLabel } from '../../apps/web/lib/offer-status';
import {
  offerDetailModel,
  type OfferDetailInput,
} from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-detail-model';
import { computeOfferKpis } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-kpi-data';
import { buildOfferTimeline } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-timeline-entries';
import { openOfferWhere } from '../../packages/api/src/routers/offer/open-offer-guard';

const NOW = new Date('2026-11-04T18:00:00Z');
const PAST = '2026-11-01T00:00:00Z';
const FUTURE = '2026-11-20T00:00:00Z';

describe('offer status labels (B-02 / B-03)', () => {
  it('labels every status, including rejected and converted, in both languages (never a raw slug)', () => {
    for (const status of [...OFFER_FILTER_STATUSES, 'expired']) {
      for (const labels of [es.offers, en.offers]) {
        const label = offerStatusLabel(status, labels);
        expect(label).toBeTruthy();
        expect(label).not.toBe(status);
      }
    }
    expect(offerStatusLabel('rejected', es.offers)).toBe('Rechazada por aprobador');
    expect(offerStatusLabel('converted', es.offers)).toBe('Contratación registrada');
    expect(offerStatusLabel('declined', es.offers)).toBe('Declinada por el candidato');
    expect(offerStatusLabel('some_new_state', es.offers)).toBe('some new state');
  });

  it('reads a sent offer past its expiry as expired', () => {
    expect(offerDisplayLabel({ status: 'sent', expiresAt: PAST }, es.offers, NOW)).toBe(es.offers.statusExpired);
    expect(offerDisplayLabel({ status: 'sent', expiresAt: FUTURE }, es.offers, NOW)).toBe(es.offers.statusSent);
    expect(offerDisplayLabel({ status: 'sent', expiresAt: null }, es.offers, NOW)).toBe(es.offers.statusSent);
  });
});

describe('open / withdrawable offers (B-04)', () => {
  it('an offer is open from draft to converted, unless its sent link expired', () => {
    for (const status of OPEN_OFFER_STATUSES) expect(isOpenOffer({ status }, NOW)).toBe(true);
    for (const status of ['rejected', 'declined', 'withdrawn']) expect(isOpenOffer({ status }, NOW)).toBe(false);
    expect(isOpenOffer({ status: 'sent', expiresAt: PAST }, NOW)).toBe(false);
    expect(isOfferLinkExpired({ status: 'accepted', expiresAt: PAST }, NOW)).toBe(false);
    expect(displayOfferStatus({ status: 'accepted', expiresAt: PAST }, NOW)).toBe('accepted');
  });

  it('only draft, pending, approved and sent offers can be withdrawn', () => {
    expect(['draft', 'pending_approval', 'approved', 'sent'].every((status) => isWithdrawableOffer({ status }))).toBe(
      true,
    );
    expect(
      ['accepted', 'converted', 'rejected', 'declined', 'withdrawn'].some((status) => isWithdrawableOffer({ status })),
    ).toBe(false);
  });

  it('the server filter keeps a sent offer without expiry open (no SQL NULL trap)', () => {
    const where = openOfferWhere('org', 'cand', 'vac', NOW);
    expect(where.OR).toEqual([
      { status: { in: ['draft', 'pending_approval', 'approved', 'accepted', 'converted'] } },
      { status: 'sent', OR: [{ expiresAt: null }, { expiresAt: { gte: NOW } }] },
    ]);
  });
});

describe('offer detail model', () => {
  const reasons = {
    sendForSignatureNeedsApproval: 'NEEDS_APPROVAL',
    sendForSignatureResendRestricted: 'RESEND_RESTRICTED',
    hireBlockedValidations: 'VALIDATIONS',
    hireBlockedLegal: 'LEGAL',
    hireBlockedVacancyFilled: 'FILLED',
  };
  const base: OfferDetailInput = {
    status: 'draft',
    validationsTotal: 0,
    legalChecksTotal: 0,
    blockingValidationOpen: false,
    legalCheckOpen: false,
    vacancyHires: 0,
    vacancyPositions: 1,
    applicationStatus: 'active',
  };
  const recruiter = { canCreate: true, canUpdate: false, canApprove: false };
  const hrAdmin = { canCreate: true, canUpdate: true, canApprove: true };
  const leader = { canCreate: false, canUpdate: false, canApprove: true };

  it('"Enviar para Firma": hidden for a leader, disabled with a reason before approval (B-17)', () => {
    expect(offerDetailModel(base, leader, reasons, NOW).sendForSigning.visible).toBe(false);
    expect(offerDetailModel(base, recruiter, reasons, NOW).sendForSigning).toEqual({
      visible: true,
      enabled: false,
      reason: 'NEEDS_APPROVAL',
    });
    expect(offerDetailModel({ ...base, status: 'approved' }, recruiter, reasons, NOW).sendForSigning.enabled).toBe(
      true,
    );
    expect(offerDetailModel({ ...base, status: 'sent' }, recruiter, reasons, NOW).sendForSigning).toEqual({
      visible: true,
      enabled: false,
      reason: 'RESEND_RESTRICTED',
    });
    expect(offerDetailModel({ ...base, status: 'sent' }, hrAdmin, reasons, NOW).sendForSigning.enabled).toBe(true);
    expect(
      offerDetailModel({ ...base, status: 'sent', expiresAt: PAST }, hrAdmin, reasons, NOW).sendForSigning.visible,
    ).toBe(false);
    expect(offerDetailModel({ ...base, status: 'accepted' }, hrAdmin, reasons, NOW).sendForSigning.visible).toBe(false);
  });

  it('"Autorizar contratación" explains a filled vacancy before a click (F-15)', () => {
    const accepted = { ...base, status: 'accepted' };
    expect(offerDetailModel(accepted, hrAdmin, reasons, NOW).hire).toEqual({
      visible: true,
      enabled: true,
      reason: undefined,
    });
    expect(offerDetailModel({ ...accepted, vacancyHires: 1 }, hrAdmin, reasons, NOW).hire).toEqual({
      visible: true,
      enabled: false,
      reason: 'FILLED',
    });
    expect(
      offerDetailModel({ ...accepted, vacancyHires: 1, vacancyPositions: 2 }, hrAdmin, reasons, NOW).hire.enabled,
    ).toBe(true);
    expect(offerDetailModel({ ...accepted, legalCheckOpen: true }, hrAdmin, reasons, NOW).hire.reason).toBe('LEGAL');
    expect(offerDetailModel(accepted, recruiter, reasons, NOW).hire.visible).toBe(false);
  });

  it('edit only drafts; withdraw from draft to sent; "Crear nueva oferta" after an end (B-02 / B-04)', () => {
    expect(offerDetailModel(base, recruiter, reasons, NOW)).toMatchObject({
      canEdit: true,
      canWithdraw: true,
      canCreateNew: false,
    });
    expect(offerDetailModel({ ...base, status: 'approved' }, recruiter, reasons, NOW)).toMatchObject({
      canEdit: false,
      canWithdraw: true,
    });
    expect(offerDetailModel(base, leader, reasons, NOW)).toMatchObject({ canEdit: false, canWithdraw: false });
    for (const status of ['rejected', 'declined', 'withdrawn']) {
      expect(offerDetailModel({ ...base, status }, recruiter, reasons, NOW)).toMatchObject({
        canCreateNew: true,
        canWithdraw: false,
      });
    }
    expect(offerDetailModel({ ...base, status: 'sent', expiresAt: PAST }, recruiter, reasons, NOW).canCreateNew).toBe(
      true,
    );
    expect(
      offerDetailModel({ ...base, status: 'rejected', applicationStatus: 'rejected' }, recruiter, reasons, NOW)
        .canCreateNew,
    ).toBe(false);
  });

  it('hides the pre-employment ring and column when the offer has no checks (B-20)', () => {
    expect(offerDetailModel(base, recruiter, reasons, NOW).showValidations).toBe(false);
    expect(offerDetailModel({ ...base, legalChecksTotal: 2 }, recruiter, reasons, NOW).showValidations).toBe(true);
  });
});

describe('offer KPIs count a recorded hire as accepted (B-03)', () => {
  it('one converted and one declined offer is a 50% acceptance rate, and the hire feeds the average salary', () => {
    const kpis = computeOfferKpis(
      [
        { status: 'converted', salary: 120, currency: 'CRC' },
        { status: 'declined', salary: 999, currency: 'CRC' },
      ],
      2,
    );
    expect(kpis).toMatchObject({ acceptanceRate: 50, avgSalary: 120, avgSalaryCurrency: 'CRC', activeCount: 0 });
  });

  it('an expired sent offer is resolved, not active', () => {
    const kpis = computeOfferKpis(
      [{ status: 'sent', salary: 1, currency: 'CRC', expiresAt: '2000-01-01T00:00:00Z' }],
      1,
    );
    expect(kpis).toMatchObject({ activeCount: 0, acceptanceRate: 0 });
  });
});

describe('offer history (B-19 / F-14)', () => {
  const person = (firstName: string) => ({ firstName, lastName: 'X' });
  const offer = {
    status: 'converted',
    createdAt: '2026-11-01T10:00:00Z',
    sentAt: '2026-11-02T10:00:00Z',
    respondedAt: '2026-11-03T10:00:00Z',
    creator: person('Rita'),
    approvals: [
      { status: 'cancelled', createdAt: '2026-11-01T11:00:00Z', decidedAt: null, approver: person('Ana') },
      {
        status: 'approved',
        createdAt: '2026-11-01T12:00:00Z',
        decidedAt: '2026-11-01T13:00:00Z',
        comment: 'Ok',
        approver: person('Leo'),
      },
    ],
    hirePrediction: { createdAt: '2026-11-04T10:00:00Z', hiredBy: person('Hugo') },
  };

  it('keeps the acceptance after the hire, dated by respondedAt, and names who recorded the hire', () => {
    const entries = buildOfferTimeline(offer, es.offers, NOW);
    expect(entries.map((entry) => entry.title)).toEqual([
      'Contratación registrada por Hugo X',
      'Oferta aceptada por el candidato',
      'Oferta enviada al candidato',
      'Aprobada por Leo X',
      'Aprobación solicitada a Leo X',
      'Aprobación solicitada a Ana X',
      'Oferta creada por Rita X',
    ]);
    expect(entries[1]!.at).toBe(offer.respondedAt);
    expect(entries[3]!.detail).toBe('Comentario: Ok');
  });

  it("shows an approver's rejection with its reason, and a withdrawal with who and why", () => {
    const rejected = buildOfferTimeline(
      {
        ...offer,
        status: 'rejected',
        sentAt: null,
        respondedAt: null,
        hirePrediction: null,
        approvals: [
          {
            status: 'rejected',
            createdAt: '2026-11-01T12:00:00Z',
            decidedAt: '2026-11-01T13:00:00Z',
            comment: 'Salario alto',
            approver: person('Leo'),
          },
        ],
      },
      es.offers,
      NOW,
    );
    expect(rejected[0]).toMatchObject({ title: 'Rechazada por Leo X', detail: 'Motivo: Salario alto', tone: 'danger' });

    const withdrawn = buildOfferTimeline(
      {
        ...offer,
        status: 'withdrawn',
        respondedAt: null,
        hirePrediction: null,
        approvals: [],
        settings: { withdrawnAt: '2026-11-03T09:00:00Z', withdrawnByName: 'Rita X', withdrawnReason: 'Error' },
      },
      es.offers,
      NOW,
    );
    expect(withdrawn[0]).toMatchObject({ title: 'Oferta retirada por Rita X', detail: 'Motivo: Error' });
  });
});
