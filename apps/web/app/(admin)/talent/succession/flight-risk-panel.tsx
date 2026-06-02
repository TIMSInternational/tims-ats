'use client';

import { Skeleton } from '../../../../components';

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
  t: { flightRiskAnalysis: string; inHighRisk: string; engagement: string };
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

/* Static demo data matching HTML design */
const DEMO_EMPLOYEES = [
  { name: 'Martha Rios', role: 'VP Operaciones', years: 15, engagement: 4.2, risk: 92, avatarBg: 'bg-violet-600', borderColor: 'border-red-100', bgColor: 'bg-red-50/50', engColor: 'text-[#DD0C15]', badgeBg: 'bg-[#DD0C15]' },
  { name: 'Fernando Salazar', role: 'Dir. Comercial', years: 8, engagement: 5.1, risk: 87, avatarBg: 'bg-blue-600', borderColor: 'border-red-100', bgColor: 'bg-red-50/50', engColor: 'text-[#DD0C15]', badgeBg: 'bg-[#DD0C15]' },
  { name: 'Carlos Morales', role: 'Gte. Ingenieria', years: 7, engagement: 5.8, risk: 74, avatarBg: 'bg-teal-600', borderColor: 'border-orange-100', bgColor: 'bg-orange-50/50', engColor: 'text-orange-600', badgeBg: 'bg-orange-500' },
  { name: 'Luis Paredes', role: 'Dir. Legal', years: 11, engagement: 6.0, risk: 68, avatarBg: 'bg-amber-600', borderColor: 'border-orange-100', bgColor: 'bg-orange-50/50', engColor: 'text-orange-600', badgeBg: 'bg-orange-500' },
];

export function FlightRiskPanel({ data, loading, t }: FlightRiskPanelProps) {
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

  const highRiskCount = data?.length ?? 7;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.flightRiskAnalysis}</h3>
        <span className="text-[9px] bg-red-50 text-[#DD0C15] px-2 py-0.5 rounded-full font-medium">
          {highRiskCount} {t.inHighRisk}
        </span>
      </div>
      <div className="space-y-2">
        {DEMO_EMPLOYEES.map((emp) => (
          <div key={emp.name} className={`flex items-center gap-2 p-2 ${emp.bgColor} rounded-lg border ${emp.borderColor}`}>
            <div className={`w-7 h-7 rounded-full ${emp.avatarBg} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
              {getInitials(emp.name.split(' ')[0], emp.name.split(' ')[1])}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#333]">{emp.name}</p>
              <p className="text-[9px] text-[#8B8B8B]">{emp.role} &middot; {emp.years} anos</p>
            </div>
            <div className="text-center px-2">
              <p className="text-[9px] text-[#8B8B8B]">{t.engagement}</p>
              <p className={`text-[11px] font-bold ${emp.engColor}`}>{emp.engagement}/10</p>
            </div>
            <div className="shrink-0">
              <span className={`text-[9px] ${emp.badgeBg} text-white px-2 py-0.5 rounded-full font-bold`}>{emp.risk}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
