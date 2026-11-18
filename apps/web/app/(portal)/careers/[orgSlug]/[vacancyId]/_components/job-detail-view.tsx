'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton, ErrorState } from '../../../../../../components';
import { Button } from '../../../../../../components/button';
import { TEXT_LINK_CLASSES } from '../../../../../../components/button-styles';
import { StatusBadge } from '../../../../../../components/status-badge';
import { ApplyModal } from './apply-modal';
import { JobDescription } from './job-description';
import { JobSidebar } from './job-sidebar';
import { JobPageBar } from './job-page-bar';
import { DetailItem } from './detail-item';
import { enumLabel, formatPortalSalary, formatTimeAgo, parsePortalSalary, profileItemLabels } from '../../_lib/vacancy-display';
import { useI18n } from '../../../../../../lib/i18n';
import { isPilotScope } from '../../../../../../lib/launch-scope';
import { OrgLogo } from '../../../../../../components/org-logo';
import { trackCareersFunnel } from '../../../../../../lib/analytics/web-analytics';

interface JobDetailViewProps {
  orgSlug: string;
  vacancyId: string;
}

export function JobDetailView({ orgSlug, vacancyId }: JobDetailViewProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const [showApply, setShowApply] = useState(false);
  const vacancy = trpc.portal.getVacancy.useQuery({ id: vacancyId, orgSlug });
  const openVacancy = vacancy.data && !('closed' in vacancy.data) ? vacancy.data : null;
  const boardHref = `/careers/${orgSlug}`;

  if (vacancy.isLoading) {
    return (
      <div className="flex h-dvh flex-col bg-white">
        <JobPageBar orgSlug={orgSlug} />
        <div className="flex flex-1 items-center justify-center px-4" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          <div className="w-full space-y-4 lg:w-[400px]">
            <Skeleton className="h-8 w-3/4 rounded" />
            <Skeleton className="h-4 w-1/2 rounded" />
            <Skeleton className="h-32 w-full rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (vacancy.isError) {
    return (
      <div className="flex h-dvh flex-col bg-white">
        <JobPageBar orgSlug={orgSlug} />
        <main className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
          <ErrorState onRetry={() => vacancy.refetch()} error={vacancy.error} />
        </main>
      </div>
    );
  }

  if (vacancy.data && 'closed' in vacancy.data) {
    return (
      <div className="flex h-dvh flex-col bg-white">
        <JobPageBar orgSlug={orgSlug} />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="font-display text-title font-semibold text-brand">{p.vacancyClosedTitle}</h1>
          <p className="max-w-sm text-base text-secondary sm:text-body">{p.vacancyClosedDesc}</p>
          <Button href={boardHref} size="lg" className="mt-2">
            {p.seeOtherVacancies}
          </Button>
        </main>
      </div>
    );
  }

  if (!openVacancy) {
    return (
      <div className="flex h-dvh flex-col bg-white">
        <JobPageBar orgSlug={orgSlug} />
        <main className="flex flex-1 items-center justify-center px-4">
          <ErrorState variant="notFound" title={p.vacancyNotFound} back={{ href: boardHref, label: p.backToVacancies }} />
        </main>
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
  const openApply = () => {
    setShowApply(true);
    trackCareersFunnel('apply_started', orgSlug);
  };
  const sectionTitle = 'mb-3 text-heading font-semibold text-brand';

  return (
    <div className="flex h-dvh flex-col bg-white">
      <JobPageBar orgSlug={orgSlug} orgName={orgName} orgLogo={v.organization.logo} />

      <div className="flex flex-1 overflow-hidden">
        <JobSidebar orgSlug={orgSlug} organizationId={v.organizationId} vacancyId={vacancyId} orgName={orgName} />

        <main className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="border-b border-border bg-white px-4 py-6 sm:px-8">
            <div className="mb-3 flex items-start gap-4">
              <OrgLogo
                logo={headerLogo}
                name={companyName}
                imgClassName="size-12 shrink-0 rounded-lg object-contain"
                fallbackClassName="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand text-heading font-bold text-white"
                decorative
              />
              <div className="min-w-0">
                <p className="text-body text-secondary">{companyName}</p>
                <h1 className="font-display text-title font-bold leading-tight text-brand sm:text-display">{v.title}</h1>
              </div>
            </div>
            {salaryText && <p className="mb-2 text-subheading font-semibold text-brand tabular-nums">{salaryText}</p>}
            <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-secondary">
              {v.location && (
                <span className="inline-flex items-center gap-1">
                  <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                  {v.location}{remote ? ` (${remote})` : ''}
                </span>
              )}
              {v.location && <span aria-hidden="true">·</span>}
              <span>{p.postedLabel} {formatTimeAgo(v.createdAt, p)}</span>
              <span aria-hidden="true">·</span>
              <span>{v.applicantCount} {v.applicantCount === 1 ? p.oneApplicant : p.manyApplicants}</span>
              {v.priority === 'urgent' && <StatusBadge tone="warning">{p.urgentBadge}</StatusBadge>}
            </p>
            {/* Phones/tablets use the pinned bar below instead, so the first screen has one "Postularse". The
                wrapper does the hiding: Button's own inline-flex would beat a "hidden" passed in className. */}
            <div className="hidden lg:block">
              <Button size="lg" onClick={openApply} className="px-8">
                {p.applyNow}
              </Button>
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
          <div className="max-w-3xl space-y-8 px-4 py-6 sm:px-8">
            {v.description && (
              <section>
                <h2 className={sectionTitle}>{p.aboutPosition}</h2>
                <JobDescription description={v.description} />
              </section>
            )}

            {requirements.length > 0 && (
              <section>
                <h2 className={sectionTitle}>{p.requirementsTitle}</h2>
                <ul className="space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-base text-secondary sm:text-subheading">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand/40" aria-hidden="true" />{req}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {competencies.length > 0 && (
              <section>
                <h2 className={sectionTitle}>{p.competenciesTitle}</h2>
                <ul className="flex flex-wrap gap-2">
                  {competencies.map((c, i) => (
                    <li key={i} className="rounded-full border border-border bg-surface px-3 py-1.5 text-callout font-medium text-brand">{c}</li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className={sectionTitle}>{p.detailsTitle}</h2>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DetailItem label={p.positionsLabel} value={String(v.positions)} />
                {contract && <DetailItem label={p.contractTypeLabel} value={contract} />}
                {remote && <DetailItem label={p.workModeLabel} value={remote} />}
                {v.location && <DetailItem label={p.locationLabel} value={v.location} />}
                {salaryText && <DetailItem label={p.salaryLabel} value={salaryText} />}
                {v.unit?.name && <DetailItem label={p.departmentLabel} value={v.unit.name} />}
              </dl>
            </section>

            {/* Its only text is the vendor blurb ("evaluaciones científicas"), which the pilot does not offer
                and is not the organization's own copy — so the pilot shows no "about" section at all. */}
            {!pilot && (
              <section>
                <h2 className={sectionTitle}>{p.aboutCompany}</h2>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-brand text-subheading font-bold text-white" aria-hidden="true">{companyName.charAt(0).toUpperCase()}</div>
                  <div>
                    <p className="text-subheading font-semibold text-brand">{companyName}</p>
                    {orgName !== companyName && <p className="text-callout text-secondary">{orgName}</p>}
                  </div>
                </div>
                <p className="text-base leading-relaxed text-secondary sm:text-body">
                  {companyName} {p.companyUsesTimsSuffix}
                </p>
              </section>
            )}

            {/* The privacy notice, reachable before applying (pb-28 keeps it above the phone apply bar). */}
            <p className="pb-28 lg:pb-12">
              <Link href={`/careers/${encodeURIComponent(orgSlug)}/privacy`} className={`${TEXT_LINK_CLASSES} text-callout`}>
                {p.footerPrivacy}
              </Link>
            </p>
          </div>
        </main>
      </div>

      {/* Phones/tablets: the header's apply button scrolls away with the description, so the call to
          action stays pinned at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-popover lg:hidden">
        <Button size="lg" fullWidth onClick={openApply}>
          {p.applyNow}
        </Button>
      </div>
    </div>
  );
}
