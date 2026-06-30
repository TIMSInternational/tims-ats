'use client';

import { Skeleton } from '../../../../components';
import { EmptyState } from '../../../../components/empty-state';

interface FlightRiskRole {
  id: string;
  title: string;
  flightRisk: number | null;
  currentHolder?: { id: string; firstName: string; lastName: string; avatar?: string | null } | null;
  _count: { successors: number };
}

interface FlightRiskPanelProps {
  data: FlightRiskRole[] | undefined;
  loading: boolean;
  isError: boolean;
  t: {
    flightRiskAnalysis: string;
    inHighRisk: string;
    flightRiskEmpty: string;
    flightRiskEmptyDesc: string;
    loadError: string;
  };
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

const AVATAR_COLORS = ['bg-violet-600', 'bg-blue-600', 'bg-teal-600', 'bg-amber-600', 'bg-rose-600'];

function getRiskStyle(risk: number): { borderColor: string; bgColor: string; badgeBg: string } {
  if (risk >= 80) {
    return { borderColor: 'border-red-100', bgColor: 'bg-red-50/50', badgeBg: 'bg-[#DD0C15]' };
  }
  return { borderColor: 'border-orange-100', bgColor: 'bg-orange-50/50', badgeBg: 'bg-orange-500' };
}

export function FlightRiskPanel({ data, loading, isError, t }: FlightRiskPanelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
        <Skeleton className="h-4 w-48 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full mb-2" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
        <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.flightRiskAnalysis}</h3>
        <p className="text-[12px] text-[#DD0C15]">{t.loadError}</p>
      </div>
    );
  }

  const items = data && data.length > 0 ? data : [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.flightRiskAnalysis}</h3>
        {items.length > 0 && (
          <span className="text-[9px] bg-red-50 text-[#DD0C15] px-2 py-0.5 rounded-full font-medium">
            {items.length} {t.inHighRisk}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
          }
          message={t.flightRiskEmpty}
          description={t.flightRiskEmptyDesc}
        />
      ) : (
        <div className="space-y-2">
          {items.map((role, idx) => {
            const holder = role.currentHolder;
            const risk = Math.round((role.flightRisk ?? 0) * 100);
            const { borderColor, bgColor, badgeBg } = getRiskStyle(risk);
            const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length] ?? 'bg-gray-600';
            const initials = holder
              ? getInitials(holder.firstName, holder.lastName)
              : role.title.slice(0, 2).toUpperCase();
            const displayName = holder
              ? `${holder.firstName} ${holder.lastName}`
              : role.title;
            return (
              <div key={role.id} className={`flex items-center gap-2 p-2 ${bgColor} rounded-lg border ${borderColor}`}>
                <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[#333]">{displayName}</p>
                  <p className="text-[9px] text-[#8B8B8B]">{role.title}</p>
                </div>
                <div className="shrink-0">
                  <span className={`text-[9px] ${badgeBg} text-white px-2 py-0.5 rounded-full font-bold`}>{risk}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
