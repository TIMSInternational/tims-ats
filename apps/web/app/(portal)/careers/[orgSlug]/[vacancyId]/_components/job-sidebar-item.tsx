'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../../lib/i18n';
import { enumLabel, formatPortalSalary, formatTimeAgo, parsePortalSalary } from '../../_lib/vacancy-display';

interface JobSidebarItemProps {
  orgSlug: string;
  isActive: boolean;
  item: {
    id: string;
    title: string;
    location: string | null;
    remotePolicy: string | null;
    contractType: string | null;
    salary: unknown;
    createdAt: Date | string;
    company: { name: string } | null;
  };
  /** The organization that owns the board: shown when the vacancy has no client company. */
  orgName: string;
}

export function JobSidebarItem({ orgSlug, isActive, item, orgName }: JobSidebarItemProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const employerName = item.company?.name || orgName || p.companyFallback;
  const salary = parsePortalSalary(item.salary);
  const contract = enumLabel(item.contractType, p.contractTypes);

  return (
    <Link
      href={`/careers/${orgSlug}/${item.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={`block min-h-12 border-b border-border border-l-2 px-4 py-3 transition-colors ${isActive ? 'border-l-brand bg-white' : 'border-l-transparent hover:bg-white'}`}
    >
      <div className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-caption font-bold text-white" aria-hidden="true">
          {employerName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-body ${isActive ? 'font-semibold text-brand' : 'font-medium text-primary'}`}>
            {item.title}
          </p>
          <p className="truncate text-caption text-secondary">{employerName}</p>
          {item.location && (
            <p className="text-caption text-secondary">
              {item.location}
              {item.remotePolicy === 'remote' ? ` (${p.remotePolicies.remote})` : ''}
            </p>
          )}
          {salary && (
            <p className="mt-0.5 text-caption font-medium text-primary tabular-nums">{formatPortalSalary(salary, locale, p)}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {contract && (
              <span className="rounded bg-surface px-1.5 py-0.5 text-caption text-secondary">{contract}</span>
            )}
            <span className="ml-auto text-caption text-muted">{formatTimeAgo(item.createdAt, p)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
