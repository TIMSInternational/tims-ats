'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, CandidateAvatar, FitScoreBadge, StageBadge } from '../../../../components';
import type { CandidateListItem } from '../../../../lib/trpc-types';

interface CandidateTableProps {
  candidates: CandidateListItem[];
  isLoading: boolean;
}

const POOL_STYLES: Record<string, string> = {
  applicant: 'bg-blue-50 text-blue-700',
  referral: 'bg-green-50 text-green-700',
  sourced: 'bg-violet-50 text-violet-700',
  silver_medalist: 'bg-amber-50 text-amber-700',
  passive: 'bg-gray-100 text-gray-600',
};

export function CandidateTable({ candidates, isLoading }: CandidateTableProps) {
  const { t } = useI18n();

  const poolLabels: Record<string, string> = {
    applicant: t.candidates.poolApplicant,
    referral: t.candidates.poolReferral,
    sourced: t.candidates.poolSourced,
    silver_medalist: t.candidates.poolSilverMedalist,
    passive: t.candidates.poolPassive,
  };

  const columns = [
    { key: 'name', label: t.candidates.colName },
    { key: 'pool', label: t.candidates.colPool },
    { key: 'source', label: t.candidates.colSource },
    { key: 'fit', label: t.candidates.colFitScore, align: 'center' as const },
    { key: 'apps', label: t.candidates.applications, align: 'center' as const },
    { key: 'tags', label: t.candidates.colTags },
    { key: 'created', label: t.candidates.colCreated },
    { key: 'actions', label: t.candidates.colActions, align: 'right' as const },
  ];

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      empty={
        <EmptyState
          icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
          message={t.candidates.noCandidates}
          description={t.candidates.noCandidatesDesc}
        />
      }
    >
      {candidates.map((c) => {
        const fitScore = c.fitScores?.[0]?.overallScore;
        const poolCls = POOL_STYLES[c.poolType] ?? 'bg-gray-100 text-gray-600';

        return (
          <tr key={c.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <Link href={`/recruitment/candidates/${c.id}`} className="flex items-center gap-3 hover:underline">
                <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" />
                <div>
                  <p className="text-[13px] font-medium text-[#333]">{c.firstName} {c.lastName}</p>
                  <p className="text-[11px] text-[#8B8B8B]">{c.email}</p>
                </div>
              </Link>
            </td>
            <td className="px-4 py-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${poolCls}`}>
                {poolLabels[c.poolType] ?? c.poolType}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#585858]">{c.source}</span>
            </td>
            <td className="px-4 py-3 text-center">
              {fitScore != null ? (
                <div className="flex justify-center">
                  <FitScoreBadge score={fitScore} size="sm" />
                </div>
              ) : (
                <span className="text-[11px] text-[#CDCDCD]">—</span>
              )}
            </td>
            <td className="px-4 py-3 text-center">
              <span className="text-[13px] text-[#333]">{c._count.applications}</span>
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1 max-w-[150px]">
                {c.tags.slice(0, 3).map((tag) => (
                  <span key={tag.id} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{tag.tag}</span>
                ))}
                {c.tags.length > 3 && (
                  <span className="text-[9px] text-[#8B8B8B]">+{c.tags.length - 3}</span>
                )}
              </div>
            </td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#8B8B8B]">{formatDate(c.createdAt)}</span>
            </td>
            <td className="px-4 py-3 text-right">
              <Link
                href={`/recruitment/candidates/${c.id}`}
                className="h-7 px-2.5 rounded-md text-[11px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition inline-flex items-center"
              >
                {t.candidates.viewProfile}
              </Link>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
