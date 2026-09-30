import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// ---------------------------------------------------------------------------
// F3 (UI part) — a failed Daily join left the room on "Conectando..." forever.
// The room must now show a categorised error (never the raw Daily/CSP text)
// with a retry that re-mints the token and joins again.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  join: (_: unknown): Promise<unknown> => Promise.resolve(),
  destroy: (): Promise<void> => Promise.resolve(),
  errorHandler: null as null | ((ev: unknown) => void),
  mutateAsync: (_: unknown): Promise<{ url: string; token: string }> => Promise.resolve({ url: 'u', token: 't' }),
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
    DailyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    DailyVideo: () => null,
    useDaily: () => daily,
    useMeetingState: () => 'new',
    useLocalSessionId: () => null,
    useParticipantIds: () => [],
    useDailyEvent: (event: string, cb: (ev: unknown) => void) => {
      if (event === 'error') h.errorHandler = cb;
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../apps/web/components', () => ({ Skeleton: () => null }));
vi.mock('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-panel', () => ({
  ScorecardPanel: () => <div>scorecard-stub</div>,
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
            type: 'video',
            candidate: { firstName: 'Ana', lastName: 'Ruiz' },
            vacancy: { title: 'Analista' },
          },
        }),
      },
      createVideoRoom: {
        useMutation: () => ({ mutateAsync: (a: unknown) => h.mutateAsync(a), isPending: false, error: null }),
      },
    },
  },
}));

import InterviewRoomPage from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/page';
import { classifyDailyJoinError } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/daily-join-error';

function renderRoom() {
  localStorage.setItem('tims-locale', 'EN');
  const params = Object.assign(Promise.resolve({ id: 'i1' }), { status: 'fulfilled', value: { id: 'i1' } });
  return render(
    <I18nProvider>
      <InterviewRoomPage params={params} />
    </I18nProvider>,
  );
}

const RAW =
  "EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed https://c.daily.co/call-machine";

describe('interview room Daily join failure', () => {
  beforeEach(() => {
    h.errorHandler = null;
  });

  it('shows a categorised error instead of "Connecting..." forever, then retries with a fresh token', async () => {
    const evalError = Object.assign(new Error(RAW), { name: 'EvalError' });
    const join = vi.fn().mockRejectedValueOnce(evalError).mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mint = vi.fn().mockResolvedValue({ url: 'https://tims.daily.co/room', token: 'tok' });
    h.join = join;
    h.destroy = destroy;
    h.mutateAsync = mint;

    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.interviewRoom.joinErrorTitle);
    expect(alert).toHaveTextContent(en.interviewRoom.joinErrorBlocked);
    expect(document.body.textContent).not.toContain('unsafe-eval');
    expect(document.body.textContent).not.toContain('c.daily.co');
    expect(join).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: en.interviewRoom.joinRetry }));
    await waitFor(() => expect(join).toHaveBeenCalledTimes(2));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("surfaces Daily's fatal error event (e.g. an expired token) as a category", async () => {
    h.join = () => new Promise(() => undefined);
    h.mutateAsync = vi.fn().mockResolvedValue({ url: 'u', token: 't' });
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: en.interviews.roomJoin }));
    await waitFor(() => expect(h.errorHandler).not.toBeNull());
    h.errorHandler?.({ action: 'error', errorMsg: 'Meeting has ended', error: { type: 'exp-token', msg: 'x' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(en.interviewRoom.joinErrorExpired);
  });
});

describe('classifyDailyJoinError', () => {
  it.each([
    [{ type: 'connection-error', msg: 'x', details: { on: 'load' } }, 'blocked'],
    [{ error: { type: 'connection-error', msg: 'x', details: { on: 'join' } } }, 'network'],
    [{ error: { type: 'exp-room', msg: 'x' } }, 'expired'],
    [{ error: { type: 'nbf-token', msg: 'x' } }, 'expired'],
    [{ error: { type: 'no-room', msg: 'x' } }, 'unavailable'],
    [{ error: { type: 'meeting-full', msg: 'x' } }, 'unavailable'],
    [Object.assign(new Error('boom'), { name: 'EvalError' }), 'blocked'],
    [new Error("Refused to evaluate: 'unsafe-eval' is not an allowed source"), 'blocked'],
    ['websocket timed out', 'network'],
    [new Error('something odd'), 'unknown'],
    [null, 'unknown'],
    [42, 'unknown'],
  ])('%j → %s', (input, expected) => {
    expect(classifyDailyJoinError(input)).toBe(expected);
  });
});
