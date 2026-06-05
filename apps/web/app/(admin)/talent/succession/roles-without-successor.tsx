'use client';

import { Skeleton } from '../../../../components';

interface RoleWithoutSuccessor {
  id: string;
  title: string;
  criticality: string;
  currentHolder?: { id: string; firstName: string; lastName: string; jobTitle?: string | null } | null;
}

interface RolesWithoutSuccessorProps {
  data: RoleWithoutSuccessor[] | undefined;
  loading: boolean;
  t: {
    rolesNoSuccessor: string;
    rolesUncovered: string;
    colRole: string;
    colDepartment: string;
    colCriticality: string;
    colNoSuccessorSince: string;
    colAction: string;
    assign: string;
    critical: string;
    high: string;
    medium: string;
  };
}

const DEMO_ROLES = [
  { role: 'Dir. Recursos Humanos', dept: 'RRHH', criticality: 'critical', since: '18 meses' },
  { role: 'Gte. Seguridad Industrial', dept: 'Operaciones', criticality: 'critical', since: '12 meses' },
  { role: 'Dir. Innovacion Digital', dept: 'Tecnologia', criticality: 'high', since: '8 meses' },
  { role: 'Gte. Relaciones Institucionales', dept: 'Asuntos Corp.', criticality: 'high', since: '6 meses' },
  { role: 'Gte. Cumplimiento Normativo', dept: 'Legal', criticality: 'medium', since: '3 meses' },
];

const CRIT_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-[#DD0C15]', text: 'text-[#DD0C15]' },
  high: { bg: 'bg-orange-500', text: 'text-orange-600' },
  medium: { bg: 'bg-amber-500', text: 'text-amber-600' },
};

function getCritLabel(crit: string, t: RolesWithoutSuccessorProps['t']) {
  if (crit === 'critical') return t.critical;
  if (crit === 'high') return t.high;
  return t.medium;
}

export function RolesWithoutSuccessor({ data, loading, t }: RolesWithoutSuccessorProps) {
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

  const items = data && data.length > 0
    ? data.map((r) => ({
        role: r.title,
        dept: r.currentHolder?.jobTitle ?? '',
        criticality: r.criticality,
        since: '-',
      }))
    : DEMO_ROLES;

  return (
    <div className="w-full md:w-[58%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.rolesNoSuccessor}</h3>
        </div>
        <span className="text-[10px] bg-red-50 text-[#DD0C15] px-2 py-0.5 rounded-full font-medium">
          {items.length} {t.rolesUncovered}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[#EDEDED]">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-[#FAFAFA] text-[10px] text-[#585858] font-medium">
              <th className="px-3 py-2">{t.colRole}</th>
              <th className="px-3 py-2">{t.colDepartment}</th>
              <th className="px-3 py-2">{t.colCriticality}</th>
              <th className="px-3 py-2">{t.colNoSuccessorSince}</th>
              <th className="px-3 py-2">{t.colAction}</th>
            </tr>
          </thead>
          <tbody className="text-[11px] text-[#333]">
            {items.map((item, i) => {
              const style = CRIT_STYLES[item.criticality] ?? CRIT_STYLES.medium;
              return (
                <tr key={item.role} className={`border-t border-[#F0F0F0] ${i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                  <td className="px-3 py-2 font-medium">{item.role}</td>
                  <td className="px-3 py-2 text-[#585858]">{item.dept}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] ${style.bg} text-white px-2 py-0.5 rounded-full font-medium`}>
                      {getCritLabel(item.criticality, t)}
                    </span>
                  </td>
                  <td className={`px-3 py-2 ${style.text} font-medium`}>{item.since}</td>
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
    </div>
  );
}
