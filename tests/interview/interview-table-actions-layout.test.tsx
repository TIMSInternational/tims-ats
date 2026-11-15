import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewListItem } from '../../apps/web/lib/trpc-types';

// HIG pass: on a 1440px desktop the interviews table was wider than its column, so the row's primary
// action ("Score" / "Join") sat past the scroller's right edge and the per-row upsell broke into one-word
// fragments beside it. The actions cell is now pinned to the right edge and the upsell is said once.

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
  UpsellNotice: ({ message }: { message: string }) => <p data-testid="upsell">{message}</p>,
}));

import { InterviewTable } from '../../apps/web/app/(admin)/recruitment/interviews/interview-table';

function row(id: string): InterviewListItem {
  return {
    id,
    type: 'onsite',
    status: 'scheduled',
    meetingUrl: null,
    scheduledAt: new Date('2026-10-02T15:00:00Z'),
    duration: 45,
    candidate: { id: `c-${id}`, firstName: 'Cand', lastName: id, email: `${id}@example.com`, avatar: null },
    vacancy: { id: 'v1', title: 'Coordinador(a) de Logística' },
    evaluators: [],
  } as unknown as InterviewListItem;
}

function renderTable(aiScreenEnabled: boolean) {
  return render(
    <I18nProvider>
      <InterviewTable
        interviews={[row('iv1'), row('iv2')]}
        isLoading={false}
        onCancel={() => undefined}
        isCancelling={false}
        onManageEvaluators={() => undefined}
        onStartAiScreen={() => undefined}
        aiScreenEnabled={aiScreenEnabled}
      />
    </I18nProvider>,
  );
}

describe('interview table — actions stay in view', () => {
  beforeEach(() => localStorage.setItem('tims-locale', 'EN'));

  it('pins the cell holding the primary room action to the right edge of the scroller', () => {
    renderTable(true);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    for (const tableRow of rows) {
      const room = within(tableRow).getByRole('link', { name: en.interviews.scoreInterview });
      const cell = room.closest('td');
      expect(cell?.className).toContain('sticky');
      expect(cell?.className).toContain('right-0');
      // An opaque background, so scrolled columns pass under it instead of showing through.
      expect(cell?.className).toContain('bg-white');
      // Sticky cells are stacking contexts: the one whose menu is open must rise above the next row's.
      expect(cell?.className).toContain('has-[[aria-expanded=true]]:z-20');
    }
  });

  it('says the AI-screen upsell once, above the list, and never inside a row', () => {
    renderTable(false);
    const upsells = screen.getAllByTestId('upsell');
    expect(upsells).toHaveLength(1);
    expect(upsells[0]).toHaveTextContent(en.interviews.aiScreenNotIncluded);
    for (const tableRow of screen.getAllByRole('row')) {
      expect(within(tableRow).queryByTestId('upsell')).toBeNull();
    }
  });

  it('shows no upsell when the AI screen is enabled', () => {
    renderTable(true);
    expect(screen.queryByTestId('upsell')).toBeNull();
  });
});
