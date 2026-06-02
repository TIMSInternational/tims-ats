'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../lib/trpc';
import { formatRelativeTime } from '../../../../lib/format-utils';
import { Skeleton } from '../../../../components';

interface JobBoardProps {
  organizationId: string;
  orgName: string;
  orgSlug: string;
}

export function JobBoard({ organizationId, orgName, orgSlug }: JobBoardProps) {
  const [search, setSearch] = useState('');

  const vacancies = trpc.portal.listVacancies.useQuery({
    organizationId,
    take: 50,
    search: search || undefined,
  });

  const items = vacancies.data?.items ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1F114C] mb-2">Vacantes en {orgName}</h1>
        <p className="text-sm text-[#585858]">Encuentra tu proxima oportunidad profesional</p>
      </div>

      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar vacantes por titulo, ubicacion..."
          className="w-full h-12 pl-12 pr-4 rounded-xl border border-[#EDEDED] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
        />
      </div>

      {vacancies.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <Skeleton className="h-5 w-64 mb-2 rounded" />
              <Skeleton className="h-4 w-40 mb-3 rounded" />
              <Skeleton className="h-3 w-full rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
          <p className="text-sm text-[#8B8B8B]">No hay vacantes disponibles en este momento</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((v) => (
            <Link
              key={v.id}
              href={`/careers/${orgSlug}/${v.id}`}
              className="block bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#1F114C] mb-1">{v.title}</h2>
                  <div className="flex items-center gap-3 text-sm text-[#585858] mb-2 flex-wrap">
                    {v.company && <span>{v.company.name}</span>}
                    {v.location && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                        {v.location}
                      </span>
                    )}
                    {v.contractType && <span>{v.contractType}</span>}
                    {v.remotePolicy && (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 font-medium">
                        {v.remotePolicy === 'remote' ? 'Remoto' : v.remotePolicy === 'hybrid' ? 'Hibrido' : 'Presencial'}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-[#8B8B8B] shrink-0">{formatRelativeTime(v.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
