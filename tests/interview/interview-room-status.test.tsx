import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';

const meeting = vi.hoisted(() => ({ state: 'new', leave: vi.fn(() => Promise.resolve()) }));
vi.mock('@daily-co/daily-react', () => ({
  useDaily: () => ({ leave: meeting.leave }),
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

    view.rerender(createElement(InterviewTopBar, { ...props, isCallActive: true }));
    expect(view.container.textContent).toContain('00:00');
    view.unmount();
  });
});

describe('CallStateBridge (top bar lives outside DailyProvider)', () => {
  it('reports the joined state, exposes leave, and resets both on unmount', () => {
    const onChange = vi.fn();
    const leaveRef: { current: (() => void) | null } = { current: null };
    meeting.state = 'joining-meeting';
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
    meeting.state = 'new';
  });
});
