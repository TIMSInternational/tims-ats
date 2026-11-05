import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-10: opened from a candidate (pipeline card, Candidate 360, move toast), the schedule form skips step 1,
// names the candidate and the vacancy, and books against that application.

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), searchCalls: 0 }));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidate: {
      search: {
        useQuery: () => {
          h.searchCalls += 1;
          return { isLoading: false, isError: false, data: [] };
        },
      },
    },
    vacancy: { list: { useQuery: () => ({ isLoading: false, isError: false, data: { items: [] } }) } },
    interview: {
      list: {
        useQuery: () => ({ data: { schedulingTimeZone: { timeZone: 'America/Costa_Rica', source: 'organization' } }, isError: false }),
      },
      schedule: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false }) },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/assignable-people', () => ({
  useAssignablePeople: () => ({
    people: [{ id: '55555555-5555-4555-8555-555555555555', firstName: 'Eva', lastName: 'Rojas', email: 'eva@acme.test' }],
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

const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const APP_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', vacancyId: '44444444-4444-4444-8444-444444444444', vacancyTitle: 'Analista' };
const APP_B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', vacancyId: '66666666-6666-4666-8666-666666666666', vacancyTitle: 'Contador' };

afterEach(() => {
  cleanup();
  h.mutateAsync.mockReset();
});

async function finish() {
  fireEvent.click(screen.getByText('Siguiente'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: es.interviews.modalTitle }));
  await vi.waitFor(() => expect(h.mutateAsync).toHaveBeenCalledOnce());
  return h.mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
}

describe('schedule modal — prefilled from a candidate', () => {
  it('starts at step 2 with the candidate and vacancy named, and books against the application', async () => {
    h.mutateAsync.mockResolvedValue({ candidateNotNotifiedReason: null });
    render(
      <ScheduleModal
        prefill={{ candidateId: CANDIDATE, candidateName: 'Ana Mora', applications: [APP_A] }}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );
    expect(screen.queryByPlaceholderText(es.interviews.scheduleFieldCandidatePlaceholder)).toBeNull();
    expect(screen.getByText('Ana Mora · Analista')).toBeTruthy();
    // Step 1 is not offered: no way "back" to retyping the candidate.
    expect(screen.queryByText('Anterior')).toBeNull();
    const input = await finish();
    expect(input).toMatchObject({ candidateId: CANDIDATE, vacancyId: APP_A.vacancyId, applicationId: APP_A.id });
  });

  it('lets the recruiter pick which of the candidate applications the interview is for', async () => {
    h.mutateAsync.mockResolvedValue({ candidateNotNotifiedReason: null });
    render(
      <ScheduleModal
        prefill={{ candidateId: CANDIDATE, candidateName: 'Ana Mora', applications: [APP_A, APP_B] }}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: new RegExp(es.candidates.scheduleForApplication) }), {
      target: { value: APP_B.id },
    });
    const input = await finish();
    expect(input).toMatchObject({ vacancyId: APP_B.vacancyId, applicationId: APP_B.id });
  });
});
