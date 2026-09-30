'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../../../components';
import { ApplyModal } from './apply-modal';
import { JobDescription } from './job-description';
import { JobSidebarItem } from './job-sidebar-item';
import { DetailItem } from './detail-item';
import { enumLabel, formatPortalSalary, formatTimeAgo, parsePortalSalary } from '../../_lib/vacancy-display';
import { useI18n } from '../../../../../../lib/i18n';

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
  const vacancies = trpc.portal.listVacancies.useQuery(
    { organizationId: vacancy.data?.organizationId ?? '', take: 20 },
    { enabled: !!vacancy.data?.organizationId },
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
      <div className="flex h-screen items-center justify-center">
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
      <div className="flex h-screen flex-col items-center justify-center gap-2">
        <ErrorState onRetry={() => vacancy.refetch()} />
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline">{p.backToVacancies}</Link>
      </div>
    );
  }

  if (!vacancy.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-[#8B8B8B]">
        <p className="text-sm">{p.vacancyNotFound}</p>
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline">{p.backToVacancies}</Link>
      </div>
    );
  }

  const v = vacancy.data;
  const salary = parsePortalSalary(v.salary);
  const salaryText = salary ? formatPortalSalary(salary, locale, p) : null;
  const contract = enumLabel(v.contractType, p.contractTypes);
  const requirements = v.jobProfile?.requirements as string[] | null;
  const competencies = v.jobProfile?.competencies as string[] | null;
  const companyName = v.company?.name ?? v.organization?.name ?? p.companyFallback;
  const companyInitial = companyName.charAt(0).toUpperCase();
  const remote = enumLabel(v.remotePolicy, p.remotePolicies);

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Sticky nav */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#EDEDED] bg-white px-6">
        <Link href={`/careers/${orgSlug}`} className="flex items-center gap-2 text-[13px] font-medium text-[#585858] hover:text-[#1F114C]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {p.backToVacancies}
        </Link>
        <span className="ml-auto text-[13px] font-bold tracking-tight text-[#1F114C]">TIMS ATS</span>
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
              className="w-full rounded-lg border border-[#EDEDED] bg-white px-3 py-2 text-[13px] text-[#333] outline-none placeholder:text-[#8B8B8B] focus:border-[#1F114C]"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {vacancies.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
            ) : vacancies.isError ? (
              <div className="p-4">
                <ErrorState onRetry={() => vacancies.refetch()} />
              </div>
            ) : (
              filtered.map((item) => (
                <JobSidebarItem key={item.id} orgSlug={orgSlug} isActive={item.id === vacancyId} item={item} />
              ))
            )}
          </div>
        </aside>

        {/* Right panel */}
        <main className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="border-b border-[#EDEDED] bg-white px-8 py-6">
            <div className="mb-3 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-lg font-bold text-white">{companyInitial}</div>
              <div className="min-w-0">
                <p className="text-[13px] text-[#8B8B8B]">{companyName}</p>
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
              <button onClick={() => setShowApply(true)} className="h-11 rounded-lg bg-[#DD0C15] px-8 text-[14px] font-semibold text-white transition-colors hover:bg-[#c00b13]">{p.applyNow}</button>
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

            {requirements && requirements.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.requirementsTitle}</h2>
                <ul className="space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-[14px] text-[#585858]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DD0C15]" />{String(req)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {competencies && competencies.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.competenciesTitle}</h2>
                <div className="flex flex-wrap gap-2">
                  {competencies.map((c, i) => (
                    <span key={i} className="rounded-full border border-[#EDEDED] bg-[#F6F6F6] px-3 py-1.5 text-[12px] font-medium text-[#1F114C]">{String(c)}</span>
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

            <section className="pb-12">
              <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.aboutCompany}</h2>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F114C] text-sm font-bold text-white">{companyInitial}</div>
                <div>
                  <p className="text-[14px] font-semibold text-[#1F114C]">{companyName}</p>
                  {v.organization?.name && v.organization.name !== companyName && (
                    <p className="text-[12px] text-[#8B8B8B]">{v.organization.name}</p>
                  )}
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-[#585858]">
                {companyName} {p.companyUsesTimsSuffix}
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
