'use client';

import { useId, useMemo, useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../../../components';
import { inputClasses } from '../../../../../../components/field-styles';
import { useI18n } from '../../../../../../lib/i18n';
import { pluralize } from '../../../../../../lib/i18n/format';
import { JobSidebarItem } from './job-sidebar-item';

interface JobSidebarProps {
  orgSlug: string;
  organizationId: string;
  vacancyId: string;
  orgName: string;
}

/** Desktop list of the organization's other open positions beside the one being read (lg and up). */
export function JobSidebar({ orgSlug, organizationId, vacancyId, orgName }: JobSidebarProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const headingId = useId();
  const [search, setSearch] = useState('');
  const vacancies = trpc.portal.listVacancies.useQuery({ organizationId, take: 20 }, { enabled: !!organizationId });

  const filtered = useMemo(() => {
    const items = vacancies.data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => item.title.toLowerCase().includes(q) || item.location?.toLowerCase().includes(q));
  }, [vacancies.data, search]);

  return (
    <aside aria-labelledby={headingId} className="hidden w-[380px] shrink-0 flex-col border-r border-border bg-surface-hover lg:flex">
      <h2 id={headingId} className="sr-only">
        {p.otherVacanciesTitle}
      </h2>
      <div className="border-b border-border p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={p.searchVacanciesPlaceholder}
          aria-label={p.searchVacanciesLabel}
          maxLength={100}
          className={inputClasses('md')}
        />
        <p aria-live="polite" className="sr-only">
          {vacancies.data ? pluralize(filtered.length, { one: p.searchResultCountOne, other: p.searchResultCountMany }, locale) : ''}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {vacancies.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : vacancies.isError ? (
          <div className="p-4">
            <ErrorState onRetry={() => vacancies.refetch()} error={vacancies.error} size="compact" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-callout text-secondary">{p.sidebarNoMatches}</p>
        ) : (
          <ul>
            {filtered.map((item) => (
              <li key={item.id}>
                <JobSidebarItem orgSlug={orgSlug} isActive={item.id === vacancyId} item={item} orgName={orgName} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
