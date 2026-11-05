import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-09: the board keeps its vacancy, view, status toggle and filters in the URL, so Back from a candidate
// returns to the same board. A-05: "Activos | Rechazados | Todos" reads the board with that status.

const h = vi.hoisted(() => ({
  params: new URLSearchParams(),
  boardInputs: [] as Array<{ vacancyId: string; status: string }>,
  board: {
    isLoading: false,
    isError: false,
    data: { vacancyId: 'v2', stages: [] as unknown[] },
  },
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => h.params }));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('../../apps/web/lib/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({ pipeline: { getBoard: { invalidate: vi.fn(), cancel: vi.fn(), getData: vi.fn(), setData: vi.fn() } } }),
      pipeline: {
        getBoard: {
          useQuery: (input: { vacancyId: string; status: string }) => {
            h.boardInputs.push(input);
            return h.board;
          },
        },
        moveCandidate: { useMutation: mutation },
        bulkMove: { useMutation: mutation },
        updateApplicationChecklist: { useMutation: mutation },
      },
      candidate: { bulkTag: { useMutation: mutation } },
    },
  };
});
vi.mock('../../apps/web/app/(admin)/recruitment/pipeline/use-pipeline-vacancy-selection', () => ({
  usePipelineVacancySelection: () => ({
    vacancies: { isError: false, refetch: vi.fn() },
    options: [{ id: 'v2', title: 'Contador', company: null }],
    selectedVacancyId: 'v2',
    setSelectedVacancyId: vi.fn(),
    isLoading: false,
    showUnavailableNotice: false,
  }),
}));
vi.mock('../../apps/web/app/(admin)/recruitment/pipeline/kanban-board', async () => {
  const { createElement } = await import('react');
  return { KanbanBoard: () => createElement('div', { 'data-testid': 'kanban' }) };
});
vi.mock('../../apps/web/app/(admin)/recruitment/pipeline/pipeline-table-view', async () => {
  const { createElement } = await import('react');
  return { PipelineTableView: () => createElement('div', { 'data-testid': 'table' }) };
});
vi.mock('../../apps/web/app/(admin)/recruitment/pipeline/pipeline-list-view', async () => {
  const { createElement } = await import('react');
  return { PipelineListView: () => createElement('div', { 'data-testid': 'list' }) };
});

import PipelinePage from '../../apps/web/app/(admin)/recruitment/pipeline/page';

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.boardInputs.length = 0;
  h.board.data.stages = [];
  window.history.pushState(null, '', '/recruitment/pipeline');
  replaceState = vi.spyOn(window.history, 'replaceState');
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  replaceState.mockRestore();
});

function lastUrl(): string {
  return String(replaceState.mock.calls.at(-1)?.[2] ?? '');
}

describe('pipeline board context in the URL', () => {
  it('restores view, status and filters from the URL and reads the board with that status', async () => {
    h.params = new URLSearchParams('vacancy=v2&view=table&status=rejected&source=portal');
    await act(async () => {
      render(<PipelinePage />);
    });
    expect(screen.getByText(es.pipeline.noRejectedCandidates)).toBeTruthy();
    expect(h.boardInputs.at(-1)).toEqual({ vacancyId: 'v2', status: 'rejected' });
    expect(screen.getByText(es.pipeline.readOnlyNotice)).toBeTruthy();
  });

  it('writes the selected vacancy and every later change back to the URL', async () => {
    h.params = new URLSearchParams();
    h.board.data.stages = [{ id: 's1', name: 'Preselección', order: 0, slaHours: null, applications: [{ id: 'a1' }] }];
    await act(async () => {
      render(<PipelinePage />);
    });
    expect(screen.getByTestId('kanban')).toBeTruthy();
    expect(lastUrl()).toBe('/recruitment/pipeline?vacancy=v2');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: es.pipeline.viewTable }));
    });
    expect(screen.getByTestId('table')).toBeTruthy();
    expect(lastUrl()).toBe('/recruitment/pipeline?vacancy=v2&view=table');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: es.pipeline.statusAll }));
    });
    expect(h.boardInputs.at(-1)).toEqual({ vacancyId: 'v2', status: 'all' });
    expect(lastUrl()).toBe('/recruitment/pipeline?vacancy=v2&view=table&status=all');
  });
});
