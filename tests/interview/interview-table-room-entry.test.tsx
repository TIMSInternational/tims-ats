import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewListItem } from '../../apps/web/lib/trpc-types';

// #325 — the room entry in the interviews table: shown for every status the server
// treats as awaiting a scorecard (plus in_progress), never for cancelled / no_show;
// labelled "Join" only for a not-yet-completed video interview, "Score" otherwise.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
}));

import { InterviewTable } from '../../apps/web/app/(admin)/recruitment/interviews/interview-table';

function row(id: string, type: string, status: string, meetingUrl: string | null = null): InterviewListItem {
  return {
    id,
    type,
    status,
    meetingUrl,
    scheduledAt: new Date('2026-10-02T15:00:00Z'),
    duration: 45,
    candidate: { id: `c-${id}`, firstName: 'Cand', lastName: id, email: `${id}@example.com`, avatar: null },
    vacancy: { id: 'v1', title: 'Analista' },
    evaluators: [],
  } as unknown as InterviewListItem;
}

const CASES: Array<[type: string, status: string, label: string | null, meetingUrl?: string]> = [
  ['video', 'scheduled', en.interviews.joinMeeting],
  ['video', 'rescheduled', en.interviews.joinMeeting],
  ['video', 'in_progress', en.interviews.joinMeeting],
  ['video', 'completed', en.interviews.scoreInterview],
  ['onsite', 'scheduled', en.interviews.scoreInterview],
  ['onsite', 'rescheduled', en.interviews.scoreInterview],
  ['phone', 'scheduled', en.interviews.scoreInterview],
  ['panel', 'scheduled', en.interviews.scoreInterview],
  ['onsite', 'completed', en.interviews.scoreInterview],
  ['video', 'cancelled', null],
  ['onsite', 'cancelled', null],
  ['onsite', 'no_show', null],
  ['video', 'no_show', null],
  // Pre-#325 data: a Daily room was created for a non-video type; it stays a video call.
  ['onsite', 'scheduled', en.interviews.joinMeeting, 'https://tims.daily.co/interview-iv1'],
  ['panel', 'scheduled', en.interviews.scoreInterview, 'https://meet.google.com/abc-defg-hij'],
];

describe('interview table — room entry', () => {
  it.each(CASES)('%s / %s → %s (%s)', (type, status, label, meetingUrl) => {
    localStorage.setItem('tims-locale', 'EN');
    render(
      <I18nProvider>
        <InterviewTable
          interviews={[row('iv1', type, status, meetingUrl ?? null)]}
          isLoading={false}
          onCancel={() => undefined}
          isCancelling={false}
          onManageEvaluators={() => undefined}
          onStartAiScreen={() => undefined}
          aiScreenEnabled={false}
        />
      </I18nProvider>,
    );
    const tableRow = screen.getAllByRole('row')[0]!;
    const roomLinks = within(tableRow)
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/recruitment/interviews/iv1/room');
    if (label === null) {
      expect(roomLinks).toHaveLength(0);
    } else {
      expect(roomLinks).toHaveLength(1);
      expect(roomLinks[0]).toHaveTextContent(label);
      // Plain <a> full-document load into the room (its CSP differs from this page's).
      expect(roomLinks[0]!.tagName).toBe('A');
    }
  });
});
