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
}

export function JobSidebarItem({ orgSlug, isActive, item }: JobSidebarItemProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const salary = parsePortalSalary(item.salary);
  const contract = enumLabel(item.contractType, p.contractTypes);

  return (
    <Link
      href={`/careers/${orgSlug}/${item.id}`}
      className={`block border-b border-[#EDEDED] px-4 py-3 transition-colors ${isActive ? 'border-l-2 border-l-[#DD0C15] bg-white' : 'border-l-2 border-l-transparent hover:bg-white'}`}
    >
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-[10px] font-bold text-white">
          {(item.company?.name ?? p.companyFallback).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13px] font-semibold ${isActive ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>
            {item.title}
          </p>
          <p className="truncate text-[11px] text-[#8B8B8B]">{item.company?.name}</p>
          {item.location && (
            <p className="text-[11px] text-[#8B8B8B]">
              {item.location}
              {item.remotePolicy === 'remote' ? ` (${p.remotePolicies.remote})` : ''}
            </p>
          )}
          {salary && (
            <p className="mt-0.5 text-[11px] font-medium text-[#333]">{formatPortalSalary(salary, locale, p)}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {contract && (
              <span className="rounded bg-[#F6F6F6] px-1.5 py-0.5 text-[10px] text-[#585858]">{contract}</span>
            )}
            <span className="ml-auto text-[10px] text-[#8B8B8B]">{formatTimeAgo(item.createdAt, p)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
