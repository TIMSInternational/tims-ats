'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../../../components';
import { ApplyModal } from './apply-modal';
import { JobDescription } from './job-description';
import { JobSidebarItem } from './job-sidebar-item';
import { DetailItem } from './detail-item';
import { enumLabel, formatPortalSalary, formatTimeAgo, parsePortalSalary, profileItemLabels } from '../../_lib/vacancy-display';
import { useI18n } from '../../../../../../lib/i18n';
import { isPilotScope } from '../../../../../../lib/launch-scope';
import { OrgLogo } from '../../../../../../components/org-logo';

interface JobDetailViewProps {
  orgSlug: string;
  vacancyId: string;
}

export function JobDetailView({ orgSlug, vacancyId }: JobDetailViewProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const [search, setSearch] = useState('');
  const [showApply, setShowApply] = useState(false);
  const vacancy = trpc.portal.getVacancy.useQuery({ id: vacancyId, orgSlug });
  const openVacancy = vacancy.data && !('closed' in vacancy.data) ? vacancy.data : null;
  const vacancies = trpc.portal.listVacancies.useQuery(
    { organizationId: openVacancy?.organizationId ?? '', take: 20 },
    { enabled: !!openVacancy?.organizationId },
  );

  const sidebarItems = vacancies.data?.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return sidebarItems;
    const q = search.toLowerCase();
    return sidebarItems.filter(
      (item) => item.title.toLowerCase().includes(q) || item.location?.toLowerCase().includes(q),
    );
  }, [sidebarItems, search]);

  if (vacancy.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="w-full lg:w-[400px] space-y-4">
          <Skeleton className="h-8 w-3/4 rounded" />
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-32 w-full rounded" />
        </div>
      </div>
    );
  }

  if (vacancy.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2">
        <ErrorState onRetry={() => vacancy.refetch()} error={vacancy.error} />
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline">{p.backToVacancies}</Link>
      </div>
    );
  }

  if (vacancy.data && 'closed' in vacancy.data) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-[18px] font-semibold text-[#1F114C]">{p.vacancyClosedTitle}</h1>
        <p className="max-w-sm text-[13px] text-[#585858]">{p.vacancyClosedDesc}</p>
        <Link href={`/careers/${orgSlug}`} className="mt-2 inline-flex h-10 items-center rounded-lg bg-[#1F114C] px-5 text-[13px] font-medium text-white hover:bg-[#2a1a5c]">
          {p.seeOtherVacancies}
        </Link>
      </div>
    );
  }

  if (!openVacancy) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 text-muted">
        <p className="text-sm">{p.vacancyNotFound}</p>
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline">{p.backToVacancies}</Link>
      </div>
    );
  }

  const v = openVacancy;
  const salary = parsePortalSalary(v.salary);
  const salaryText = salary ? formatPortalSalary(salary, locale, p) : null;
  const contract = enumLabel(v.contractType, p.contractTypes);
  const requirements = profileItemLabels(v.jobProfile?.requirements, 'text');
  const competencies = profileItemLabels(v.jobProfile?.competencies, 'name');
  const orgName = v.organization.name;
  const companyName = v.company?.name || orgName || p.companyFallback;
  // The organization's logo stands for it only when the vacancy has no separate client company.
  const headerLogo = v.company?.name ? null : v.organization.logo;
  const remote = enumLabel(v.remotePolicy, p.remotePolicies);
  const pilot = isPilotScope();
  const openApply = () => setShowApply(true);

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* Sticky nav */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#EDEDED] bg-white px-6">
        <Link href={`/careers/${orgSlug}`} className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-[#585858] hover:text-[#1F114C]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {p.backToVacancies}
        </Link>
        <span className="ml-auto truncate text-[13px] font-bold tracking-tight text-[#1F114C]">{orgName}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="hidden w-[380px] shrink-0 flex-col border-r border-[#EDEDED] bg-[#FAFAFA] lg:flex">
          <div className="border-b border-[#EDEDED] p-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={p.searchVacanciesPlaceholder}
              className="w-full rounded-lg border border-[#EDEDED] bg-white px-3 py-2 text-[13px] text-[#333] outline-none placeholder:text-muted focus:border-[#1F114C]"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {vacancies.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
            ) : vacancies.isError ? (
              <div className="p-4">
                <ErrorState onRetry={() => vacancies.refetch()} error={vacancies.error} />
              </div>
            ) : (
              filtered.map((item) => (
                <JobSidebarItem key={item.id} orgSlug={orgSlug} isActive={item.id === vacancyId} item={item} orgName={orgName} />
              ))
            )}
          </div>
        </aside>

        {/* Right panel */}
        <main className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="border-b border-[#EDEDED] bg-white px-8 py-6">
            <div className="mb-3 flex items-start gap-4">
              <OrgLogo
                logo={headerLogo}
                name={companyName}
                imgClassName="h-12 w-12 shrink-0 rounded-lg object-contain"
                fallbackClassName="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-lg font-bold text-white"
                decorative
              />
              <div className="min-w-0">
                <p className="text-[13px] text-muted">{companyName}</p>
                <h1 className="text-[22px] font-bold leading-tight text-[#1F114C]">{v.title}</h1>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] text-[#585858]">
              {v.location && (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                  {v.location}{remote ? ` (${remote})` : ''}
                </span>
              )}
              <span>{p.postedLabel} {formatTimeAgo(v.createdAt, p)}</span>
              <span>{v.applicantCount} {v.applicantCount === 1 ? p.oneApplicant : p.manyApplicants}</span>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {remote && <span className="rounded-md bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700">{remote}</span>}
              {contract && <span className="rounded-md bg-green-50 px-2.5 py-1 text-[12px] font-medium text-green-700">{contract}</span>}
              {v.priority === 'urgent' && <span className="rounded-md bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">{p.urgentBadge}</span>}
              {salaryText && <span className="rounded-md bg-[#F6F6F6] px-2.5 py-1 text-[12px] font-semibold text-[#1F114C]">{salaryText}</span>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={openApply} className="h-11 rounded-lg bg-[#DD0C15] px-8 text-[14px] font-semibold text-white transition-colors hover:bg-[#c00b13]">{p.applyNow}</button>
            </div>
            {showApply && (
              <ApplyModal
                vacancyId={v.id}
                vacancyTitle={v.title}
                companyName={companyName}
                controllerName={v.organization.name}
                onClose={() => setShowApply(false)}
              />
            )}
          </div>

          {/* Content */}
          <div className="max-w-3xl space-y-8 px-8 py-6">
            {v.description && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.aboutPosition}</h2>
                <JobDescription description={v.description} />
              </section>
            )}

            {requirements.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.requirementsTitle}</h2>
                <ul className="space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-[14px] text-[#585858]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DD0C15]" />{req}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {competencies.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.competenciesTitle}</h2>
                <div className="flex flex-wrap gap-2">
                  {competencies.map((c, i) => (
                    <span key={i} className="rounded-full border border-[#EDEDED] bg-[#F6F6F6] px-3 py-1.5 text-[12px] font-medium text-[#1F114C]">{c}</span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.detailsTitle}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DetailItem label={p.positionsLabel} value={String(v.positions)} />
                {contract && <DetailItem label={p.contractTypeLabel} value={contract} />}
                {remote && <DetailItem label={p.workModeLabel} value={remote} />}
                {v.location && <DetailItem label={p.locationLabel} value={v.location} />}
                {salaryText && <DetailItem label={p.salaryLabel} value={salaryText} />}
                {v.unit?.name && <DetailItem label={p.departmentLabel} value={v.unit.name} />}
              </div>
            </section>

            {/* Its only text is the vendor blurb ("evaluaciones científicas"), which the pilot does not offer
                and is not the organization's own copy — so the pilot shows no "about" section at all. */}
            {!pilot && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.aboutCompany}</h2>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F114C] text-sm font-bold text-white">{companyName.charAt(0).toUpperCase()}</div>
                  <div>
                    <p className="text-[14px] font-semibold text-[#1F114C]">{companyName}</p>
                    {orgName !== companyName && <p className="text-[12px] text-muted">{orgName}</p>}
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-[#585858]">
                  {companyName} {p.companyUsesTimsSuffix}
                </p>
              </section>
            )}

            {/* The privacy notice, reachable before applying (pb-28 keeps it above the phone apply bar). */}
            <p className="pb-28 text-[12px] lg:pb-12">
              <Link href={`/careers/${encodeURIComponent(orgSlug)}/privacy`} className="text-[#585858] underline-offset-2 hover:text-[#1F114C] hover:underline">
                {p.footerPrivacy}
              </Link>
            </p>
          </div>
        </main>
      </div>

      {/* Phones/tablets: the header's apply button scrolls away with the description, so the call to
          action stays pinned at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#EDEDED] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] lg:hidden">
        <button type="button" onClick={openApply} className="h-11 w-full rounded-lg bg-[#DD0C15] text-[14px] font-semibold text-white transition-colors hover:bg-[#c00b13]">
          {p.applyNow}
        </button>
      </div>
    </div>
  );
}
