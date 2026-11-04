import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewListItem } from '../../apps/web/lib/trpc-types';

// Pilot fixes on the interviews list (A-02, B-30, F-9, B-05, E-08, B-28, C-02 recruiter side):
// a past interview has no "Cancelar" and says it waits for its scorecard; no sales upsell in the pilot;
// panelists see no panel-management or scheduling controls; the "En línea" type exists.

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
  StatusBadge: ({ status, map }: { status: string; map: Record<string, { label: string }> }) => (
    <span data-testid="status">{map[status]?.label ?? status}</span>
  ),
  CandidateAvatar: () => null,
  UpsellNotice: () => <span data-testid="upsell">upsell</span>,
}));

import { InterviewTable } from '../../apps/web/app/(admin)/recruitment/interviews/interview-table';
import { InterviewFilterBar } from '../../apps/web/app/(admin)/recruitment/interviews/interview-filter-bar';
import {
  canCancelInterview,
  displayInterviewStatus,
  formatInterviewWhen,
} from '../../apps/web/app/(admin)/recruitment/interviews/interview-status';
import {
  canOfferInterviewScheduling,
  canOfferPanelManagement,
} from '../../apps/web/app/(admin)/recruitment/interviews/interview-cancel';
import {
  availableInterviewTypes,
  locationPlaceholderKey,
} from '../../apps/web/app/(admin)/recruitment/interviews/schedule-modal.helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const HOUR = 3600_000;

describe('derived interview status (A-02 / B-30)', () => {
  const now = new Date('2026-11-10T16:00:00Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it('upcoming stays scheduled and cancellable', () => {
    const iv = { status: 'scheduled', scheduledAt: at(HOUR), duration: 60 };
    expect(displayInterviewStatus(iv, now)).toBe('scheduled');
    expect(canCancelInterview(iv, now)).toBe(true);
  });

  it('while it runs it is "in progress"; once over it waits for its scorecard; neither can be cancelled', () => {
    const running = { status: 'scheduled', scheduledAt: at(-HOUR / 2), duration: 60 };
    expect(displayInterviewStatus(running, now)).toBe('in_progress');
    expect(canCancelInterview(running, now)).toBe(false);
    const over = { status: 'rescheduled', scheduledAt: at(-2 * HOUR), duration: 60 };
    expect(displayInterviewStatus(over, now)).toBe('awaiting_scorecard');
    expect(canCancelInterview(over, now)).toBe(false);
  });

  it('closed statuses are shown as stored', () => {
    for (const status of ['completed', 'cancelled', 'no_show']) {
      expect(displayInterviewStatus({ status, scheduledAt: at(-2 * HOUR), duration: 60 }, now)).toBe(status);
    }
  });

  it('formatInterviewWhen never throws on a missing or invalid date', () => {
    expect(formatInterviewWhen(undefined, 'ES')).toBe('');
    expect(formatInterviewWhen('not a date', 'ES')).toBe('');
    expect(formatInterviewWhen('2026-11-10T16:00:00Z', 'EN')).toMatch(/2026/);
  });
});

describe('who sees the management controls (B-05 / E-08)', () => {
  const canFor =
    (grants: string[]) =>
    (module: string, action = 'read') =>
      grants.includes(`${module}:${action}`);
  const committee = canFor(['interview:read', 'interview:create', 'interview:update']);
  const recruiter = canFor([
    'interview:read',
    'interview:create',
    'interview:update',
    'candidate:read',
    'vacancy:read',
  ]);

  it('a committee-only user can neither schedule nor manage the panel', () => {
    expect(canOfferInterviewScheduling(['committee'], committee)).toBe(false);
    expect(canOfferPanelManagement(['committee'], true)).toBe(false);
  });

  it('recruiters and leaders can; a manager without candidate/vacancy read cannot schedule', () => {
    expect(canOfferInterviewScheduling(['recruiter'], recruiter)).toBe(true);
    expect(canOfferInterviewScheduling(['leader', 'committee'], recruiter)).toBe(true);
    expect(canOfferPanelManagement(['leader'], true)).toBe(true);
    expect(canOfferInterviewScheduling(['recruiter'], committee)).toBe(false);
  });
});

function row(over: Partial<Record<string, unknown>> = {}): InterviewListItem {
  return {
    id: 'iv1',
    type: 'onsite',
    status: 'scheduled',
    meetingUrl: null,
    scheduledAt: new Date(Date.now() + 24 * HOUR),
    duration: 60,
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Mora', email: 'ana@example.com', avatar: null },
    vacancy: { id: 'v1', title: 'Analista' },
    evaluators: [],
    ...over,
  } as unknown as InterviewListItem;
}

function renderTable(props: Partial<Parameters<typeof InterviewTable>[0]> = {}) {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <InterviewTable
        interviews={[row()]}
        isLoading={false}
        onCancel={() => undefined}
        isCancelling={false}
        onManageEvaluators={() => undefined}
        onStartAiScreen={() => undefined}
        aiScreenEnabled={false}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('interview table', () => {
  it('a past, unscored interview has no Cancel and says it waits for its scorecard', () => {
    renderTable({ interviews: [row({ scheduledAt: new Date(Date.now() - 3 * HOUR) })] });
    expect(screen.queryByRole('button', { name: en.interviews.cancelInterview })).toBeNull();
    expect(screen.getByTestId('status')).toHaveTextContent(en.interviews.statusAwaitingScorecard);
  });

  it('an upcoming interview keeps Cancel', () => {
    renderTable();
    expect(screen.getByRole('button', { name: en.interviews.cancelInterview })).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent(en.interviews.statusScheduled);
  });

  it('F-9: no "not in your plan / contact sales" upsell under the pilot scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    renderTable();
    expect(screen.queryByTestId('upsell')).toBeNull();
  });

  it('outside the pilot the upsell is unchanged', () => {
    renderTable();
    expect(screen.getByTestId('upsell')).toBeInTheDocument();
  });

  it('B-05 / B-28: no panel management and no dead candidate link for a panelist', () => {
    renderTable({ onManageEvaluators: undefined, onCancel: undefined, canViewCandidate: false });
    const tableRow = screen.getAllByRole('row')[0]!;
    expect(within(tableRow).queryByRole('button', { name: en.interviews.manageEvaluators })).toBeNull();
    expect(within(tableRow).queryByRole('link', { name: 'Ana Mora' })).toBeNull();
    expect(within(tableRow).getByText('Ana Mora')).toBeInTheDocument();
  });

  it('labels the online type from i18n, never as a raw slug', () => {
    renderTable({ interviews: [row({ type: 'online' })] });
    expect(screen.getByText(en.interviews.typeOnline)).toBeInTheDocument();
    expect(screen.queryByText('online')).toBeNull();
  });
});

describe('interview filter bar', () => {
  const base = {
    view: 'upcoming' as const,
    onViewChange: () => undefined,
    statusFilter: '',
    onStatusChange: () => undefined,
    typeFilter: '',
    onTypeChange: () => undefined,
    onClearFilters: () => undefined,
    hasFilters: false,
  };

  it('E-08: no "Schedule interview" button without the schedule callback', () => {
    localStorage.setItem('tims-locale', 'EN');
    render(
      <I18nProvider>
        <InterviewFilterBar {...base} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: en.interviews.scheduleNew })).toBeNull();
    expect(screen.getByRole('button', { name: en.interviews.viewUpcoming })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: en.interviews.viewPast })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows it when the viewer may schedule', () => {
    localStorage.setItem('tims-locale', 'EN');
    render(
      <I18nProvider>
        <InterviewFilterBar {...base} onSchedule={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: en.interviews.scheduleNew })).toBeInTheDocument();
  });
});

describe('schedule modal helpers (C-02 recruiter side, Costa Rica copy)', () => {
  it('offers an "En línea" type with the video flag off', () => {
    expect(availableInterviewTypes(false).map((it) => it.value)).toContain('online');
  });

  it('placeholders: a San José office for on-site, a meeting link for online — no Bogotá', () => {
    expect(es.interviews[locationPlaceholderKey('onsite')]).toContain('San José');
    expect(es.interviews[locationPlaceholderKey('online')]).toMatch(/Teams|Meet|Zoom/);
    expect(JSON.stringify(es.interviews)).not.toMatch(/Bogot/);
  });
});
