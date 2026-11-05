import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  can: { fn: ((_module: string, _action?: string) => true) as (module: string, action?: string) => boolean },
  interviews: { isLoading: false, isError: false, data: { items: [] as unknown[] } } as Record<string, unknown>,
  offers: { isLoading: false, isError: false, data: { items: [] as unknown[] } } as Record<string, unknown>,
  stages: { isError: false, data: [] as unknown[] } as Record<string, unknown>,
  history: { data: [] as unknown[] } as Record<string, unknown>,
  moveAsync: vi.fn(),
  invalidate: vi.fn(async () => undefined),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));
vi.mock('../../apps/web/lib/permissions', () => ({ useCan: () => m.can.fn }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      candidate: { getById: { invalidate: m.invalidate }, getTimeline: { invalidate: m.invalidate } },
      pipeline: { getBoard: { invalidate: m.invalidate }, getMovementHistory: { invalidate: m.invalidate } },
    }),
    interview: { list: { useQuery: () => m.interviews } },
    offer: { list: { useQuery: () => m.offers } },
    pipeline: {
      listStages: { useQuery: () => m.stages },
      getMovementHistory: { useQuery: () => m.history },
      moveCandidate: { useMutation: () => ({ mutateAsync: m.moveAsync, isPending: false }) },
    },
  },
}));

import { ApplicationsCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/profile-tab';
import { CandidateInterviewsTab } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-interviews-tab';
import { CandidateOffersCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-offers-card';
import { CandidateStageModal } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-stage-modal';
import { StageTimeline } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/stage-timeline';
import type { CandidateDetail } from '../../apps/web/lib/trpc-types';

const c = es.candidates;
const VACANCY = { id: 'v1', title: 'Analista', status: 'published', salary: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.can.fn = () => true;
});

describe('A-05 the rejection stays visible on the 360', () => {
  it('shows when, by whom, why and the internal note', () => {
    const applications = [
      {
        id: 'a1',
        status: 'rejected',
        source: 'portal',
        appliedAt: '2026-11-01T15:00:00.000Z',
        rejectedAt: '2026-11-05T15:00:00.000Z',
        rejectedReason: 'SALARY_MISMATCH: Expectativa salarial fuera de rango',
        feedback: 'Pide 30% más',
        rejectedBy: 'Laura Quesada',
        vacancy: VACANCY,
        currentStage: { id: 's1', name: 'Preselección', order: 1 },
      },
    ] as unknown as CandidateDetail['applications'];
    render(<ApplicationsCard applications={applications} />);
    expect(screen.getByText(c.appStatusRejected)).toBeTruthy();
    expect(screen.getByText(/^Rechazada el .* por Laura Quesada$/)).toBeTruthy();
    expect(screen.getByText(c.rejectionReason.replace('{reason}', es.rejectCandidateModal.reasons.SALARY_MISMATCH))).toBeTruthy();
    expect(screen.getByText(c.rejectionNote.replace('{note}', 'Pide 30% más'))).toBeTruthy();
  });
});

describe('A-15 interviews tab and offers card', () => {
  it('lists the interviews with status, panel and scorecards, linking to the room', () => {
    m.interviews = {
      isLoading: false,
      isError: false,
      data: {
        items: [
          {
            id: 'iv1',
            type: 'onsite',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
            duration: 60,
            vacancy: { id: 'v1', title: 'Analista' },
            evaluators: [{ user: { id: 'u1', firstName: 'Eva', lastName: 'Rojas' } }, { user: { id: 'u2', firstName: 'Leo', lastName: 'Mora' } }],
            _count: { scorecards: 1 },
          },
        ],
      },
    };
    const onSchedule = vi.fn();
    render(<CandidateInterviewsTab candidateId="c1" onSchedule={onSchedule} />);
    expect(screen.getByText(es.interviews.statusScheduled)).toBeTruthy();
    expect(screen.getByText(c.interviewsEvaluators.replace('{names}', 'Eva Rojas, Leo Mora'))).toBeTruthy();
    expect(screen.getByText(c.interviewsScorecards.replace('{submitted}', '1').replace('{total}', '2'))).toBeTruthy();
    expect(screen.getByRole('link', { name: c.interviewsOpenRoom }).getAttribute('href')).toBe('/recruitment/interviews/iv1/room');
    fireEvent.click(screen.getByRole('button', { name: c.scheduleInterview }));
    expect(onSchedule).toHaveBeenCalled();
  });

  it('says so when there are no interviews', () => {
    m.interviews = { isLoading: false, isError: false, data: { items: [] } };
    render(<CandidateInterviewsTab candidateId="c1" />);
    expect(screen.getByText(c.interviewsEmpty)).toBeTruthy();
  });

  it('lists offers with their status, each opening that offer', () => {
    m.offers = {
      isLoading: false,
      isError: false,
      data: { items: [{ id: 'of1', status: 'pending_approval', createdAt: '2026-11-04T15:00:00.000Z', vacancy: { id: 'v1', title: 'Analista' } }] },
    };
    render(<CandidateOffersCard candidateId="c1" />);
    expect(screen.getByText(es.offers.statusPending)).toBeTruthy();
    expect(screen.getByRole('link', { name: c.offersOpen }).getAttribute('href')).toBe('/recruitment/offers?offer=of1');
  });

  it('says the offers could not be loaded instead of "no offers" when the read fails (Codex P2)', () => {
    m.offers = { isLoading: false, isError: true, error: new Error('down'), refetch: vi.fn(), data: undefined };
    render(<CandidateOffersCard candidateId="c1" />);
    expect(screen.getByText(c.offersLoadError)).toBeTruthy();
    expect(screen.queryByText(c.offersEmpty)).toBeNull();
  });

  it('is hidden for a viewer without offer:read', () => {
    m.can.fn = (module) => module !== 'offer';
    const { container } = render(<CandidateOffersCard candidateId="c1" />);
    expect(container.textContent).toBe('');
  });
});

describe('A-03 the process card uses the vacancy real stages', () => {
  it('shows the real stage names and marks the current one, without invented steps', () => {
    m.stages = {
      isError: false,
      data: [
        { id: 's0', name: 'Aplicado', order: 0 },
        { id: 's1', name: 'Screening', order: 1 },
        { id: 's2', name: 'Prueba Tecnica', order: 2 },
      ],
    };
    m.history = { data: [{ movedAt: '2026-11-03T10:00:00.000Z', fromStage: { id: 's0' }, toStage: { id: 's2' } }] };
    render(
      <StageTimeline
        applications={[
          {
            id: 'a1',
            status: 'active',
            source: 'portal',
            appliedAt: '2026-11-01T15:00:00.000Z',
            vacancy: { id: 'v1', title: 'Analista', status: 'published' },
            currentStage: { id: 's2', name: 'Prueba Tecnica', order: 2 },
          },
        ]}
      />,
    );
    for (const name of ['Aplicado', 'Screening', 'Prueba Tecnica']) expect(screen.getByText(name)).toBeTruthy();
    for (const fake of ['Postulada', 'Evaluaciones', 'Contratación', ' (actual)']) expect(screen.queryByText(fake)).toBeNull();
    expect(screen.getByText(/^Etapa actual · desde /)).toBeTruthy();
    expect(screen.getByText(c.stageNotReached)).toBeTruthy();
    expect(screen.queryByText(/via portal/)).toBeNull();
  });
});

describe('A-03 without the movement history nothing is guessed (Codex P2)', () => {
  it('shows only the current stage and says the history could not be loaded', () => {
    m.stages = { isError: false, data: [{ id: 's0', name: 'Aplicado', order: 0 }, { id: 's1', name: 'Screening', order: 1 }] };
    m.history = { isError: true, data: undefined };
    render(
      <StageTimeline
        applications={[
          {
            id: 'a1',
            status: 'active',
            source: 'portal',
            appliedAt: '2026-11-01T15:00:00.000Z',
            vacancy: { id: 'v1', title: 'Analista', status: 'published' },
            currentStage: { id: 's1', name: 'Screening', order: 1 },
          },
        ]}
      />,
    );
    expect(screen.getByText(c.historyLoadError)).toBeTruthy();
    expect(screen.queryByText(c.stageNotReached)).toBeNull();
    expect(screen.queryByText(/^Etapa actual · desde /)).toBeNull();
    m.history = { data: [] };
  });
});

describe('A-13 moving from the 360 gives the board feedback', () => {
  it('toasts the move with the next step for an interview stage', async () => {
    m.stages = { isError: false, isLoading: false, data: [{ id: 's1', name: 'Preselección', order: 1 }, { id: 's2', name: 'Entrevista final', order: 2 }] };
    m.moveAsync.mockResolvedValue({ id: 'a1', warnings: ['Revisar títulos'] });
    const onClose = vi.fn();
    const applications = [
      { id: 'a1', status: 'active', source: 'portal', appliedAt: '2026-11-01', vacancy: VACANCY, currentStage: { id: 's1', name: 'Preselección', order: 1 } },
    ] as unknown as CandidateDetail['applications'];
    render(<CandidateStageModal candidateId="c1" applications={applications} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(es.pipeline.moveToStage), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: c.moveStage }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Revisar títulos'), { type: 'warning' });
    expect(m.toast).toHaveBeenCalledWith(es.pipeline.moved, {
      type: 'success',
      action: { label: es.pipeline.nextAction.entrevistas, href: '/recruitment/candidates/c1?schedule=a1' },
    });
  });
});
