import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const { mutate, toastMock, invalidate } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastMock: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ pipeline: { getBoard: { invalidate } }, candidate: { invalidate } }),
    pipeline: { rejectCandidate: { useMutation: () => ({ mutate, isPending: false }) } },
    offer: {
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

import { RejectCandidateModal } from '../../apps/web/app/(admin)/recruitment/pipeline/reject-candidate-modal';
import { RecruitingKpiStrip } from '../../apps/web/app/(admin)/dashboard/recruiting-kpi-strip';
import { CreateOfferModal } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-modal';
import { resolveInitialVacancy } from '../../apps/web/app/(admin)/recruitment/pipeline/pipeline-vacancy-select';
import { summarizeVacancyKpis } from '../../apps/web/app/(admin)/recruitment/vacancies/vacancy-kpis';
import { buildPublicVacancyUrl, resolvePublicOrigin } from '../../apps/web/lib/public-vacancy-url';
import { DEFAULT_TENANT_CURRENCY, defaultOfferCurrency } from '../../apps/web/lib/tenant-locale';
import { REJECTION_REASON_CODES, buildRejectionReason, toRejectCandidateInput } from '../../apps/web/lib/reject-reasons';
import { POPULAR_CURRENCY_CODES, supportedCurrencyCodes } from '@tims/shared';

beforeEach(() => {
  mutate.mockReset();
  toastMock.mockReset();
});

describe('RH-01 reject candidate modal', () => {
  const app = { id: '11111111-1111-4111-8111-111111111111', vacancyTitle: 'Analista' };

  it('requires a structured reason before it will submit', async () => {
    render(<RejectCandidateModal candidateName="Ana Mora" applications={[app]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: es.rejectCandidateModal.continue }));
    expect(await screen.findByText(es.rejectCandidateModal.reasonRequired)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('confirms, then sends "<CODE>: <label>" as reason and the note as feedback', async () => {
    render(<RejectCandidateModal candidateName="Ana Mora" applications={[app]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(new RegExp(es.rejectCandidateModal.reasonLabel)), {
      target: { value: 'SALARY_MISMATCH' },
    });
    fireEvent.change(screen.getByLabelText(es.rejectCandidateModal.noteLabel), { target: { value: '  pide 30% más  ' } });
    fireEvent.click(screen.getByRole('button', { name: es.rejectCandidateModal.continue }));

    // Confirmation step: nothing is sent yet.
    expect(await screen.findByText(es.rejectCandidateModal.confirmTitle)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: es.rejectCandidateModal.confirm }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith({
      applicationId: app.id,
      reason: 'SALARY_MISMATCH: Expectativa salarial fuera de rango',
      feedback: 'pide 30% más',
    });
  });

  it('omits feedback when the note is blank and stays within the server bounds', () => {
    expect(toRejectCandidateInput('a', 'NO_SHOW', 'No se presentó', '   ')).toEqual({
      applicationId: 'a',
      reason: 'NO_SHOW: No se presentó',
    });
    expect(buildRejectionReason('OTHER', 'x'.repeat(900)).length).toBe(500);
    expect(toRejectCandidateInput('a', 'OTHER', 'Otro', 'y'.repeat(2500)).feedback?.length).toBe(2000);
  });

  it('has a Spanish label for every reason code', () => {
    for (const code of REJECTION_REASON_CODES) {
      expect(es.rejectCandidateModal.reasons[code]).toBeTruthy();
    }
    expect(es.rejectCandidateModal.reasons.CANDIDATE_WITHDREW).toBe('El candidato desistió');
  });
});

describe('RH-02 recruiting KPI strip shows only real metrics', () => {
  const vacancyKpis = {
    totalOpen: 7, totalDraft: 3, totalPendingApproval: 2, totalPublished: 5, totalClosed: 4,
    totalApplications: 40, totalSlaOverdue: 6, recentVacancies: [],
  };
  const candidateKpis = { total: 30, newThisMonth: 9, activeApplications: 21, byPool: [] };

  it('renders no invented cards or captions', () => {
    const { container } = render(
      <RecruitingKpiStrip vacancyKpis={vacancyKpis} candidateKpis={candidateKpis} isLoading={false} isError={false} />,
    );
    const text = container.textContent ?? '';
    const rd = es.recruitingDashboard;
    for (const invented of [rd.interviewsToday, rd.toConfirm, rd.pendingOffers, rd.expiresTomorrow,
      rd.abandonmentRisk, rd.highFitStalled, rd.frozen, rd.noActivity, rd.critical, rd.thisWeek, rd.activeTests]) {
      expect(text).not.toContain(invented);
    }
  });

  it('labels each value with what it counts', () => {
    render(<RecruitingKpiStrip vacancyKpis={vacancyKpis} candidateKpis={candidateKpis} isLoading={false} isError={false} />);
    const rd = es.recruitingDashboard;
    expect(screen.getByTestId('kpi-open-vacancies').textContent).toBe(`${rd.openVacancies}72 ${rd.pendingApproval}`);
    expect(screen.getByTestId('kpi-drafts').textContent).toBe(`${rd.drafts}3`);
    expect(screen.getByTestId('kpi-active-candidates').textContent).toBe(`${rd.activeCandidates}30+9 ${rd.thisMonth}`);
    expect(screen.getByTestId('kpi-active-applications').textContent).toContain('21');
    expect(screen.getByTestId('kpi-sla-overdue').textContent).toContain('6');
  });
});

describe('RH-26 vacancy KPI totals', () => {
  it('does not double-count published vacancies (totalOpen already includes them)', () => {
    expect(summarizeVacancyKpis({ totalOpen: 5, totalDraft: 2, totalPendingApproval: 1, totalPublished: 4, totalClosed: 2 }))
      .toEqual({ total: 10, fillRatePct: 20 });
    expect(summarizeVacancyKpis({ totalOpen: 0, totalDraft: 0, totalPendingApproval: 0, totalPublished: 0, totalClosed: 0 }))
      .toEqual({ total: 0, fillRatePct: 0 });
  });
});

describe('RH-11 pipeline ?vacancy= selection', () => {
  const list = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }];
  const loading = { status: 'loading' } as const;
  const unavailable = { status: 'unavailable' } as const;
  it('selects the requested vacancy when it is in the list', () => {
    expect(resolveInitialVacancy(list, 'v2', unavailable)).toEqual({ id: 'v2', notice: false });
  });
  it('waits for the lookup, then selects a requested vacancy found outside the list', () => {
    expect(resolveInitialVacancy(list, 'v9', loading)).toBeNull();
    const found = { status: 'found', vacancy: { id: 'v9', title: 'Antigua' } } as const;
    expect(resolveInitialVacancy(list, 'v9', found)).toEqual({ id: 'v9', notice: false });
  });
  it('falls back to the first vacancy with a notice only when the requested one is unavailable', () => {
    expect(resolveInitialVacancy(list, null, unavailable)).toEqual({ id: 'v1', notice: false });
    expect(resolveInitialVacancy(list, 'nope', unavailable)).toEqual({ id: 'v1', notice: true });
    expect(resolveInitialVacancy([], null, unavailable)).toBeNull();
    expect(resolveInitialVacancy([], 'v2', unavailable)).toEqual({ id: null, notice: true });
  });
});

describe('RH-10 public vacancy URL', () => {
  it('builds /careers/<orgSlug>/<vacancyId> on the given origin', () => {
    expect(buildPublicVacancyUrl('https://app.example.test/', 'invu', 'abc')).toBe('https://app.example.test/careers/invu/abc');
    expect(buildPublicVacancyUrl('https://app.example.test', 'a b', 'x/y')).toBe('https://app.example.test/careers/a%20b/x%2Fy');
  });
  it('prefers the configured app URL, else the browser origin', () => {
    expect(resolvePublicOrigin('https://cfg.example.test', 'http://localhost:3000')).toBe('https://cfg.example.test');
    expect(resolvePublicOrigin('  ', 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolvePublicOrigin(undefined, 'http://localhost:3000')).toBe('http://localhost:3000');
  });
});

describe('CRC currency defaults', () => {
  it('lists CRC as a popular currency and defaults the tenant to CRC', () => {
    expect(DEFAULT_TENANT_CURRENCY).toBe('CRC');
    expect(POPULAR_CURRENCY_CODES).toContain('CRC');
    expect(supportedCurrencyCodes()[0]).toBe('CRC');
  });
  it('defaults the offer currency to the vacancy currency, else CRC', () => {
    expect(defaultOfferCurrency('usd')).toBe('USD');
    expect(defaultOfferCurrency(null)).toBe('CRC');
    expect(defaultOfferCurrency('')).toBe('CRC');
  });
  it('offer modal offers the full currency list and selects CRC for a vacancy without salary', () => {
    const application = {
      id: 'app-1', status: 'active', appliedAt: new Date(), currentStage: null,
      vacancy: { id: 'vac-1', title: 'Analista', salary: null },
    };
    render(
      <CreateOfferModal
        candidateId="cand-1"
        applications={[application] as unknown as Parameters<typeof CreateOfferModal>[0]['applications']}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(es.offers.currency) as HTMLSelectElement;
    expect(select.value).toBe('CRC');
    const codes = Array.from(select.options).map((o) => o.value);
    expect(codes).toEqual(expect.arrayContaining(['CRC', 'COP', 'USD', 'EUR', 'GTQ', 'PAB']));
    expect(codes.length).toBeGreaterThan(20);
  });
});
