'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { StatusBadge } from '../../../../../components/status-badge';
import { buttonClasses } from '../../../../../components/button-styles';
import { markdownToPlainText } from '../../../../../lib/markdown-lite';
import { enumLabel, formatSalaryAmount, parsePortalSalary, salaryPeriodLabel } from '../_lib/vacancy-display';

interface VacancyCardProps {
  vacancy: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    remotePolicy: string | null;
    contractType: string | null;
    salary: unknown;
    priority: string;
    createdAt: Date | string;
    company: { name: string } | null;
    unit: { name: string } | null;
  };
  orgSlug: string;
  /** The organization that owns the board: shown when the vacancy has no client company. */
  orgName: string;
}

function isNew(createdAt: Date | string) {
  const created = new Date(createdAt);
  const now = new Date();
  return now.getTime() - created.getTime() < 7 * 24 * 60 * 60 * 1000;
}

export function VacancyCard({ vacancy, orgSlug, orgName }: VacancyCardProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const employerName = vacancy.company?.name || orgName || p.companyFallback;
  const initial = employerName.charAt(0).toUpperCase();
  // On a single-employer board the nav already shows the organization: repeat it only for a client company.
  const showEmployer = Boolean(vacancy.company?.name && vacancy.company.name !== orgName);
  const href = `/careers/${orgSlug}/${vacancy.id}`;
  const tags = [
    enumLabel(vacancy.contractType, p.contractTypes),
    enumLabel(vacancy.remotePolicy, p.remotePolicies),
    vacancy.unit?.name,
  ].filter((tag): tag is string => Boolean(tag));
  const salary = parsePortalSalary(vacancy.salary);
  const period = salary ? salaryPeriodLabel(salary.period, p) : null;
  const preview = vacancy.description ? markdownToPlainText(vacancy.description) : '';

  // Stretched link: the job title is the link's name, and its ::after covers the card, so the whole card
  // stays clickable without reading every line of it as one link (accessibility.md › Vision).
  return (
    <article className="group relative rounded-xl border border-border bg-white p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-brand/20 hover:shadow-popover motion-reduce:transition-none">
      {/* Top row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        {showEmployer ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand" aria-hidden="true">
              <span className="text-subheading font-bold text-white">{initial}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-callout font-medium text-primary">{employerName}</p>
              {vacancy.location && <p className="text-caption text-secondary">{vacancy.location}</p>}
            </div>
          </div>
        ) : (
          <p className="min-w-0 text-callout text-secondary">{vacancy.location}</p>
        )}
        {vacancy.priority === 'urgent' ? (
          <StatusBadge tone="warning">{p.urgentBadge}</StatusBadge>
        ) : isNew(vacancy.createdAt) ? (
          <StatusBadge tone="info">{p.newBadge}</StatusBadge>
        ) : null}
      </div>

      {/* Title & description */}
      <h3 className="text-heading font-semibold text-brand">
        <Link
          href={href}
          className="underline-offset-2 after:absolute after:inset-0 after:rounded-xl after:content-[''] group-hover:underline"
        >
          {vacancy.title}
        </Link>
      </h3>
      {preview && <p className="mt-1 line-clamp-2 text-callout text-secondary">{preview}</p>}

      {/* Tags */}
      {tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="rounded-full bg-surface px-2 py-0.5 text-caption text-secondary">
              {tag}
            </li>
          ))}
        </ul>
      )}

      {/* Bottom */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          {salary ? (
            <>
              <p className="text-body font-semibold text-brand tabular-nums">{formatSalaryAmount(salary, locale, p)}</p>
              {period && <p className="text-caption text-secondary">{period}</p>}
            </>
          ) : (
            <p className="text-callout text-secondary">{p.salaryNegotiable}</p>
          )}
        </div>
        {/* Decorative: the title link above is the one way in; this repeats it visually. */}
        <span aria-hidden="true" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          {p.applyCta}
        </span>
      </div>
    </article>
  );
}
