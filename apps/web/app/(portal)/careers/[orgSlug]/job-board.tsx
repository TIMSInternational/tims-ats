'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { PortalNav } from './_components/portal-nav';
import { PortalHero } from './_components/portal-hero';
import { VacancyCard } from './_components/vacancy-card';
import { WhyWorkSection } from './_components/why-work-section';
import { PortalFooter } from './_components/portal-footer';

interface JobBoardProps {
  organizationId: string;
  orgName: string;
  orgSlug: string;
}

export function JobBoard({ organizationId, orgName, orgSlug }: JobBoardProps) {
  const { t } = useI18n();
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

  const allItems = vacancies.data?.pages.flatMap((page) => page.items) ?? [];
  const isSearching = Boolean(appliedSearch || appliedLocation);

  function handleSearch() {
    setAppliedSearch(search);
    setAppliedLocation(location);
  }

  return (
    <div className="min-h-screen bg-white">
      <PortalNav orgName={orgName} orgSlug={orgSlug} />
      <PortalHero
        orgName={orgName}
        stats={stats.data}
        search={search}
        location={location}
        onSearchChange={setSearch}
        onLocationChange={setLocation}
        onSearch={handleSearch}
      />

      {stats.isError && (
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <ErrorState onRetry={() => stats.refetch()} />
        </div>
      )}

      {/* Featured Positions */}
      <section id="vacantes" className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-[22px] font-bold text-[#1F114C]">{isSearching ? t.portal.searchResultsTitle : t.portal.allVacanciesTitle}</h2>
          </div>
          {isSearching && <button type="button" onClick={() => { setSearch(''); setLocation(''); setAppliedSearch(''); setAppliedLocation(''); }} className="text-[13px] font-medium text-[#DD0C15] hover:underline">{t.portal.clearSearch}</button>}
        </div>

        {vacancies.isLoading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[#EDEDED] bg-white p-5">
                <Skeleton className="mb-3 h-10 w-10 rounded-lg" />
                <Skeleton className="mb-2 h-5 w-48 rounded" />
                <Skeleton className="mb-3 h-3 w-full rounded" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            ))}
          </div>
        ) : vacancies.isError && !vacancies.data ? (
          <div className="py-16">
            <ErrorState onRetry={() => vacancies.refetch()} />
          </div>
        ) : allItems.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto mb-3 h-12 w-12 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
            <p className="text-sm text-[#8B8B8B]">{isSearching ? t.portal.noSearchResults : t.portal.noVacanciesAvailable}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {allItems.map((v) => (
                <VacancyCard key={v.id} vacancy={v} orgSlug={orgSlug} />
              ))}
            </div>
            {vacancies.hasNextPage && <div className="mt-8 text-center"><button type="button" onClick={() => void vacancies.fetchNextPage()} disabled={vacancies.isFetchingNextPage} className="rounded-lg border border-[#1F114C] px-5 py-2 text-sm font-medium text-[#1F114C] disabled:opacity-50">{vacancies.isFetchingNextPage ? t.portal.loadingMore : t.portal.loadMore}</button></div>}
            {vacancies.isFetchNextPageError && <div className="mt-4"><ErrorState onRetry={() => void vacancies.fetchNextPage()} /></div>}
          </>
        )}
      </section>

      {/* Why Work With Us */}
      <div id="beneficios">
        <WhyWorkSection />
      </div>

      <PortalFooter orgName={orgName} />
    </div>
  );
}
