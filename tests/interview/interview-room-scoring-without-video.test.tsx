import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  meetingUrl: null as string | null,
  queryError: null as null | { message: string },
  providerMounts: 0,
  // Stateful call object: destroy() flips isDestroyed(), like daily-js.
  destroyed: false,
  destroyCalls: 0,
  join: (_: unknown): Promise<unknown> => Promise.resolve(),
  destroy: (): Promise<void> => Promise.resolve(),
  mutateAsync: (_: unknown): Promise<{ url: string; token: string }> =>
    Promise.resolve({ url: 'https://tims.daily.co/room', token: 'tok' }),
}));

vi.mock('@daily-co/daily-react', () => {
  const daily = {
    join: (arg: unknown) => h.join(arg),
    destroy: () => {
      h.destroyCalls += 1;
      h.destroyed = true;
      return h.destroy();
    },
    isDestroyed: () => h.destroyed,
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
            error: h.queryError,
            data: {
              id: 'i1',
              type: h.type,
              meetingUrl: h.meetingUrl,
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
import {
  isDailyRoomUrl,
  isVideoInterview,
} from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-mode';

function renderRoom() {
  localStorage.setItem('tims-locale', 'EN');
  const params = Object.assign(Promise.resolve({ id: 'i1' }), { status: 'fulfilled', value: { id: 'i1' } });
  const tree = () => (
    <I18nProvider>
      <InterviewRoomPage params={params} />
    </I18nProvider>
  );
  const view = render(tree());
  // Re-renders the SAME room, so the mocked getById returns the updated `h` fields
  // (what a background refetch does).
  return { ...view, refetch: () => view.rerender(tree()) };
}

const star = (n: number) => en.interviewRoom.starLabel.replace('{n}', String(n));
const firstCompetency = () => screen.getAllByRole('radiogroup')[0]!;
const isScorecardVisible = () => screen.queryAllByRole('radiogroup').length > 0;
const scoreWithoutVideo = () => screen.getByRole('button', { name: en.interviewRoom.scoreWithoutVideo });

beforeEach(() => {
  h.type = 'video';
  h.status = 'scheduled';
  h.location = 'Oficina Medellín, Sala 2';
  h.meetingUrl = null;
  h.queryError = null;
  h.providerMounts = 0;
  h.destroyed = false;
  h.destroyCalls = 0;
  h.join = () => Promise.resolve();
  h.destroy = () => Promise.resolve();
  h.mutateAsync = () => Promise.resolve({ url: 'https://tims.daily.co/room', token: 'tok' });
});

// Unmount now and let CallStateBridge's deferred destroy fire, so it is counted in
// the test that mounted the call, never in the next one.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 5));
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
    // JoinErrorPanel destroys first; CallStateBridge's unmount cleanup sees isDestroyed() and skips.
    await new Promise((r) => setTimeout(r, 5));
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

describe('interview room — live-call safety and closed rooms (#325 pass 2)', () => {
  async function joinCall() {
    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));
    await waitFor(() => expect(screen.getByTestId('daily-provider')).toBeInTheDocument());
  }

  it('unmounting the video stage destroys the call object (daily-react has no cleanup of its own)', async () => {
    const view = renderRoom();
    await joinCall();
    view.unmount();
    await waitFor(() => expect(h.destroyCalls).toBe(1));
    expect(h.destroyed).toBe(true);
  });

  it('an interview cancelled mid-call keeps the call (and its controls) and shows a notice', async () => {
    const view = renderRoom();
    await joinCall();

    h.status = 'cancelled';
    view.refetch();

    expect(screen.getByTestId('daily-provider')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(en.interviewRoom.cancelledNotice);
    expect(isScorecardVisible()).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.destroyCalls).toBe(0);
  });

  it('a failed background refetch with data still present does not tear down the call', async () => {
    const view = renderRoom();
    await joinCall();

    h.queryError = { message: 'refetch failed' };
    view.refetch();

    expect(screen.getByTestId('daily-provider')).toBeInTheDocument();
    expect(screen.queryByText(en.interviews.couldNotLoadInterview)).toBeNull();
    expect(isScorecardVisible()).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.destroyCalls).toBe(0);
  });

  it.each(['video', 'onsite'])('a no_show %s interview gets the closed notice: no scorecard, no join', (type) => {
    h.type = type;
    h.status = 'no_show';
    const mint = vi.fn();
    h.mutateAsync = mint;
    renderRoom();

    expect(screen.getByRole('status')).toHaveTextContent(en.interviewRoom.closedNotice);
    expect(isScorecardVisible()).toBe(false);
    expect(screen.queryByRole('button', { name: en.interviews.roomJoin })).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it('sequence guard: a createVideoRoom that resolves after leaving to scoring is ignored', async () => {
    h.join = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'EvalError' }));
    const mint = vi.fn().mockResolvedValueOnce({ url: 'https://tims.daily.co/room', token: 'tok1' });
    let resolveLate: (v: { url: string; token: string }) => void = () => undefined;
    mint.mockImplementationOnce(() => new Promise((r) => (resolveLate = r)));
    h.mutateAsync = mint;
    renderRoom();

    await joinCall();
    await screen.findByRole('alert');
    // Retry re-mints a token (left pending), then the evaluator leaves for scoring.
    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinRetry }));
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
    fireEvent.click(scoreWithoutVideo());
    await waitFor(() => expect(screen.queryByTestId('daily-provider')).toBeNull());

    resolveLate({ url: 'https://tims.daily.co/room', token: 'late' });
    await new Promise((r) => setTimeout(r, 5));

    // Still scoring: the late token neither re-mounted the call nor set the join state.
    expect(screen.queryByTestId('daily-provider')).toBeNull();
    expect(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall })).toBeEnabled();
    expect(isScorecardVisible()).toBe(true);
  });

  it('a mode switch moves focus to the panel heading without changing the selected tab', async () => {
    renderRoom();
    fireEvent.click(scoreWithoutVideo());
    fireEvent.click(screen.getByRole('tab', { name: en.interviewRoom.tabCandidate }));

    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinVideoCall }));
    await waitFor(() => expect(screen.getByTestId('daily-provider')).toBeInTheDocument());

    expect(document.activeElement).toHaveTextContent(en.interviewRoom.panelHeading);
    expect(screen.getByRole('tab', { name: en.interviewRoom.tabCandidate })).toHaveAttribute('aria-selected', 'true');
  });

  it('an onsite interview that already has a Daily room (pre-#325 data) keeps the video lobby', () => {
    h.type = 'onsite';
    h.meetingUrl = 'https://tims.daily.co/interview-i1';
    renderRoom();
    expect(screen.getByRole('button', { name: en.interviews.roomJoin })).toBeInTheDocument();
  });
});

describe('isVideoInterview / isDailyRoomUrl', () => {
  it.each([
    [{ type: 'video' }, true],
    [{ type: 'onsite' }, false],
    [{ type: 'phone' }, false],
    [{ type: 'panel' }, false],
    [{ type: 'technical' }, false],
    [{ type: 'cultural' }, false],
    [{ type: 'something-else' }, false],
    [{ type: 'onsite', meetingUrl: 'https://tims.daily.co/interview-1' }, true],
    [{ type: 'panel', meetingUrl: 'https://meet.google.com/abc-defg-hij' }, false],
    [{ type: 'phone', meetingUrl: null }, false],
  ])('%j → %s', (interview, expected) => {
    expect(isVideoInterview(interview)).toBe(expected);
  });

  it.each([
    ['https://tims.daily.co/room-1', true],
    ['https://a.b.daily.co/room', true],
    ['https://daily.co/room', false],
    ['https://tims.daily.co/', false],
    ['http://tims.daily.co/room', false],
    ['https://tims.daily.co.evil.com/room', false],
    ['https://evildaily.co/room', false],
    ['https://evil.com/?u=https://tims.daily.co/room', false],
    ['not a url', false],
    ['', false],
    [null, false],
  ])('%s → %s', (url, expected) => {
    expect(isDailyRoomUrl(url)).toBe(expected);
  });
});
