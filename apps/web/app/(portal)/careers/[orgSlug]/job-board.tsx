'use client';

import { useEffect, useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../components';
import { EmptyState } from '../../../../components/empty-state';
import { Button } from '../../../../components/button';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { PortalNav } from './_components/portal-nav';
import { PortalHero } from './_components/portal-hero';
import { VacancyCard } from './_components/vacancy-card';
import { WhyWorkSection } from './_components/why-work-section';
import { isPilotScope } from '../../../../lib/launch-scope';
import { PortalFooter } from './_components/portal-footer';
import { trackCareersFunnel } from '../../../../lib/analytics/web-analytics';

const BRIEFCASE_ICON = (
  <svg className="size-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a4 4 0 00-8 0v2" />
  </svg>
);

interface JobBoardProps {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  orgLogo?: string | null;
}

export function JobBoard({ organizationId, orgName, orgSlug, orgLogo = null }: JobBoardProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedLocation, setAppliedLocation] = useState('');

  const stats = trpc.portal.getPortalStats.useQuery({ organizationId });
  const vacancies = trpc.portal.listVacancies.useInfiniteQuery({
    organizationId,
    take: 50,
    search: appliedSearch || undefined,
    location: appliedLocation || undefined,
  }, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  // Funnel step 1 (a no-op unless Web Analytics is on): the board was viewed. Only the public slug is sent.
  useEffect(() => trackCareersFunnel('careers_view', orgSlug), [orgSlug]);

  const allItems = vacancies.data?.pages.flatMap((page) => page.items) ?? [];
  const isSearching = Boolean(appliedSearch || appliedLocation);

  function handleSearch() {
    setAppliedSearch(search);
    setAppliedLocation(location);
    // The results sit below the hero: bring them into view (no animation under reduced motion).
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document.getElementById('vacantes')?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function clearSearch() {
    setSearch('');
    setLocation('');
    setAppliedSearch('');
    setAppliedLocation('');
  }

  const resultCount = vacancies.hasNextPage
    ? formatMessage(p.searchResultCountMore, { count: allItems.length })
    : pluralize(allItems.length, { one: p.searchResultCountOne, other: p.searchResultCountMany }, locale);
  const boardIsEmpty = stats.data?.totalVacancies === 0 && !isSearching;

  return (
    <div className="min-h-screen bg-white">
      <PortalNav orgName={orgName} orgSlug={orgSlug} orgLogo={orgLogo} />
      <main>
        <PortalHero
          orgName={orgName}
          stats={stats.data}
          search={search}
          location={location}
          onSearchChange={setSearch}
          onLocationChange={setLocation}
          onSearch={handleSearch}
          showSearch={!boardIsEmpty}
        />

        {stats.isError && (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <ErrorState onRetry={() => stats.refetch()} error={stats.error} />
          </div>
        )}

        <section id="vacantes" aria-labelledby="vacantes-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-10 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="vacantes-title" className="font-display text-title font-bold text-brand">
                {isSearching ? p.searchResultsTitle : p.allVacanciesTitle}
              </h2>
              {/* Announced after a search, so a screen-reader user hears whether anything matched. */}
              <p aria-live="polite" aria-atomic="true" className="mt-1 text-callout text-secondary tabular-nums">
                {isSearching && !vacancies.isLoading && !vacancies.isError ? resultCount : ''}
              </p>
            </div>
            {isSearching && allItems.length > 0 && (
              <Button variant="tertiary" size="sm" onClick={clearSearch}>
                {p.clearSearch}
              </Button>
            )}
          </div>

          {vacancies.isLoading ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              <span className="sr-only">{p.loadingMore}</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-white p-5">
                  <Skeleton className="mb-3 size-10 rounded-lg" />
                  <Skeleton className="mb-2 h-5 w-48 rounded" />
                  <Skeleton className="mb-3 h-3 w-full rounded" />
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              ))}
            </div>
          ) : vacancies.isError && !vacancies.data ? (
            <div className="py-16">
              <ErrorState onRetry={() => vacancies.refetch()} error={vacancies.error} />
            </div>
          ) : allItems.length === 0 ? (
            isSearching ? (
              <EmptyState
                title={p.searchNoResultsTitle}
                description={p.noSearchResults}
                secondaryAction={{ label: p.clearSearch, onClick: clearSearch }}
              />
            ) : (
              <EmptyState
                icon={BRIEFCASE_ICON}
                title={p.noVacanciesAvailable}
                description={p.noVacanciesHint}
                secondaryAction={{ label: p.viewMyApplications, href: `/careers/${orgSlug}/dashboard` }}
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {allItems.map((v) => (
                  <VacancyCard key={v.id} vacancy={v} orgSlug={orgSlug} orgName={orgName} />
                ))}
              </div>
              {vacancies.hasNextPage && (
                <div className="mt-8 text-center">
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => void vacancies.fetchNextPage()}
                    loading={vacancies.isFetchingNextPage}
                    loadingLabel={p.loadingMore}
                  >
                    {p.loadMore}
                  </Button>
                </div>
              )}
              {vacancies.isFetchNextPageError && <div className="mt-4"><ErrorState onRetry={() => void vacancies.fetchNextPage()} /></div>}
            </>
          )}
        </section>

        {/* Why Work With Us — advertises assessments / integrated video the pilot does not offer. */}
        {!isPilotScope() && (
          <div id="beneficios">
            <WhyWorkSection />
          </div>
        )}
      </main>

      <PortalFooter orgName={orgName} orgSlug={orgSlug} orgLogo={orgLogo} />
    </div>
  );
}

