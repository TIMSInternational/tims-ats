'use client';

import { Skeleton } from '../../../../components';
import { EmptyState } from '../../../../components/empty-state';

interface RoleWithoutSuccessor {
  id: string;
  title: string;
  criticality: string;
  currentHolder?: { id: string; firstName: string; lastName: string; jobTitle?: string | null } | null;
}

interface RolesWithoutSuccessorProps {
  data: RoleWithoutSuccessor[] | undefined;
  loading: boolean;
  isError: boolean;
  t: {
    rolesNoSuccessor: string;
    rolesUncovered: string;
    colRole: string;
    colCurrentRole: string;
    colCriticality: string;
    colAction: string;
    assign: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    rolesNoSuccessorEmpty: string;
    rolesNoSuccessorEmptyDesc: string;
    loadError: string;
  };
}

const CRIT_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-[#DD0C15]', text: 'text-[#DD0C15]' },
  high: { bg: 'bg-orange-500', text: 'text-orange-600' },
  medium: { bg: 'bg-amber-500', text: 'text-amber-600' },
  low: { bg: 'bg-gray-400', text: 'text-gray-500' },
};

function getCritLabel(crit: string, t: RolesWithoutSuccessorProps['t']): string {
  if (crit === 'critical') return t.critical;
  if (crit === 'high') return t.high;
  if (crit === 'medium') return t.medium;
  if (crit === 'low') return t.low;
  return t.medium;
}

export function RolesWithoutSuccessor({ data, loading, isError, t }: RolesWithoutSuccessorProps) {
  if (loading) {
    return (
      <div className="w-full md:w-[58%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <Skeleton className="h-4 w-64 mb-3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full mb-2" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="w-full md:w-[58%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.rolesNoSuccessor}</h3>
        <p className="text-[12px] text-[#DD0C15]">{t.loadError}</p>
      </div>
    );
  }

  const items = data && data.length > 0
    ? data.map((r) => ({
        role: r.title,
        currentRole: r.currentHolder?.jobTitle ?? '',
        criticality: r.criticality,
      }))
    : [];

  return (
    <div className="w-full md:w-[58%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.rolesNoSuccessor}</h3>
        </div>
        {items.length > 0 && (
          <span className="text-[10px] bg-red-50 text-[#DD0C15] px-2 py-0.5 rounded-full font-medium">
            {items.length} {t.rolesUncovered}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
          message={t.rolesNoSuccessorEmpty}
          description={t.rolesNoSuccessorEmptyDesc}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#EDEDED]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#FAFAFA] text-[10px] text-[#585858] font-medium">
                <th className="px-3 py-2">{t.colRole}</th>
                <th className="px-3 py-2">{t.colCurrentRole}</th>
                <th className="px-3 py-2">{t.colCriticality}</th>
                <th className="px-3 py-2">{t.colAction}</th>
              </tr>
            </thead>
            <tbody className="text-[11px] text-[#333]">
              {items.map((item, i) => {
                const style = CRIT_STYLES[item.criticality] ?? CRIT_STYLES.medium;
                return (
                  <tr key={item.role} className={`border-t border-[#F0F0F0] ${i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                    <td className="px-3 py-2 font-medium">{item.role}</td>
                    <td className="px-3 py-2 text-[#585858]">{item.currentRole}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] ${style.bg} text-white px-2 py-0.5 rounded-full font-medium`}>
                        {getCritLabel(item.criticality, t)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button className="text-[9px] text-[#DD0C15] bg-red-50 px-2 py-1 rounded font-medium">
                        {t.assign}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
