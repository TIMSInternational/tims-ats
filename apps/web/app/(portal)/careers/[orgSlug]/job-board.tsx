'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { Skeleton } from '../../../../components';
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

const CATEGORIES = [
  { emoji: '\uD83D\uDCBB', label: 'Engineering' },
  { emoji: '\uD83D\uDCCA', label: 'Product' },
  { emoji: '\uD83C\uDFA8', label: 'Design' },
  { emoji: '\uD83D\uDCC8', label: 'Consultoria' },
  { emoji: '\uD83D\uDC65', label: 'RRHH' },
  { emoji: '\uD83D\uDCBC', label: 'Comercial' },
];

export function JobBoard({ organizationId, orgName, orgSlug }: JobBoardProps) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedLocation, setAppliedLocation] = useState('');

  const stats = trpc.portal.getPortalStats.useQuery({ organizationId });
  const vacancies = trpc.portal.listVacancies.useQuery({
    organizationId,
    take: 50,
    search: appliedSearch || undefined,
    location: appliedLocation || undefined,
  });

  type Salary = { min?: number; max?: number; currency?: string } | null;
  const items = (vacancies.data?.items ?? []).map((v) => ({
    ...v,
    salary: v.salary as Salary,
  }));
  const featured = items.slice(0, 3);
  const allItems = items;

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

      {/* Featured Positions */}
      <section id="vacantes" className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-[22px] font-bold text-[#1F114C]">Vacantes Destacadas</h2>
            <p className="mt-1 text-[13px] text-[#585858]">Posiciones con alta demanda que podrian interesarte</p>
          </div>
          {allItems.length > 3 && (
            <a href="#todas" className="text-[13px] font-medium text-[#DD0C15] hover:underline">
              Ver todas las vacantes &rarr;
            </a>
          )}
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
        ) : featured.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto mb-3 h-12 w-12 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
            <p className="text-sm text-[#8B8B8B]">No hay vacantes disponibles en este momento</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((v) => (
              <VacancyCard key={v.id} vacancy={v} orgSlug={orgSlug} />
            ))}
          </div>
        )}
      </section>

      {/* Why Work With Us */}
      <div id="beneficios">
        <WhyWorkSection />
      </div>

      {/* Browse by Area */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="mb-6 text-[22px] font-bold text-[#1F114C]">Explorar por Area</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              onClick={() => { setSearch(cat.label); setAppliedSearch(cat.label); }}
              className="group cursor-pointer rounded-xl bg-[#F6F6F6] p-4 text-center transition-all hover:bg-[#1F114C]"
            >
              <p className="mb-1 text-[24px]">{cat.emoji}</p>
              <p className="text-[12px] font-medium text-[#1F114C] group-hover:text-white">{cat.label}</p>
            </button>
          ))}
        </div>
      </section>

      {/* All Vacancies (if searching or > 3) */}
      {(appliedSearch || appliedLocation || allItems.length > 3) && allItems.length > 0 && (
        <section id="todas" className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="mb-6 text-[22px] font-bold text-[#1F114C]">
            {appliedSearch || appliedLocation ? 'Resultados de busqueda' : 'Todas las vacantes'}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {allItems.map((v) => (
              <VacancyCard key={v.id} vacancy={v} orgSlug={orgSlug} />
            ))}
          </div>
        </section>
      )}

      <PortalFooter orgName={orgName} />
    </div>
  );
}
