import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import type { InterviewListItem } from '../../apps/web/lib/trpc-types';

// Pilot UX re-audit recruiter-journeys-28: interview.reschedule finally has a web caller. "Reprogramar" on an
// open, unscored row opens a dialog whose typed time means the organization's zone; a scored interview's
// CONFLICT is explained ("programa una entrevista nueva"); the server re-sends the invitations.

const mutate = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => ({ onSuccess: undefined as undefined | (() => void), onError: undefined as undefined | ((e: unknown) => void) }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    interview: {
      list: {
        useQuery: () => ({ data: { schedulingTimeZone: { timeZone: 'America/Costa_Rica' } }, isError: false }),
      },
      reschedule: {
        useMutation: (opts: { onSuccess: () => void; onError: (e: unknown) => void }) => {
          handlers.onSuccess = opts.onSuccess;
          handlers.onError = opts.onError;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../../apps/web/components', () => ({
  DataTable: ({ children }: { children: ReactNode }) => (
    <table>
      <tbody>{children}</tbody>
    </table>
  ),
  EmptyState: () => null,
  ErrorState: () => null,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  CandidateAvatar: () => null,
  UpsellNotice: () => null,
  Modal: ({ title, children }: { title: string; children: ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

import { InterviewTable } from '../../apps/web/app/(admin)/recruitment/interviews/interview-table';
import { RescheduleInterviewDialog } from '../../apps/web/app/(admin)/recruitment/interviews/reschedule-interview-dialog';
import {
  canRescheduleInterview,
  rescheduleErrorMessage,
  wallTimeInZone,
} from '../../apps/web/app/(admin)/recruitment/interviews/interview-reschedule';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FUTURE = new Date(Date.now() + 7 * 86_400_000);

function row(status: string, scorecards = 0): InterviewListItem {
  return {
    id: 'iv-1',
    type: 'onsite',
    status,
    meetingUrl: null,
    scheduledAt: FUTURE,
    duration: 45,
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Mora', email: 'ana@example.com', avatar: null },
    vacancy: { id: 'v1', title: 'Analista' },
    evaluators: [],
    _count: { scorecards },
  } as unknown as InterviewListItem;
}

const baseProps = { isLoading: false, isCancelling: false, onStartAiScreen: () => undefined, aiScreenEnabled: false };

describe('Reprogramar on the interview row', () => {
  it('is offered on an open, unscored interview and hands the row over', () => {
    const onReschedule = vi.fn();
    render(<InterviewTable {...baseProps} interviews={[row('scheduled')]} onReschedule={onReschedule} />);
    fireEvent.click(screen.getByRole('button', { name: es.interviews.reschedule }));
    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'iv-1' }));
  });

  it('is hidden for scored, cancelled or completed interviews, and for viewers without the handler', () => {
    const { rerender } = render(<InterviewTable {...baseProps} interviews={[row('scheduled', 1)]} onReschedule={vi.fn()} />);
    expect(screen.queryByRole('button', { name: es.interviews.reschedule })).toBeNull();
    rerender(<InterviewTable {...baseProps} interviews={[row('cancelled')]} onReschedule={vi.fn()} />);
    expect(screen.queryByRole('button', { name: es.interviews.reschedule })).toBeNull();
    rerender(<InterviewTable {...baseProps} interviews={[row('scheduled')]} />);
    expect(screen.queryByRole('button', { name: es.interviews.reschedule })).toBeNull();
  });
});

describe('RescheduleInterviewDialog', () => {
  it('pre-fills the current time in the organization zone and sends the new instant', async () => {
    const onDone = vi.fn();
    const at = new Date('2030-03-10T16:00:00Z'); // 10:00 in Costa Rica (GMT-6)
    render(
      <RescheduleInterviewDialog target={{ id: 'iv-1', vacancyId: 'v1', scheduledAt: at, duration: 45 }} onClose={vi.fn()} onDone={onDone} />,
    );
    expect(screen.getByLabelText(es.interviews.rescheduleDateLabel)).toHaveValue('2030-03-10');
    expect(screen.getByLabelText(es.interviews.rescheduleTimeLabel)).toHaveValue('10:00');
    expect(screen.getByText(/hora de Costa Rica \(GMT-6\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(es.interviews.rescheduleTimeLabel), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: es.interviews.rescheduleConfirm }));
    expect(mutate).toHaveBeenCalledWith({ id: 'iv-1', scheduledAt: new Date('2030-03-10T20:30:00Z'), duration: 45 });

    await act(async () => handlers.onSuccess?.());
    expect(toast).toHaveBeenCalledWith(es.interviews.rescheduledToast, { type: 'success' });
    expect(onDone).toHaveBeenCalled();
  });

  it('refuses a past time and explains a scored interview CONFLICT', async () => {
    render(
      <RescheduleInterviewDialog
        target={{ id: 'iv-1', vacancyId: 'v1', scheduledAt: new Date('2020-01-01T15:00:00Z'), duration: 30 }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: es.interviews.rescheduleConfirm })).toBeDisabled();
    expect(screen.getByText(es.interviews.reschedulePast)).toBeInTheDocument();
    await act(async () => handlers.onError?.({ data: { code: 'CONFLICT' }, message: 'raw' }));
    expect(toast).toHaveBeenCalledWith(es.interviews.rescheduleScoredConflict, { type: 'error' });
  });
});

describe('reschedule helpers', () => {
  it('canRescheduleInterview', () => {
    expect(canRescheduleInterview({ status: 'scheduled' })).toBe(true);
    expect(canRescheduleInterview({ status: 'rescheduled', _count: { scorecards: 0 } })).toBe(true);
    expect(canRescheduleInterview({ status: 'scheduled', _count: { scorecards: 2 } })).toBe(false);
    expect(canRescheduleInterview({ status: 'completed' })).toBe(false);
    expect(canRescheduleInterview({ status: 'no_show' })).toBe(false);
  });

  it('wallTimeInZone and rescheduleErrorMessage', () => {
    expect(wallTimeInZone(new Date('2030-03-10T05:15:00Z'), 'America/Costa_Rica')).toEqual({ date: '2030-03-09', time: '23:15' });
    expect(rescheduleErrorMessage({ data: { code: 'BAD_REQUEST' }, message: 'm' }, es.interviews)).toBe('m');
  });
});
