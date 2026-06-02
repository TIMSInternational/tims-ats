'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';

export default function CompensationPage() {
  const { t } = useI18n();
  const bands = trpc.compensation.getSalaryBands.useQuery({});
  const benefits = trpc.compensation.getBenefitsUtilization.useQuery({});
  const adjustments = trpc.compensation.listPendingAdjustments.useQuery();

  const salaryBands = bands.data ?? [];
  const pendingAdj = adjustments.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.compensation}</h1>

      <div className="grid grid-cols-3 gap-4 mb-6 flex-shrink-0">
        {bands.isLoading ? Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />) : (
          <>
            <KpiCard label="Bandas Salariales" value={salaryBands.length} subtitle="definidas" icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} iconBg="bg-green-50" />
            <KpiCard label="Ajustes Pendientes" value={pendingAdj.length} subtitle={pendingAdj.length > 0 ? t.common.requiresAttention : t.common.noIssues} valueColor={pendingAdj.length > 0 ? 'text-amber-600' : undefined} icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>} iconBg="bg-amber-50" highlight={pendingAdj.length > 0} />
            <KpiCard label="Planes de Beneficios" value={(benefits.data ?? []).length} subtitle="activos" icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>} iconBg="bg-blue-50" />
          </>
        )}
      </div>

      {salaryBands.length === 0 ? (
        <EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0" /></svg>} message="No hay bandas salariales configuradas" description="Configura las bandas salariales de la organizacion" />
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex-1 overflow-y-auto">
          <h3 className="text-sm font-semibold text-[#1F114C] mb-4">Bandas Salariales</h3>
          <div className="space-y-3">
            {salaryBands.map((band) => (
              <div key={band.id} className="flex items-center justify-between p-3 rounded-lg bg-[#F6F6F6]">
                <div>
                  <p className="text-[13px] font-medium text-[#333]">{band.title}</p>
                  <p className="text-[11px] text-[#8B8B8B]">{band.level} — {band.currency}</p>
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  <div className="text-center"><p className="text-[#8B8B8B]">Min</p><p className="font-medium text-[#333]">${band.minSalary.toLocaleString()}</p></div>
                  <div className="text-center"><p className="text-[#8B8B8B]">Mid</p><p className="font-medium text-[#1F114C]">${band.midSalary.toLocaleString()}</p></div>
                  <div className="text-center"><p className="text-[#8B8B8B]">Max</p><p className="font-medium text-[#333]">${band.maxSalary.toLocaleString()}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
