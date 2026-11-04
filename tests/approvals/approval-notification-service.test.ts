import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot UX audit B-01: every approver is emailed when a vacancy or offer is submitted for approval.
// The service runs after the response (runAfterResponse), so it must never throw and must log no PII.

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ITEM_ID = '99999999-9999-4999-8999-999999999999';
const REQUESTER = '33333333-3333-4333-8333-333333333333';
const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  findVacancyRequest: vi.fn(),
  findOfferRequest: vi.fn(),
  tenantOrgs: [] as Array<string | null>,
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  runWithTenant: (orgId: string | null, fn: () => unknown) => {
    mocks.tenantOrgs.push(orgId);
    return fn();
  },
}));
vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tims/shared')>()),
  getAppUrl: () => 'https://app.example.test/',
  logger: { warn: mocks.warn, error: mocks.error, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('../../packages/api/src/repositories/approval-notification.repository', () => ({
  approvalNotificationRepository: {
    findVacancyRequest: mocks.findVacancyRequest,
    findOfferRequest: mocks.findOfferRequest,
  },
}));

import {
  approvalNotificationService,
  approvalReviewUrl,
} from '../../packages/api/src/services/approval-notification.service';
import { offerLinkPath } from '../../apps/web/lib/offer-deep-link';

const CONTEXT = {
  companyName: 'Empresa Piloto',
  requesterName: 'Rita Reclutadora',
  vacancyTitle: 'Analista de Datos',
  candidateName: null,
  approvers: [
    { id: ANA, email: 'ana@example.test', firstName: 'Ana', locale: 'es' },
    { id: BEN, email: 'ben@example.test', firstName: 'Ben', locale: 'en' },
  ],
};

beforeEach(() => {
  mocks.sendEmail.mockReset().mockResolvedValue(true);
  mocks.findVacancyRequest.mockReset().mockResolvedValue(CONTEXT);
  mocks.findOfferRequest.mockReset().mockResolvedValue({ ...CONTEXT, candidateName: 'María Pérez' });
  mocks.tenantOrgs.length = 0;
  mocks.warn.mockReset();
  mocks.error.mockReset();
});

describe('approvalNotificationService.notifyApprovalRequested', () => {
  it('emails each approver once, in their own locale, with a link to the vacancy', async () => {
    await approvalNotificationService.notifyApprovalRequested({
      orgId: ORG_ID,
      kind: 'vacancy',
      entityId: ITEM_ID,
      approverIds: [ANA, BEN, ANA, REQUESTER],
      requesterId: REQUESTER,
    });

    // Duplicates collapsed and the submitter never emails themselves; the read runs in the tenant scope.
    expect(mocks.findVacancyRequest).toHaveBeenCalledWith(ORG_ID, ITEM_ID, [ANA, BEN], REQUESTER);
    expect(mocks.tenantOrgs).toEqual([ORG_ID]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    const [ana, ben] = mocks.sendEmail.mock.calls.map((c) => c[0]);
    expect(ana.to).toBe('ana@example.test');
    expect(ana.subject).toMatch(/^Aprobación pendiente/);
    expect(ana.html).toContain(`href="https://app.example.test/recruitment/vacancies/${ITEM_ID}"`);
    expect(ana.abortSignal).toBeInstanceOf(AbortSignal);
    expect(ben.to).toBe('ben@example.test');
    expect(ben.subject).toMatch(/^Approval needed/);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('links an offer approver to that offer by its path (survives the sign-in redirect)', async () => {
    await approvalNotificationService.notifyApprovalRequested({
      orgId: ORG_ID,
      kind: 'offer',
      entityId: ITEM_ID,
      approverIds: [ANA],
      requesterId: REQUESTER,
    });
    expect(mocks.findOfferRequest).toHaveBeenCalledWith(ORG_ID, ITEM_ID, [ANA], REQUESTER);
    expect(mocks.findVacancyRequest).not.toHaveBeenCalled();
    const html = mocks.sendEmail.mock.calls[0]![0].html as string;
    expect(html).toContain(`href="https://app.example.test/recruitment/offers/${ITEM_ID}"`);
    expect(html).toContain('María Pérez');
  });

  it('does nothing when the only approver is the submitter', async () => {
    await approvalNotificationService.notifyApprovalRequested({
      orgId: ORG_ID,
      kind: 'vacancy',
      entityId: ITEM_ID,
      approverIds: [REQUESTER],
      requesterId: REQUESTER,
    });
    expect(mocks.findVacancyRequest).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('skips quietly (with a warning) when the item is gone', async () => {
    mocks.findVacancyRequest.mockResolvedValue(null);
    await approvalNotificationService.notifyApprovalRequested({
      orgId: ORG_ID,
      kind: 'vacancy',
      entityId: ITEM_ID,
      approverIds: [ANA],
      requesterId: REQUESTER,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it('never throws: a failed read is logged without PII', async () => {
    mocks.findVacancyRequest.mockRejectedValue(new Error('connection reset for ana@example.test'));
    await expect(
      approvalNotificationService.notifyApprovalRequested({
        orgId: ORG_ID,
        kind: 'vacancy',
        entityId: ITEM_ID,
        approverIds: [ANA],
        requesterId: REQUESTER,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.error.mock.calls[0])).not.toContain('ana@example.test');
  });

  it('reports partial delivery: one failed send and one approver with no active account', async () => {
    mocks.sendEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await approvalNotificationService.notifyApprovalRequested({
      orgId: ORG_ID,
      kind: 'vacancy',
      entityId: ITEM_ID,
      approverIds: [ANA, BEN, '44444444-4444-4444-8444-444444444444'],
      requesterId: REQUESTER,
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, sent: 1, approvers: 3 }),
      expect.any(String),
    );
    expect(JSON.stringify(mocks.warn.mock.calls[0])).not.toMatch(/@example\.test/);
  });
});

describe('approvalReviewUrl', () => {
  it('builds the deep link on the app origin without a double slash', () => {
    expect(approvalReviewUrl('https://app.example.test/', 'vacancy', 'v1')).toBe(
      'https://app.example.test/recruitment/vacancies/v1',
    );
    expect(approvalReviewUrl('https://app.example.test', 'offer', 'o 1')).toBe(
      'https://app.example.test/recruitment/offers/o%201',
    );
  });

  it('builds the same offer path as the web route that opens it (apps/web offerLinkPath)', () => {
    const url = new URL(approvalReviewUrl('https://app.example.test', 'offer', ITEM_ID));
    expect(url.pathname).toBe(offerLinkPath(ITEM_ID));
    expect(url.search).toBe('');
  });
});
