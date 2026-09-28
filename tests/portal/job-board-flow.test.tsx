import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

const mocks = vi.hoisted(() => ({
  pages: [{ items: [] as Array<{ id: string; title: string }>, nextCursor: undefined as string | undefined }],
  fetchNextPage: vi.fn(),
  requested: [] as Array<{ search?: string; location?: string }>,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en }) }));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { portal: {
  getPortalStats: { useQuery: () => ({ data: { totalVacancies: 0, totalLocations: 0, totalDepartments: 0 }, isError: false }) },
  listVacancies: { useInfiniteQuery: (input: { search?: string; location?: string }) => {
    mocks.requested.push(input);
    return { data: { pages: mocks.pages }, isLoading: false, isError: false, hasNextPage: Boolean(mocks.pages.at(-1)?.nextCursor), isFetchingNextPage: false, isFetchNextPageError: false, fetchNextPage: mocks.fetchNextPage, refetch: vi.fn() };
  } },
} } }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-nav', () => ({ PortalNav: () => null }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-footer', () => ({ PortalFooter: () => null }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/_components/why-work-section', () => ({ WhyWorkSection: () => null }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-hero', () => ({ PortalHero: ({ search, onSearchChange, onSearch }: { search: string; onSearchChange: (s: string) => void; onSearch: () => void }) => <form onSubmit={(event) => { event.preventDefault(); onSearch(); }}><input aria-label="Job title" value={search} onChange={(event) => onSearchChange(event.target.value)} /><button type="submit">Search</button></form> }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/_components/vacancy-card', () => ({ VacancyCard: ({ vacancy }: { vacancy: { title: string } }) => <article>{vacancy.title}</article> }));
vi.mock('../../apps/web/components', () => ({ Skeleton: () => null, ErrorState: () => <div>Unavailable</div> }));

import { JobBoard } from '../../apps/web/app/(portal)/careers/[orgSlug]/job-board';

function renderBoard() { return render(<JobBoard organizationId="22222222-2222-4222-8222-222222222222" orgName="Test Company" orgSlug="test-company" />); }

describe('public job board', () => {
  beforeEach(() => {
    mocks.pages = [{ items: [], nextCursor: undefined }];
    mocks.fetchNextPage.mockReset();
    mocks.requested = [];
  });

  it('distinguishes an empty company board from a search with no results and clears the search', () => {
    renderBoard();
    expect(screen.getByText(en.portal.noVacanciesAvailable)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText(en.portal.noSearchResults)).toBeInTheDocument();
    expect(mocks.requested.at(-1)?.search).toBe('Engineer');
    fireEvent.click(screen.getByRole('button', { name: en.portal.clearSearch }));
    expect(screen.getByText(en.portal.noVacanciesAvailable)).toBeInTheDocument();
    expect(mocks.requested.at(-1)?.search).toBeUndefined();
  });

  it('shows a path to jobs after the first page', () => {
    mocks.pages = [{ items: [{ id: '1', title: 'First job' }], nextCursor: '1' }];
    const view = renderBoard();
    expect(screen.getByText('First job')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.portal.loadMore }));
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
    mocks.pages = [...mocks.pages, { items: [{ id: '2', title: 'Later job' }], nextCursor: undefined }];
    view.rerender(<JobBoard organizationId="22222222-2222-4222-8222-222222222222" orgName="Test Company" orgSlug="test-company" />);
    expect(screen.getByText('Later job')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.portal.loadMore })).not.toBeInTheDocument();
  });
});
