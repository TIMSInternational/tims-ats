'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState, CandidateAvatar, FitScoreBadge } from '../../../../components';
import { formatDate } from '../../../../lib/format-utils';

const POOL_TABS = ['all', 'applicant', 'referral', 'sourced', 'silver_medalist', 'passive'] as const;

const POOL_STYLES: Record<string, string> = {
  applicant: 'bg-blue-50 text-blue-700',
  referral: 'bg-green-50 text-green-700',
  sourced: 'bg-violet-50 text-violet-700',
  silver_medalist: 'bg-amber-50 text-amber-700',
  passive: 'bg-gray-100 text-gray-600',
};

export default function TalentPoolsPage() {
  const { t } = useI18n();
  const [activePool, setActivePool] = useState<string>('all');
  const [search, setSearch] = useState('');

  const poolStats = trpc.candidate.getPoolStats.useQuery();
  const candidates = trpc.candidate.list.useQuery({
    limit: 50,
    poolType: activePool !== 'all' ? activePool : undefined,
    search: search || undefined,
  });

  const poolLabels: Record<string, string> = {
    all: t.candidates.filterAll,
    applicant: t.candidates.poolApplicant,
    referral: t.candidates.poolReferral,
    sourced: t.candidates.poolSourced,
    silver_medalist: t.candidates.poolSilverMedalist,
    passive: t.candidates.poolPassive,
  };

  const items = candidates.data?.items ?? [];

  const columns = [
    { key: 'name', label: t.candidates.colName },
    { key: 'pool', label: t.candidates.colPool },
    { key: 'source', label: t.candidates.colSource },
    { key: 'fit', label: t.candidates.colFitScore, align: 'center' as const },
    { key: 'apps', label: t.candidates.applications, align: 'center' as const },
    { key: 'created', label: t.candidates.colCreated },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Pool Stats */}
      <div className="grid grid-cols-5 gap-3 mb-5 flex-shrink-0">
        {poolStats.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : poolStats.data ? (
          <>
            <KpiCard
              label={t.candidates.kpiTotal}
              value={poolStats.data.total}
              subtitle={`${poolStats.data.byPool.length} pools`}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            {poolStats.data.byPool.slice(0, 4).map((pool) => (
              <div key={pool.poolType} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{poolLabels[pool.poolType] ?? pool.poolType}</span>
                <div className="text-2xl font-bold text-[#333] mt-2">{pool.count}</div>
              </div>
            ))}
          </>
        ) : null}
      </div>

      {/* Pool Tabs */}
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        {POOL_TABS.map((pool) => (
          <button
            key={pool}
            onClick={() => setActivePool(pool)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activePool === pool ? 'bg-[#1F114C] text-white' : 'bg-white border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}
          >
            {poolLabels[pool] ?? pool}
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.candidates.searchCandidate} className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={candidates.isLoading}
        skeletonRows={8}
        empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>} message={t.candidates.noCandidates} />}
      >
        {items.map((c) => {
          const fitScore = c.fitScores?.[0]?.overallScore;
          const poolCls = POOL_STYLES[c.poolType] ?? 'bg-gray-100 text-gray-600';
          return (
            <tr key={c.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
              <td className="px-4 py-3">
                <Link href={`/recruitment/candidates/${c.id}`} className="flex items-center gap-3 hover:underline">
                  <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" />
                  <div>
                    <p className="text-[13px] font-medium text-[#333]">{c.firstName} {c.lastName}</p>
                    <p className="text-[11px] text-[#8B8B8B]">{c.currentTitle ?? c.email}</p>
                  </div>
                </Link>
              </td>
              <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${poolCls}`}>{poolLabels[c.poolType] ?? c.poolType}</span></td>
              <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{c.source}</span></td>
              <td className="px-4 py-3 text-center">{fitScore != null ? <div className="flex justify-center"><FitScoreBadge score={fitScore} size="sm" /></div> : <span className="text-[11px] text-[#CDCDCD]">—</span>}</td>
              <td className="px-4 py-3 text-center"><span className="text-[13px] text-[#333]">{c._count.applications}</span></td>
              <td className="px-4 py-3"><span className="text-[12px] text-[#8B8B8B]">{formatDate(c.createdAt)}</span></td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}
