'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../../components';

export default function DeiPage() {
  const { t } = useI18n();
  const gender = trpc.dei.getGenderRepresentation.useQuery({});
  const age = trpc.dei.getAgeDistribution.useQuery({});

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.dei}</h1>

      <div className="grid grid-cols-3 gap-4 mb-6 flex-shrink-0">
        {gender.isLoading ? Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />) : gender.data ? (
          <>
            <KpiCard label="Total Empleados" value={gender.data.reduce((s, g) => s + g.count, 0)} subtitle="en la organizacion" icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} iconBg="bg-[#1F114C]/10" />
            {gender.data.slice(0, 2).map((g) => (
              <KpiCard key={g.gender} label={g.gender ?? 'Sin especificar'} value={g.count} subtitle={`${g.percentage}%`} icon={<svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m-8-9H3m18 0h-1" /></svg>} iconBg="bg-violet-50" />
            ))}
          </>
        ) : null}
      </div>

      {age.isLoading ? (
        <div className="bg-white rounded-xl p-5 animate-pulse"><div className="h-32 bg-gray-100 rounded" /></div>
      ) : age.data && age.data.length > 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-[#1F114C] mb-4">Distribucion por Edad</h3>
          <div className="space-y-2">
            {age.data.map((group) => (
              <div key={group.range}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-[#585858]">{group.range}</span>
                  <span className="text-[#1F114C] font-medium">{group.count} ({group.percentage}%)</span>
                </div>
                <div className="w-full bg-[#F6F6F6] rounded-full h-2">
                  <div className="bg-[#1F114C] h-2 rounded-full" style={{ width: `${group.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m-8-9H3m18 0h-1" /></svg>} message="No hay datos DEI disponibles" description="Los datos se generan a partir de los perfiles de empleados" />
      )}
    </div>
  );
}
