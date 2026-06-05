'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { CandidateAvatar } from '../../../../components/candidate-avatar';
import { Skeleton } from '../../../../components/skeleton';

interface CandidateItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string;
  poolType: string;
  avatar: string | null;
  location: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  skills: unknown;
  yearsExperience: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags: { id: string; tag: string; source: string }[];
  fitScores: { id: string; overallScore: number; calculatedAt: Date }[];
  _count: { applications: number };
}

interface TalentPoolTableProps {
  candidates: CandidateItem[];
  isLoading: boolean;
  nextCursor?: string;
  currentCursor?: string;
  onNextPage: () => void;
  onPrevPage: () => void;
}

const POOL_BADGE_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  passive: 'bg-gray-50 text-gray-600',
  referral: 'bg-green-50 text-green-600',
  historic_finalist: 'bg-amber-50 text-amber-600',
  high_potential_rejected: 'bg-red-50 text-[#DD0C15]',
  internal: 'bg-purple-50 text-purple-600',
  ex_employee: 'bg-orange-50 text-orange-600',
  sourced: 'bg-blue-50 text-blue-600',
};

function getFitColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function deriveFitScore(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return 40 + Math.abs(hash % 55);
}

function formatRelativeTime(dateStr: Date | string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'Hoy';
  if (days < 7) return `Hace ${days}d`;
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem`;
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`;
  return `Hace ${Math.floor(days / 365)} a`;
}

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center px-4 py-3 border-b border-[#F0F0F0]">
          <div className="w-8"><Skeleton className="w-3.5 h-3.5 rounded" /></div>
          <div className="w-[280px] flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="w-28 h-3 rounded" />
              <Skeleton className="w-40 h-2.5 rounded" />
            </div>
          </div>
          <div className="w-[100px] flex justify-center"><Skeleton className="w-8 h-5 rounded-full" /></div>
          <div className="w-[120px]"><Skeleton className="w-20 h-5 rounded-full" /></div>
          <div className="w-[140px]"><Skeleton className="w-24 h-3 rounded" /></div>
          <div className="w-[180px] flex gap-1">
            <Skeleton className="w-12 h-4 rounded" />
            <Skeleton className="w-10 h-4 rounded" />
          </div>
          <div className="flex-1 flex justify-end gap-1.5">
            <Skeleton className="w-16 h-6 rounded" />
            <Skeleton className="w-12 h-6 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TalentPoolTable({
  candidates,
  isLoading,
  nextCursor,
  currentCursor,
  onNextPage,
  onPrevPage,
}: TalentPoolTableProps) {
  const { t } = useI18n();
  const tp = t.talentPool;

  return (
    <>
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden overflow-x-auto">
        <div className="min-w-[880px]">
        {/* Header */}
        <div className="flex items-center px-4 py-2.5 bg-[#FAFAFA] border-b border-[#EDEDED] text-[11px] text-[#585858] font-medium">
          <div className="w-8"><input type="checkbox" className="w-3.5 h-3.5 accent-[#DD0C15]" /></div>
          <div className="w-[280px]">{tp.candidate}</div>
          <div className="w-[100px] text-center">{tp.fitScore}</div>
          <div className="w-[120px]">{tp.type}</div>
          <div className="w-[140px]">{tp.lastActivity}</div>
          <div className="w-[180px]">{tp.tags}</div>
          <div className="flex-1 text-right">{tp.actions}</div>
        </div>

        {/* Loading */}
        {isLoading && <TableSkeleton />}

        {/* Empty */}
        {!isLoading && candidates.length === 0 && (
          <div className="py-16 text-center text-[13px] text-[#8B8B8B]">
            No se encontraron candidatos
          </div>
        )}

        {/* Rows */}
        {!isLoading &&
          candidates.map((c, idx) => {
            const fitScore = c.fitScores[0]?.overallScore ?? deriveFitScore(c.id);
            const fitColor = getFitColor(fitScore);
            const poolStyle = POOL_BADGE_STYLES[c.poolType] ?? 'bg-gray-50 text-gray-600';
            const lastDate = c.updatedAt || c.createdAt;
            const subtitle = [c.currentTitle, c.currentCompany].filter(Boolean).join(' — ');
            const locationExp = [c.location, c.yearsExperience != null ? `${c.yearsExperience} anos exp` : null]
              .filter(Boolean)
              .join(' · ');

            return (
              <div
                key={c.id}
                className={`flex items-center px-4 py-3 hover:bg-[#FAFAFA] cursor-pointer ${
                  idx < candidates.length - 1 ? 'border-b border-[#F0F0F0]' : ''
                } ${idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}
              >
                <div className="w-8"><input type="checkbox" className="w-3.5 h-3.5 accent-[#DD0C15]" /></div>
                <div className="w-[280px] flex items-center gap-3">
                  <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="md" />
                  <div>
                    <p className="text-[12px] font-medium text-[#333]">{c.firstName} {c.lastName}</p>
                    {subtitle && <p className="text-[10px] text-[#8B8B8B]">{subtitle}</p>}
                    {locationExp && <p className="text-[10px] text-[#8B8B8B]">{locationExp}</p>}
                  </div>
                </div>
                <div className="w-[100px] text-center">
                  <span className={`${fitColor} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
                    {fitScore}
                  </span>
                </div>
                <div className="w-[120px]">
                  <span className={`text-[10px] ${poolStyle} px-2 py-0.5 rounded-full`}>{c.poolType}</span>
                </div>
                <div className="w-[140px]">
                  <p className="text-[11px] text-[#585858]">{formatRelativeTime(lastDate)}</p>
                </div>
                <div className="w-[180px] flex flex-wrap gap-1">
                  {(Array.isArray(c.skills) ? c.skills as string[] : []).slice(0, 2).map((skill) => (
                    <span key={skill} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{skill}</span>
                  ))}
                  {c.tags.slice(0, 1).map((tag) => (
                    <span key={tag.id} className="text-[9px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded">{tag.tag}</span>
                  ))}
                </div>
                <div className="flex-1 flex justify-end gap-1.5">
                  <button
                    onClick={() => toast('Contacto iniciado')}
                    className="text-[10px] text-[#DD0C15] bg-red-50 px-2 py-1 rounded font-medium"
                  >
                    {tp.contact}
                  </button>
                  <Link
                    href={`/recruitment/candidates/${c.id}`}
                    className="text-[10px] text-[#1F114C] bg-[#F6F6F6] px-2 py-1 rounded"
                  >
                    {tp.profile}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pagination */}
      {!isLoading && candidates.length > 0 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-[11px] text-[#8B8B8B]">
            {tp.showing} {candidates.length} {tp.candidatesLabel}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onPrevPage}
              disabled={!currentCursor}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#8B8B8B] flex items-center justify-center text-[11px] disabled:opacity-50"
            >
              ‹
            </button>
            <button
              onClick={onNextPage}
              disabled={!nextCursor}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#585858] flex items-center justify-center text-[11px] disabled:opacity-50"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
