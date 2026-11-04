import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// A-17: the modal booked `new Date(date + 'T' + time)` in the BROWSER's zone while the emails print the
// organization's zone, and showed no zone at all. It now books the typed wall-clock time in the
// organization zone (the same one the emails use) and says which zone that is.

const h = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  zone: { data: { timeZone: 'America/Costa_Rica', source: 'organization' }, isError: false } as {
    data: { timeZone: string; source: string } | undefined;
    isError: boolean;
  },
}));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidate: {
      search: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              firstName: 'Ana',
              lastName: 'Mora',
              email: 'ana@example.com',
            },
          ],
        }),
      },
    },
    vacancy: {
      list: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: { items: [{ id: '44444444-4444-4444-8444-444444444444', title: 'Analista', location: 'San José' }] },
        }),
      },
    },
    interview: {
      schedule: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false }) },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/assignable-people', () => ({
  useAssignablePeople: () => ({
    people: [
      { id: '55555555-5555-4555-8555-555555555555', firstName: 'Eva', lastName: 'Rojas', email: 'eva@acme.test' },
    ],
    isLoading: false,
    failure: null,
    refetch: () => undefined,
  }),
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: () => undefined }));
vi.mock('../../apps/web/components', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CandidateAvatar: () => null,
  ErrorState: () => null,
  AssignablePeopleError: () => null,
}));

import { ScheduleModal } from '../../apps/web/app/(admin)/recruitment/interviews/schedule-modal';

afterEach(() => {
  cleanup();
  h.mutateAsync.mockReset();
});

function openOnStep2() {
  localStorage.setItem('tims-locale', 'EN');
  render(
    <I18nProvider>
      <ScheduleModal
        onClose={() => undefined}
        onSuccess={() => undefined}
        schedulingTimeZone={(h.zone.data as { timeZone: string; source: 'organization' | 'utc' } | undefined) ?? null}
        isTimeZoneError={h.zone.isError}
      />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText(en.interviews.scheduleFieldCandidatePlaceholder), {
    target: { value: 'Ana' },
  });
  fireEvent.click(screen.getByText('Ana Mora'));
  fireEvent.click(screen.getByText('Analista'));
  fireEvent.click(screen.getByText('Siguiente'));
}

describe('schedule modal — time zone', () => {
  it('shows the organization zone next to the time and books 10:00 Costa Rica as 16:00 UTC', async () => {
    h.mutateAsync.mockResolvedValue({ candidateNotNotifiedReason: null });
    openOnStep2();
    expect(screen.getByText('Time zone: Costa Rica time (GMT-6)')).toBeInTheDocument();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(dateInput, { target: { value: '2026-11-10' } });
    fireEvent.change(document.querySelector('input[type="time"]') as HTMLInputElement, { target: { value: '10:00' } });
    fireEvent.click(screen.getByText('Siguiente'));
    // The summary is a real, zoned date — not "2026-11-10 a las 10:00".
    expect(screen.getByText(/Tuesday, November 10, 2026 at 10:00 AM, Costa Rica time \(GMT-6\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.interviews.modalTitle }));
    await vi.waitFor(() => expect(h.mutateAsync).toHaveBeenCalledOnce());
    expect((h.mutateAsync.mock.calls[0]![0] as { scheduledAt: Date }).scheduledAt.toISOString()).toBe(
      '2026-11-10T16:00:00.000Z',
    );
  });

  it('without an organization zone it books in UTC and says so', () => {
    h.zone = { data: { timeZone: 'UTC', source: 'utc' }, isError: false };
    openOnStep2();
    expect(screen.getByText('Time zone: UTC')).toBeInTheDocument();
    expect(screen.getByText(en.interviews.scheduleTimeZoneUtcWarning)).toBeInTheDocument();
    h.zone = { data: { timeZone: 'America/Costa_Rica', source: 'organization' }, isError: false };
  });

  it('cannot continue until the zone is known', () => {
    h.zone = { data: undefined, isError: false };
    openOnStep2();
    expect(screen.getByText('Siguiente').closest('button')).toBeDisabled();
    h.zone = { data: { timeZone: 'America/Costa_Rica', source: 'organization' }, isError: false };
  });
});
