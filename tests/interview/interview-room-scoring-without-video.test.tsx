import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// ---------------------------------------------------------------------------
// #325 — the scorecard was reachable ONLY after interview.createVideoRoom
// succeeded (needs DAILY_API_KEY), so an in-person interview could never be
// scored and a Daily outage blocked all scoring. Scoring must not depend on
// the video provider, and switching between scoring and the call must never
// remount the REAL ScorecardForm (that would silently discard its draft).
// ---------------------------------------------------------------------------

const ME = '11111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => ({
  type: 'onsite',
  status: 'scheduled',
  location: 'Oficina Medellín, Sala 2' as string | null,
  providerMounts: 0,
  join: (_: unknown): Promise<unknown> => Promise.resolve(),
  destroy: (): Promise<void> => Promise.resolve(),
  mutateAsync: (_: unknown): Promise<{ url: string; token: string }> =>
    Promise.resolve({ url: 'https://tims.daily.co/room', token: 'tok' }),
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
    useDailyEvent: (event: string, cb: (ev: unknown) => void) => {
      void event;
      void cb;
    },
  };
});
vi.mock('../../apps/web/components', () => ({ Skeleton: () => null }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: () => undefined }));
vi.mock('../../apps/web/lib/permissions', () => ({ usePermissions: () => ({ userId: ME }) }));
vi.mock('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-ai-panel', () => ({
  InterviewAiPanel: () => <div>ai-stub</div>,
}));
vi.mock('../../apps/web/lib/trpc', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        interview: {
          getScorecard: { invalidate: () => undefined },
          getById: { invalidate: () => undefined },
          getPendingScorecards: { invalidate: () => undefined },
        },
      }),
      vacancy: { getJobProfile: { useQuery: () => ({ isLoading: false, isError: false, data: null }) } },
      interview: {
        getById: {
          useQuery: () => ({
            isLoading: false,
            error: null,
            data: {
              id: 'i1',
              type: h.type,
              status: h.status,
              location: h.location,
              scheduledAt: new Date('2026-09-30T15:00:00Z'),
              duration: 45,
              candidate: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: null },
              vacancy: { id: 'v1', title: 'Analista' },
              evaluators: [
                { id: 'e1', userId: ME, user: { id: ME, firstName: 'Yo', lastName: 'Mismo', avatar: null } },
              ],
              scorecards: [],
            },
          }),
        },
        getScorecard: {
          useQuery: () => ({ isLoading: false, isError: false, data: null, refetch: () => undefined }),
        },
        submitScorecard: {
          useMutation: () => ({ mutate: () => undefined, isPending: false, isError: false, error: null }),
        },
        // Stateful like the real hook, so isPending re-renders the room.
        createVideoRoom: {
          useMutation: () => {
            const [isPending, setIsPending] = React.useState(false);
            return {
              isPending,
              error: null,
              mutateAsync: async (a: unknown) => {
                setIsPending(true);
                try {
                  return await h.mutateAsync(a);
                } finally {
                  setIsPending(false);
                }
              },
            };
          },
        },
      },
    },
  };
});

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

const star = (n: number) => en.interviewRoom.starLabel.replace('{n}', String(n));
const firstCompetency = () => screen.getAllByRole('radiogroup')[0]!;
const isScorecardVisible = () => screen.queryAllByRole('radiogroup').length > 0;
const scoreWithoutVideo = () => screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo });

beforeEach(() => {
  h.type = 'video';
  h.status = 'scheduled';
  h.location = 'Oficina Medellín, Sala 2';
  h.providerMounts = 0;
  h.join = () => Promise.resolve();
  h.destroy = () => Promise.resolve();
  h.mutateAsync = () => Promise.resolve({ url: 'https://tims.daily.co/room', token: 'tok' });
});

describe('interview room — scoring without video (#325)', () => {
  it.each(['onsite', 'phone', 'panel', 'technical', 'cultural', 'legacy-unknown'])(
    'a %s interview renders the REAL scorecard directly: no createVideoRoom, no DailyProvider, no join button',
    (type) => {
      h.type = type;
      const mint = vi.fn();
      h.mutateAsync = mint;
      renderRoom();

      expect(isScorecardVisible()).toBe(true);
      expect(screen.getByRole('button', { name: en.interviewRoom.submit })).toBeInTheDocument();
      expect(screen.getByText(en.interviewRoom.scoringInPersonNotice)).toBeInTheDocument();
      expect(screen.getByText('Location or link: Oficina Medellín, Sala 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.interviews.roomJoin })).toBeNull();
      expect(screen.queryByRole('button', { name: en.interviewRoom.joinVideoCall })).toBeNull();
      expect(screen.queryByTestId('daily-provider')).toBeNull();
      expect(h.providerMounts).toBe(0);
      expect(mint).not.toHaveBeenCalled();
    },
  );

  it('renders a user-entered location literally (no String.replace $-patterns)', () => {
    h.type = 'onsite';
    h.location = "Sala $& y $' 3";
    renderRoom();
    expect(screen.getByText("Location or link: Sala $& y $' 3")).toBeInTheDocument();
  });

  it('a video interview starts in the lobby; "Score without video" opens the scorecard without creating a room', () => {
    const mint = vi.fn();
    h.mutateAsync = mint;
    renderRoom();

    expect(screen.getByRole('button', { name: en.interviews.roomJoin })).toBeInTheDocument();
    expect(isScorecardVisible()).toBe(false);

    fireEvent.click(scoreWithoutVideo());

    expect(isScorecardVisible()).toBe(true);
    expect(screen.getByText(en.interviewRoom.scoringWithoutVideoNotice)).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent(en.interviewRoom.panelHeading);
    expect(h.providerMounts).toBe(0);
    expect(mint).not.toHaveBeenCalled();
  });

  it('when creating the video room fails (e.g. Daily not configured) the lobby still offers the scorecard', async () => {
    h.mutateAsync = () => Promise.reject(new Error('Video no configurado'));
    renderRoom();

    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));
    expect(await screen.findByText('Video no configurado')).toBeInTheDocument();
    fireEvent.click(scoreWithoutVideo());
    expect(isScorecardVisible()).toBe(true);
    expect(h.providerMounts).toBe(0);
  });

  it('"Score without video" is disabled while a join is in flight (no late-token race)', async () => {
    let resolve: (v: { url: string; token: string }) => void = () => undefined;
    h.mutateAsync = () => new Promise((r) => (resolve = r));
    renderRoom();

    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));
    await waitFor(() => expect(scoreWithoutVideo()).toBeDisabled());
    resolve({ url: 'https://tims.daily.co/room', token: 'tok' });
    await waitFor(() => expect(screen.getByTestId('daily-provider')).toBeInTheDocument());
  });

  it('keeps the scorecard draft across scoring → call → join error → scoring (REAL ScorecardForm)', async () => {
    h.join = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'EvalError' }));
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.destroy = destroy;
    renderRoom();

    fireEvent.click(scoreWithoutVideo());
    fireEvent.click(within(firstCompetency()).getByRole('radio', { name: star(4) }));
    const notes = screen.getByPlaceholderText(en.interviewRoom.overallNotesPlaceholder);
    fireEvent.change(notes, { target: { value: 'Buena comunicación' } });

    // Join from scoring: the call mounts beside the SAME scorecard instance.
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall }));
    await waitFor(() => expect(screen.getByTestId('daily-provider')).toBeInTheDocument());
    expect(within(firstCompetency()).getByRole('radio', { name: star(4) })).toHaveAttribute('aria-checked', 'true');

    // The Daily join fails; leave the call and keep scoring.
    expect(await screen.findByRole('alert')).toHaveTextContent(en.interviewRoom.joinErrorTitle);
    fireEvent.click(scoreWithoutVideo());
    await waitFor(() => expect(screen.queryByTestId('daily-provider')).toBeNull());
    expect(destroy).toHaveBeenCalledTimes(1);

    expect(within(firstCompetency()).getByRole('radio', { name: star(4) })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(en.interviewRoom.overallNotesPlaceholder)).toHaveValue('Buena comunicación');
  });

  it('a join started from scoring keeps the scorecard visible while pending and after it fails', async () => {
    let reject: (e: Error) => void = () => undefined;
    h.mutateAsync = () => new Promise((_, r) => (reject = r));
    renderRoom();

    fireEvent.click(scoreWithoutVideo());
    fireEvent.click(within(firstCompetency()).getByRole('radio', { name: star(3) }));
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall }));

    const pending = await screen.findByRole('button', { name: en.interviews.roomConnecting });
    expect(pending).toBeDisabled();
    expect(isScorecardVisible()).toBe(true);

    reject(new Error('Video no configurado'));
    expect(await screen.findByText('Video no configurado')).toBeInTheDocument();
    expect(within(firstCompetency()).getByRole('radio', { name: star(3) })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall })).toBeEnabled();
    expect(h.providerMounts).toBe(0);
  });

  it('a completed video interview opens on the scoring stage without creating a room', () => {
    h.status = 'completed';
    const mint = vi.fn();
    h.mutateAsync = mint;
    renderRoom();

    expect(isScorecardVisible()).toBe(true);
    expect(screen.queryByRole('button', { name: en.interviews.roomJoin })).toBeNull();
    expect(mint).not.toHaveBeenCalled();
    expect(h.providerMounts).toBe(0);
  });

  it.each(['video', 'onsite'])('a cancelled %s interview shows a notice and cannot be joined or scored', (type) => {
    h.type = type;
    h.status = 'cancelled';
    const mint = vi.fn();
    h.mutateAsync = mint;
    renderRoom();

    expect(screen.getByRole('status')).toHaveTextContent(en.interviewRoom.cancelledNotice);
    expect(isScorecardVisible()).toBe(false);
    expect(screen.queryByRole('button', { name: en.interviewRoom.submit })).toBeNull();
    expect(screen.queryByRole('button', { name: en.interviews.roomJoin })).toBeNull();
    expect(screen.queryByRole('button', { name: en.interviewRoom.scoreWithoutVideo })).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('isVideoInterviewType', () => {
  it.each([
    ['video', true],
    ['onsite', false],
    ['phone', false],
    ['panel', false],
    ['technical', false],
    ['cultural', false],
    ['something-else', false],
  ])('%s → %s', (type, expected) => {
    expect(isVideoInterviewType(type)).toBe(expected);
  });
});
