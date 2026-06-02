'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { DataTable, EmptyState, StatusBadge, CandidateAvatar } from '../../../../components';

const READINESS_MAP: Record<string, { cls: string; label: string }> = {
  ready_now: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Listo ahora' },
  ready_1_2: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: '1-2 anos' },
  ready_3_5: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: '3-5 anos' },
  not_ready: { cls: 'bg-gray-100 text-gray-600', label: 'No listo' },
};

const RISK_MAP: Record<string, { cls: string; label: string }> = {
  low: { cls: 'bg-green-50 text-green-600', label: 'Bajo' },
  medium: { cls: 'bg-amber-50 text-amber-600', label: 'Medio' },
  high: { cls: 'bg-red-50 text-red-600', label: 'Alto' },
  critical: { cls: 'bg-red-100 text-red-700', label: 'Critico' },
};

export default function SuccessionPage() {
  const { t } = useI18n();
  const roles = trpc.succession.listCriticalRoles.useQuery({});
  const items = Array.isArray(roles.data) ? roles.data : [];

  const columns = [
    { key: 'role', label: t.succession.colRole },
    { key: 'holder', label: t.succession.colHolder },
    { key: 'successors', label: t.succession.colSuccessors, align: 'center' as const },
    { key: 'readiness', label: t.succession.colReadiness },
    { key: 'risk', label: t.succession.colRisk },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.succession.title}</h1>
      <DataTable columns={columns} loading={roles.isLoading} skeletonRows={6} empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772" /></svg>} message={t.succession.noRoles} description={t.succession.noRolesDesc} />}>
        {items.map((role) => (
          <tr key={role.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <p className="text-[13px] font-medium text-[#333]">{role.title}</p>
              <p className="text-[10px] text-[#8B8B8B]">{role.criticality}</p>
            </td>
            <td className="px-4 py-3">
              {role.currentHolder ? (
                <div className="flex items-center gap-2">
                  <CandidateAvatar firstName={role.currentHolder.firstName} lastName={role.currentHolder.lastName} avatar={role.currentHolder.avatar} size="sm" />
                  <span className="text-[12px] text-[#585858]">{role.currentHolder.firstName} {role.currentHolder.lastName}</span>
                </div>
              ) : <span className="text-[11px] text-[#CDCDCD]">Vacante</span>}
            </td>
            <td className="px-4 py-3 text-center">
              <span className={`text-[13px] font-medium ${role.successors.length > 0 ? 'text-[#1F114C]' : 'text-[#DD0C15]'}`}>{role.successors.length}</span>
            </td>
            <td className="px-4 py-3">
              {role.successors.length > 0 ? (
                <StatusBadge status={role.successors[0].readiness} map={READINESS_MAP} />
              ) : <span className="text-[11px] text-[#DD0C15]">Sin sucesor</span>}
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={String(role.flightRisk ?? 'low')} map={RISK_MAP} />
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
