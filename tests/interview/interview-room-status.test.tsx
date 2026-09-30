import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';

const meeting = vi.hoisted(() => ({
  state: 'new',
  destroyed: false,
  // leave() rejecting must not surface as an unhandled rejection.
  leave: vi.fn(() => Promise.reject(new Error('not in a call'))),
  destroy: vi.fn(() => {
    meeting.destroyed = true;
    return Promise.resolve();
  }),
}));
vi.mock('@daily-co/daily-react', () => ({
  useDaily: () => ({ leave: meeting.leave, destroy: meeting.destroy, isDestroyed: () => meeting.destroyed }),
  useMeetingState: () => meeting.state,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { InterviewTopBar } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-top-bar';
import { CallStateBridge } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/call-state-bridge';

describe('interview room status', () => {
  it('shows elapsed time only while the Daily call is joined and no invented FIT or recording status', () => {
    const props = { candidateName: 'QA Candidate', vacancyTitle: 'QA role', isCallActive: false };
    const view = render(createElement(InterviewTopBar, props));
    expect(view.container.textContent).not.toContain('00:00');
    expect(view.container.textContent).not.toContain('FIT:');
    expect(view.container.textContent).not.toContain('Grabando');
    // Localized chrome (default locale ES outside an I18nProvider).
    expect(view.container.textContent).toContain(es.interviewRoom.topBarLabel);
    expect(view.container.textContent).toContain(es.interviewRoom.endCall);
    expect(en.interviewRoom.endCall).toBeTruthy();

    view.rerender(createElement(InterviewTopBar, { ...props, isCallActive: true }));
    expect(view.container.textContent).toContain('00:00');
    view.unmount();
  });

  it('restarts the timer for each new call', () => {
    vi.useFakeTimers();
    try {
      const props = { candidateName: 'QA Candidate', vacancyTitle: 'QA role', isCallActive: true };
      const view = render(createElement(InterviewTopBar, props));
      act(() => vi.advanceTimersByTime(65_000));
      expect(view.container.textContent).toContain('01:05');

      view.rerender(createElement(InterviewTopBar, { ...props, isCallActive: false }));
      view.rerender(createElement(InterviewTopBar, props));
      expect(view.container.textContent).toContain('00:00');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CallStateBridge (top bar lives outside DailyProvider)', () => {
  it('reports the joined state, exposes a safe leave, and destroys the call on unmount', async () => {
    const onChange = vi.fn();
    const leaveRef: { current: (() => void) | null } = { current: null };
    meeting.state = 'joining-meeting';
    meeting.destroyed = false;
    const view = render(createElement(CallStateBridge, { onCallActiveChange: onChange, leaveRef }));
    expect(onChange).toHaveBeenLastCalledWith(false);

    meeting.state = 'joined-meeting';
    view.rerender(createElement(CallStateBridge, { onCallActiveChange: onChange, leaveRef }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    leaveRef.current?.();
    expect(meeting.leave).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(leaveRef.current).toBeNull();
    await waitFor(() => expect(meeting.destroy).toHaveBeenCalledTimes(1));
    expect(meeting.destroyed).toBe(true);
    meeting.state = 'new';
  });

  it('does not destroy an already-destroyed call again (idempotent with JoinErrorPanel)', async () => {
    meeting.destroy.mockClear();
    meeting.destroyed = true;
    const view = render(
      createElement(CallStateBridge, { onCallActiveChange: () => undefined, leaveRef: { current: null } }),
    );
    view.unmount();
    await new Promise((r) => setTimeout(r, 5));
    expect(meeting.destroy).not.toHaveBeenCalled();
  });
});
