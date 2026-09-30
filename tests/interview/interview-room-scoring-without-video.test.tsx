import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// ---------------------------------------------------------------------------
// #325 — the scorecard was reachable ONLY after interview.createVideoRoom
// succeeded (needs DAILY_API_KEY), so an in-person interview could never be
// scored and a Daily outage blocked all scoring. Scoring must not depend on
// the video provider: no room is created and no DailyProvider is mounted
// unless the evaluator explicitly joins the call.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  type: 'onsite',
  providerMounts: 0,
  join: (_: unknown): Promise<unknown> => Promise.resolve(),
  destroy: (): Promise<void> => Promise.resolve(),
  mutateAsync: (_: unknown): Promise<{ url: string; token: string }> =>
    Promise.resolve({ url: 'https://tims.daily.co/room', token: 'tok' }),
  mutationError: null as null | { message: string },
}));

vi.mock('@daily-co/daily-react', () => {
  const daily = {
    join: (arg: unknown) => h.join(arg),
    destroy: () => h.destroy(),
    isDestroyed: () => false,
    leave: () => Promise.resolve(),
    participants: () => ({}),
  };
  return {
    DailyProvider: ({ children }: { children: ReactNode }) => {
      h.providerMounts += 1;
      return <div data-testid="daily-provider">{children}</div>;
    },
    DailyVideo: () => null,
    useDaily: () => daily,
    useMeetingState: () => 'new',
    useLocalSessionId: () => null,
    useParticipantIds: () => [],
    useDailyEvent: () => undefined,
  };
});
vi.mock('../../apps/web/components', () => ({ Skeleton: () => null }));
vi.mock('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-panel', () => ({
  ScorecardPanel: () => <div data-testid="scorecard-panel">scorecard-stub</div>,
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    interview: {
      getById: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: {
            id: 'i1',
            type: h.type,
            location: 'Oficina Medellín, Sala 2',
            candidate: { firstName: 'Ana', lastName: 'Ruiz' },
            vacancy: { title: 'Analista' },
          },
        }),
      },
      createVideoRoom: {
        useMutation: () => ({
          mutateAsync: (a: unknown) => h.mutateAsync(a),
          isPending: false,
          error: h.mutationError,
        }),
      },
    },
  },
}));

import InterviewRoomPage from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/page';
import { isVideoInterviewType } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-mode';

function renderRoom() {
  localStorage.setItem('tims-locale', 'EN');
  const params = Object.assign(Promise.resolve({ id: 'i1' }), { status: 'fulfilled', value: { id: 'i1' } });
  return render(
    <I18nProvider>
      <InterviewRoomPage params={params} />
    </I18nProvider>,
  );
}

describe('interview room — scoring without video (#325)', () => {
  beforeEach(() => {
    h.providerMounts = 0;
    h.mutationError = null;
    h.join = () => Promise.resolve();
    h.destroy = () => Promise.resolve();
  });

  it.each(['onsite', 'phone'])(
    'a %s interview renders the scorecard directly: no createVideoRoom, no DailyProvider, no join button',
    (type) => {
      h.type = type;
      const mint = vi.fn();
      h.mutateAsync = mint;
      renderRoom();

      expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();
      expect(screen.getByText(en.interviewRoom.scoringInPersonNotice)).toBeInTheDocument();
      expect(screen.getByText('Location: Oficina Medellín, Sala 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.interviews.roomJoin })).toBeNull();
      expect(screen.queryByRole('button', { name: en.interviewRoom.joinVideoCall })).toBeNull();
      expect(screen.queryByTestId('daily-provider')).toBeNull();
      expect(h.providerMounts).toBe(0);
      expect(mint).not.toHaveBeenCalled();
    },
  );

  it('a video interview lobby offers "Score without video", which opens the scorecard without creating a room', () => {
    h.type = 'video';
    const mint = vi.fn();
    h.mutateAsync = mint;
    renderRoom();

    // Lobby first: the join flow is unchanged and the scorecard is one click away.
    expect(screen.getByRole('button', { name: en.interviews.roomJoin })).toBeInTheDocument();
    expect(screen.queryByTestId('scorecard-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo }));

    expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();
    expect(screen.getByText(en.interviewRoom.scoringWithoutVideoNotice)).toBeInTheDocument();
    expect(screen.queryByTestId('daily-provider')).toBeNull();
    expect(h.providerMounts).toBe(0);
    expect(mint).not.toHaveBeenCalled();
  });

  it('when creating the video room fails (e.g. Daily not configured) the lobby still offers the scorecard', () => {
    h.type = 'video';
    h.mutationError = { message: 'Video no configurado' };
    renderRoom();

    expect(screen.getByText('Video no configurado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo }));
    expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();
    expect(h.providerMounts).toBe(0);
  });

  it('from scoring-only mode the evaluator can still join the video call', async () => {
    h.type = 'video';
    const mint = vi.fn().mockResolvedValue({ url: 'https://tims.daily.co/room', token: 'tok' });
    h.mutateAsync = mint;
    renderRoom();

    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo }));
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall }));

    await waitFor(() => expect(screen.getByTestId('daily-provider')).toBeInTheDocument());
    expect(mint).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();
  });

  it('after a join error the scorecard stays reachable, and "Score without video" leaves the call', async () => {
    h.type = 'video';
    h.mutateAsync = vi.fn().mockResolvedValue({ url: 'https://tims.daily.co/room', token: 'tok' });
    h.join = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'EvalError' }));
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.destroy = destroy;
    renderRoom();

    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.interviewRoom.joinErrorTitle);
    // The scorecard panel sits beside the error panel...
    expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();

    // ...and the evaluator can drop the failed call entirely and keep scoring.
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo }));
    await waitFor(() => expect(screen.queryByTestId('daily-provider')).toBeNull());
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('scorecard-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall })).toBeInTheDocument();
  });
});

describe('isVideoInterviewType', () => {
  it.each([
    ['onsite', false],
    ['phone', false],
    ['video', true],
    ['panel', true],
    ['technical', true],
    ['cultural', true],
    ['something-else', true],
  ])('%s → %s', (type, expected) => {
    expect(isVideoInterviewType(type)).toBe(expected);
  });
});
