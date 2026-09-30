import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';

const meeting = vi.hoisted(() => ({ state: 'new' }));
vi.mock('@daily-co/daily-react', () => ({
  useDaily: () => null,
  useMeetingState: () => meeting.state,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { InterviewTopBar } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-top-bar';

describe('interview room status', () => {
  it('shows elapsed time only after the Daily call is joined and no invented FIT or recording status', () => {
    const props = { candidateName: 'QA Candidate', vacancyTitle: 'QA role', isInCall: true };
    const view = render(createElement(InterviewTopBar, props));
    expect(view.container.textContent).not.toContain('00:00');
    expect(view.container.textContent).not.toContain('FIT:');
    expect(view.container.textContent).not.toContain('Grabando');

    meeting.state = 'joined-meeting';
    view.rerender(createElement(InterviewTopBar, props));
    expect(view.container.textContent).toContain('00:00');
    view.unmount();
    meeting.state = 'new';
  });
});
